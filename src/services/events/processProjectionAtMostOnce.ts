import { db } from '@/data/powersync/db'
import { logger } from './logger'

export const SubscriberId = {
  DailyEventCounts: 'daily_event_counts_projection',
} as const
export type SubscriberId = typeof SubscriberId[keyof typeof SubscriberId]

/** At-most-once, NOT exactly-once (WAFI-140 Sprint 2 design spec §3): if the process
 *  crashes between the ledger insert and `action()` running, this row is marked
 *  processed forever and `action()` never retries. This helper intentionally does not
 *  guarantee eventual execution -- "at most once" means 0-or-1 executions.
 *
 *  Acceptable today only because the sole caller (`daily_event_counts`) is a
 *  best-effort dashboard number, not a financial ledger. Any future subscriber whose
 *  action is a financial write must NOT use this helper -- it needs a real
 *  transactional guarantee this ledger does not provide. */
export async function processProjectionAtMostOnce(
  subscriberId: SubscriberId,
  eventId: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await db.execute(
      `insert into local_event_processed_ledger (subscriber_id, event_id, processed_at) values (?, ?, ?)`,
      [subscriberId, eventId, new Date().toISOString()],
    )
  } catch {
    return // already processed (unique-violation on subscriber_id+event_id) -- skip silently
  }
  try {
    await action()
  } catch (err) {
    // Mandatory: the ledger row is already committed, so a swallowed throw here means
    // the event is now silently, permanently skipped with zero trace.
    logger.error('[processProjectionAtMostOnce] subscriber action threw after ledger commit', subscriberId, eventId, err)
  }
}
