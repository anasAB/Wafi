import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { enqueueForRetry } from './eventPublishRetryQueue'
import { tryConsumeToken } from './publishRateLimiter'
import type { DomainEvent } from './domainEvent.types'

/** Dev-visibility only (WAFI-140 Sprint 1) -- not owner-facing alerting. Sprint 2 adds
 *  the actual retry/replay via enqueueForRetry (design spec §6). */
export const eventPublishFailureCount = ref(0)

const MAX_PAYLOAD_BYTES = 16_384
// The largest of all 17 wired payload shapes today serializes to well under 1 KB. 16 KB
// gives over an order of magnitude of headroom for legitimate growth while still catching a
// genuinely runaway/malformed value (design spec §6b).

// Walks the payload for NaN/±Infinity specifically (the values JSON.stringify silently
// turns into `null` rather than erroring on). Cycle safety: event payloads are required to
// be JSON-serializable object graphs without cycles -- a cyclic payload would already throw
// inside JSON.stringify (called before this function runs, in publishEvent below) with
// "Converting circular structure to JSON," so this walk never actually encounters a cycle in
// practice, but carries no cycle-detection of its own regardless (design spec §6b).
function containsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(containsNonFiniteNumber)
  if (value && typeof value === 'object') return Object.values(value).some(containsNonFiniteNumber)
  return false
}

// Called only from executeBusinessOperation, fire-and-forget -- never import
// this directly from a service (executeBusinessOperation already wraps every
// call in `.catch(() => {})`; this function must never throw past that).
export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  if (!tryConsumeToken()) {
    // Dropped, not enqueued (WAFI-140 Sprint 3 final review): enqueueForRetry() is itself a
    // local SQLite write, so routing here to the retry queue defeated this bucket's entire
    // purpose -- avoiding wasted local writes during a runaway loop -- by substituting one
    // local write for another. Worse, those rows classify as 'transient', which
    // cleanupLocalEventTables() never prunes, so the retry table grew unbounded during the
    // exact burst this bucket exists to dampen, and the later sweep replayed every row
    // without re-checking the bucket -- amplifying the burst instead of damping it. An event
    // is best-effort telemetry; losing one to a genuine client-side runaway loop is the
    // cheaper failure.
    eventPublishFailureCount.value += 1
    logger.error('[publishEvent] client-side rate limit exceeded, dropping event', event.type)
    return
  }

  const serialized = JSON.stringify(event.payload)
  if (new TextEncoder().encode(serialized).length > MAX_PAYLOAD_BYTES) {
    throw new Error(`event payload exceeds ${MAX_PAYLOAD_BYTES} bytes: ${event.type}`)
  }
  if (containsNonFiniteNumber(event.payload)) {
    throw new Error(`event payload contains a non-finite number (NaN/Infinity): ${event.type}`)
  }

  try {
    await db.execute(
      `insert into events (id, type, entity_id, payload, payload_version, staff_id, shop_id, occurred_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        event.type,
        event.entityId,
        serialized,
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
