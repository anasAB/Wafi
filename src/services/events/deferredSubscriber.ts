import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { useEventSubscription, type EventRow } from './useEventSubscription'
import { enqueueForProcessingRetry } from './eventProcessingRetryQueue'
import { enqueueDeferredJob } from './enqueueDeferredJob'
import type { DomainEvent, DomainEventType } from './domainEvent.types'

function toDomainEvent<T>(row: EventRow<T>): DomainEvent<T> {
  return {
    type: row.type,
    entityId: row.entity_id,
    payload: row.payload,
    payloadVersion: row.payload_version,
    staffId: row.staff_id,
    shopId: row.shop_id,
    occurredAt: row.occurred_at,
  }
}

/**
 * Producer-side registration for the deferred execution tier (WAFI-154 design spec).
 * Mirrors runDurableSubscriber's try/catch/ledger shape exactly -- reusing the SAME
 * local_subscriber_processed_events ledger and the SAME local_event_processing_retries
 * retry queue -- but the "handler" this wraps is always enqueueDeferredJob, never an
 * arbitrary business action. This is deliberate: WAFI-154 reuses WAFI-150's
 * generalized retry/ledger primitives, not its inline execution path (see design
 * spec's "Precise dependency on WAFI-150" note).
 */
export function defineDeferredSubscriber<T>(opts: {
  subscriberName: string
  eventType: DomainEventType
  shopId: string
  jobType: string
  toJobPayload: (event: DomainEvent<T>) => unknown
  dedupeKey?: (event: DomainEvent<T>) => string | undefined
}): { stop: () => void } {
  return useEventSubscription<T>(
    opts.eventType,
    async (row: EventRow<T>) => {
      const event = toDomainEvent(row)
      let enqueueSucceeded = false
      try {
        const already = await db.getOptional<{ event_id: string }>(
          `select event_id from local_subscriber_processed_events where subscriber_name = ? and event_id = ?`,
          [opts.subscriberName, row.id],
        )
        if (already) return

        await enqueueDeferredJob({
          jobType: opts.jobType,
          shopId: opts.shopId,
          payload: opts.toJobPayload(event),
          dedupeKey: opts.dedupeKey?.(event),
        })
        enqueueSucceeded = true
        await db.execute(
          `insert into local_subscriber_processed_events (id, subscriber_name, event_id, processed_at) values (?, ?, ?, ?)`,
          [crypto.randomUUID(), opts.subscriberName, row.id, new Date().toISOString()],
        )
      } catch (err) {
        if (enqueueSucceeded) {
          logger.error(
            '[defineDeferredSubscriber] enqueue succeeded but ledger write failed, event will be redelivered',
            opts.subscriberName, row.id, err,
          )
        } else {
          logger.error('[defineDeferredSubscriber] enqueue failed, queuing for retry', opts.subscriberName, row.id, err)
        }
        await enqueueForProcessingRetry(opts.subscriberName, event, err instanceof Error ? err.message : String(err)).catch(() => {})
        // Deliberately does NOT rethrow -- useEventSubscription's watch loop must keep
        // running for later events (mirrors runDurableSubscriber's invariant 3).
      }
    },
    { shopId: opts.shopId },
  )
}
