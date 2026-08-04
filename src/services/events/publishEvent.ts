import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { enqueueForRetry } from './eventPublishRetryQueue'
import type { DomainEvent } from './domainEvent.types'

/** Dev-visibility only (WAFI-140 Sprint 1) -- not owner-facing alerting. Sprint 2 adds
 *  the actual retry/replay via enqueueForRetry (design spec §6). */
export const eventPublishFailureCount = ref(0)

// Called only from executeBusinessOperation, fire-and-forget -- never import
// this directly from a service (executeBusinessOperation already wraps every
// call in `.catch(() => {})`; this function must never throw past that).
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  try {
    await db.execute(
      `insert into events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        event.type,
        event.entityId,
        JSON.stringify(event.payload),
        event.payloadVersion,
        event.staffId,
        event.shopId,
        event.occurredAt,
        new Date().toISOString(),
      ],
    )
  } catch (err) {
    eventPublishFailureCount.value += 1
    logger.error('[publishEvent] failed to persist event, queuing for retry', event.type, err)
    await enqueueForRetry(event, err instanceof Error ? err.message : String(err)).catch(() => {
      // even the retry-queue write can fail (e.g. local disk full) -- this event is
      // genuinely lost, same as Sprint 1's behavior, but now the rare/logged case.
    })
  }
}
