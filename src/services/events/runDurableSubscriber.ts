import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { useEventSubscription } from './useEventSubscription'
import { enqueueForProcessingRetry } from './eventProcessingRetryQueue'
import type { DomainEvent, DomainEventType } from './domainEvent.types'

/**
 * The durable-subscriber primitive (WAFI-150 design spec). Invariants:
 *  1. A handler is never marked processed before it succeeds.
 *  2. A handler may execute more than once (at-least-once upstream delivery, plus
 *     retry) -- handlers passed here MUST be idempotent.
 *  3. Subscriber failures never terminate the live subscription -- this function
 *     never lets a handler's throw propagate back into useEventSubscription's watch
 *     loop; every failure is caught here and routed to the retry queue instead.
 *  4. Retry execution is sequential (see eventProcessingRetryQueue.ts).
 *  5. Permanent failures never block unrelated events -- each event is processed
 *     independently; a permanently-failed row just sits in
 *     local_event_processing_retries for operator review while later events continue.
 *
 * Ordering: eventual processing, not global ordering (WAFI-150 design spec). A retried
 * event may be processed after later events of the same type -- do not rely on order.
 *
 * subscriber_name identity is effectively permanent once shipped: it is half of the
 * ledger's dedup key. Renaming a live subscriber's subscriberName either replays its
 * full history (if that's the intent) or silently discards retry continuity (if it
 * isn't) -- treat a rename as a deliberate operational decision, not a refactor.
 */
export interface DurableEvent<T> extends DomainEvent<T> {
  /** The originating events.id row -- not part of the plain DomainEvent shape used by
   *  publishEvent()/useEventSubscription's other callers, but required so a durable
   *  handler can key its own idempotency check off the same id this function uses for
   *  the processed ledger (see auditSubscriber.ts's check against
   *  audit_log.source_event_id). */
  eventId: string
}

export function runDurableSubscriber<T>(opts: {
  subscriberName: string
  eventType: DomainEventType
  shopId: string
  handler: (event: DurableEvent<T>) => Promise<void>
}): { stop: () => void } {
  return useEventSubscription<T>(
    opts.eventType,
    async (row) => {
      const event: DurableEvent<T> = {
        eventId: row.id,
        type: row.type,
        entityId: row.entity_id,
        payload: row.payload,
        payloadVersion: row.payload_version,
        staffId: row.staff_id,
        shopId: row.shop_id,
        occurredAt: row.occurred_at,
      }

      // Tracks whether opts.handler(event) itself completed successfully, so the
      // catch block below can tell a genuine handler failure apart from a failure in
      // the dedup lookup or the ledger write that happens around it -- see invariant 3.
      let handlerSucceeded = false

      try {
        const already = await db.getOptional<{ event_id: string }>(
          `select event_id from local_subscriber_processed_events where subscriber_name = ? and event_id = ?`,
          [opts.subscriberName, row.id],
        )
        if (already) return

        await opts.handler(event)
        handlerSucceeded = true
        await db.execute(
          `insert into local_subscriber_processed_events (id, subscriber_name, event_id, processed_at) values (?, ?, ?, ?)`,
          [crypto.randomUUID(), opts.subscriberName, row.id, new Date().toISOString()],
        )
      } catch (err) {
        if (handlerSucceeded) {
          logger.error(
            '[runDurableSubscriber] handler succeeded but ledger write failed, event will be redelivered',
            opts.subscriberName,
            row.id,
            err,
          )
        } else {
          logger.error('[runDurableSubscriber] handler failed, queuing for retry', opts.subscriberName, row.id, err)
        }
        await enqueueForProcessingRetry(opts.subscriberName, event, err instanceof Error ? err.message : String(err))
          .catch(() => {
            // even the retry-queue write can fail (e.g. local disk full) -- this event's
            // failure is genuinely unrecorded, same accepted risk as the publish side.
          })
        // Deliberately does NOT rethrow: the caller's useEventSubscription watch loop
        // must keep running for the next event (invariant 3 above).
      }
    },
    { shopId: opts.shopId },
  )
}
