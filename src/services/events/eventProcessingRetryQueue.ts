import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { isTransientEventFailure } from './isTransientEventFailure'
import type { DomainEvent } from './domainEvent.types'

/** Same schedule as eventPublishRetryQueue.ts's BACKOFF_MINUTES -- no reason for
 *  consumption to back off on a different schedule than publication. */
const BACKOFF_MINUTES = [1, 5, 30, 120]
const MAX_ATTEMPTS = BACKOFF_MINUTES.length

function nextRetryAt(attempts: number): string {
  const baseMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  const jitter = 0.8 + Math.random() * 0.4
  return new Date(Date.now() + baseMinutes * 60_000 * jitter).toISOString()
}

export async function enqueueForProcessingRetry<T>(
  subscriberName: string,
  event: DomainEvent<T>,
  errorMessage: string,
): Promise<void> {
  const failureKind = isTransientEventFailure(new Error(errorMessage)) ? 'transient' : 'permanent'
  await db.execute(
    `insert into local_event_processing_retries
       (id, subscriber_name, serialized_event, failure_kind, attempts, last_error, next_retry_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      subscriberName,
      JSON.stringify(event),
      failureKind,
      0,
      errorMessage,
      failureKind === 'transient' ? nextRetryAt(0) : new Date(0).toISOString(),
      new Date().toISOString(),
    ],
  )
}

type RetryRow = {
  id: string; subscriber_name: string; serialized_event: string
  failure_kind: string; attempts: number
}

/** Never aborts partway through -- one permanently-stuck row must not starve every row
 *  behind it (mirrors eventPublishRetryQueue.ts's retryPendingEventPublishes). `handlers`
 *  maps subscriber_name -> the handler closure that subscriber was started with, so a
 *  retried event goes through the exact same success/failure branching as a live
 *  delivery, not a duplicate code path. */
export async function retryPendingEventProcessing(
  handlers: Map<string, (event: DomainEvent) => Promise<void>>,
): Promise<void> {
  const dueRows = await db.getAll<RetryRow>(
    `select id, subscriber_name, serialized_event, failure_kind, attempts
     from local_event_processing_retries
     where failure_kind = 'transient' and next_retry_at <= ? order by next_retry_at asc`,
    [new Date().toISOString()],
  )
  for (const row of dueRows) {
    const handler = handlers.get(row.subscriber_name)
    if (!handler) continue // subscriber not registered in this process -- skip, don't drop
    try {
      const event = JSON.parse(row.serialized_event) as DomainEvent
      await handler(event)
      // Final review I2: a successful retry must go through the identical
      // success/failure branching as a live delivery (design spec invariant 1) --
      // that includes writing the durable ledger row runDurableSubscriber writes on
      // its own success path. Without this, every retried event is silently
      // re-handled on each subsequent redelivery/app restart, and any future
      // subscriber that relies on the ledger for idempotency (rather than carrying
      // its own dedup key, as auditSubscriber.ts currently does) would double-write.
      // `event` is typed as DomainEvent here (the retry queue's public handler
      // signature), but runDurableSubscriber always serializes a DurableEvent<T> --
      // eventId is an own enumerable property and survives the JSON round-trip
      // (verified: see auditSubscriber.test.ts / this file's own tests), so the cast
      // reflects the real runtime shape, not a hope.
      const eventId = (event as unknown as { eventId: string }).eventId
      await db.execute(
        `insert into local_subscriber_processed_events (id, subscriber_name, event_id, processed_at) values (?, ?, ?, ?)`,
        [crypto.randomUUID(), row.subscriber_name, eventId, new Date().toISOString()],
      )
      await db.execute(`delete from local_event_processing_retries where id = ?`, [row.id])
    } catch (err) {
      const attempts = row.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        logger.error('[eventProcessingRetryQueue] row exhausted retries, leaving for manual inspection', row.id, err)
        await db.execute(
          `update local_event_processing_retries set attempts = ?, last_error = ?, failure_kind = 'permanent' where id = ?`,
          [attempts, String(err), row.id],
        )
      } else {
        await db.execute(
          `update local_event_processing_retries set attempts = ?, last_error = ?, next_retry_at = ? where id = ?`,
          [attempts, String(err), nextRetryAt(attempts), row.id],
        )
      }
    }
  }
}

/** Same reconnect-listener + app-start pattern as startRetryQueueSweeper -- no polling
 *  timer, deliberately (battery/CPU on cheap target devices). */
export function startProcessingRetrySweeper(
  handlers: Map<string, (event: DomainEvent) => Promise<void>>,
): { stop: () => void } {
  void retryPendingEventProcessing(handlers)
  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void retryPendingEventProcessing(handlers)
    },
  })
  return { stop: () => unsubscribe?.() }
}
