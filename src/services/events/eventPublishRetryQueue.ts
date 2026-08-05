import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { isTransientPublishFailure } from './isTransientPublishFailure'
import type { DomainEvent } from './domainEvent.types'

/** 1 min, 5 min, 30 min, 2 hr, then stop (design spec §4). Indexed by `attempts` so far. */
const BACKOFF_MINUTES = [1, 5, 30, 120]
const MAX_ATTEMPTS = BACKOFF_MINUTES.length

function nextRetryAt(attempts: number): string {
  const baseMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  // ±20% jitter (design spec §8b) so a batch of events that failed together doesn't all
  // become due for retry at exactly the same synchronized moment.
  const jitter = 0.8 + Math.random() * 0.4
  return new Date(Date.now() + baseMinutes * 60_000 * jitter).toISOString()
}

export async function enqueueForRetry<T>(event: DomainEvent<T>, errorMessage: string): Promise<void> {
  const failureKind = isTransientPublishFailure(new Error(errorMessage)) ? 'transient' : 'permanent'
  await db.execute(
    `insert into local_event_publish_retries
       (id, serialized_event, failure_kind, attempts, last_error, next_retry_at, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      JSON.stringify(event),
      failureKind,
      0,
      errorMessage,
      failureKind === 'transient' ? nextRetryAt(0) : new Date(0).toISOString(),
      new Date().toISOString(),
    ],
  )
}

/** Inserts the retried event into `events` and deletes its retry row in one local
 *  transaction (design spec §4: confirmed real via `db.writeTransaction`, already used
 *  elsewhere in this codebase -- see useReturnSheet.ts). Never throws past the caller;
 *  the sweep below is responsible for continuing past a single row's failure. */
async function attemptRetry(row: {
  id: string; serialized_event: string; failure_kind: string; attempts: number
}): Promise<'succeeded' | 'failed'> {
  const event = JSON.parse(row.serialized_event) as DomainEvent
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `insert into events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(), event.type, event.entityId, JSON.stringify(event.payload),
          event.payloadVersion, event.staffId, event.shopId, event.occurredAt, new Date().toISOString(),
        ],
      )
      await tx.execute(`delete from local_event_publish_retries where id = ?`, [row.id])
    })
    return 'succeeded'
  } catch (err) {
    const attempts = row.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      logger.error('[eventPublishRetryQueue] row exhausted retries, leaving for manual inspection', row.id, err)
      // Flip to 'permanent' so retryPendingEventPublishes' `where failure_kind =
      // 'transient'` selection no longer matches this row -- otherwise it would keep
      // matching forever since next_retry_at is never touched again past this point.
      await db.execute(
        `update local_event_publish_retries set attempts = ?, last_error = ?, failure_kind = 'permanent' where id = ?`,
        [attempts, String(err), row.id],
      )
    } else {
      await db.execute(
        `update local_event_publish_retries set attempts = ?, last_error = ?, next_retry_at = ? where id = ?`,
        [attempts, String(err), nextRetryAt(attempts), row.id],
      )
    }
    return 'failed'
  }
}

/** Must never abort partway through -- one permanently-stuck row must not starve every
 *  row behind it in next_retry_at order (design spec §4). */
export async function retryPendingEventPublishes(): Promise<void> {
  const dueRows = await db.getAll<{
    id: string; serialized_event: string; failure_kind: string; attempts: number
  }>(
    `select id, serialized_event, failure_kind, attempts from local_event_publish_retries
     where failure_kind = 'transient' and next_retry_at <= ? order by next_retry_at asc`,
    [new Date().toISOString()],
  )
  for (const row of dueRows) {
    try {
      await attemptRetry(row)
    } catch (err) {
      // attemptRetry already handles its own failures internally; this catch exists so a
      // truly unexpected throw (e.g. a bug in attemptRetry itself) still can't stop the sweep.
      logger.error('[eventPublishRetryQueue] unexpected error processing row, continuing sweep', row.id, err)
    }
  }
}

function formatAge(fromIso: string): string {
  const ms = Date.now() - new Date(fromIso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}

export async function getRetryQueueStats(): Promise<{
  pendingCount: number; permanentCount: number
  oldestPendingAt: string | null; oldestPendingAge: string | null
}> {
  const [pendingRow] = await db.getAll<{ n: number }>(
    `select count(*) as n from local_event_publish_retries where failure_kind = 'transient'`,
  )
  const [permanentRow] = await db.getAll<{ n: number }>(
    `select count(*) as n from local_event_publish_retries where failure_kind = 'permanent'`,
  )
  const [oldestRow] = await db.getAll<{ created_at: string }>(
    `select created_at from local_event_publish_retries where failure_kind = 'transient' order by created_at asc limit 1`,
  )
  return {
    pendingCount: pendingRow?.n ?? 0,
    permanentCount: permanentRow?.n ?? 0,
    oldestPendingAt: oldestRow?.created_at ?? null,
    oldestPendingAge: oldestRow ? formatAge(oldestRow.created_at) : null,
  }
}

/** Runs the sweep on app start and every PowerSync reconnect transition, reusing the
 *  connector's own status listener (same mechanism useSync.ts's bindPowerSync already
 *  uses) rather than a new polling timer. */
export function startRetryQueueSweeper(): { stop: () => void } {
  void retryPendingEventPublishes()
  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void retryPendingEventPublishes()
    },
  })
  return { stop: () => unsubscribe?.() }
}
