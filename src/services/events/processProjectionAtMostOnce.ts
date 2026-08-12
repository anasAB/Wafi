import { db } from '@/data/powersync/db'
import { logger } from './logger'

export const SubscriberId = {
  DailyEventCounts: 'daily_event_counts_projection',
  TodayRevenueProjection: 'today_revenue_projection',
  ProfitCache: 'profit_cache_projection',
} as const
export type SubscriberId = typeof SubscriberId[keyof typeof SubscriberId]

/** At-most-once, NOT exactly-once (WAFI-140 Sprint 2 design spec §3): if the process
 *  crashes between the ledger insert and `action()` running, this row is marked
 *  processed forever and `action()` never retries. This helper intentionally does not
 *  guarantee eventual execution -- "at most once" means 0-or-1 executions.
 *
 *  Check-then-insert, NOT insert-then-catch-on-unique-violation: PowerSync's
 *  `Table`/`Index` schema DSL has no way to declare a UNIQUE constraint (only plain,
 *  non-unique indexes), so `local_event_processed_ledger` has no DB-enforced
 *  uniqueness on (subscriber_id, event_id) to catch a rejection from in the first
 *  place -- an insert-then-catch implementation would always succeed and the guard
 *  would be a silent no-op. Mirrors `quarantineOp` in `src/data/powersync/dead-letter.ts`.
 *  This is therefore race-free only against sequential redelivery on one device (the
 *  documented single-device replay-protection scope), not against two concurrent
 *  calls for the same (subscriberId, eventId) -- that would need a real DB constraint.
 *
 *  Acceptable because every current caller (e.g. `daily_event_counts`,
 *  `today_revenue_projection`) is a best-effort, disposable projection, not a
 *  financial ledger. Any future subscriber whose action is a financial write must NOT
 *  use this helper -- it needs a real transactional guarantee this ledger does not
 *  provide. */
export async function processProjectionAtMostOnce(
  subscriberId: SubscriberId,
  eventId: string,
  action: () => Promise<void>,
): Promise<void> {
  const existing = await db.getOptional<{ subscriber_id: string }>(
    `select subscriber_id from local_event_processed_ledger where subscriber_id = ? and event_id = ?`,
    [subscriberId, eventId],
  )
  if (existing) return // already processed -- skip silently

  await db.execute(
    `insert into local_event_processed_ledger (subscriber_id, event_id, processed_at) values (?, ?, ?)`,
    [subscriberId, eventId, new Date().toISOString()],
  )
  try {
    await action()
  } catch (err) {
    // Mandatory: the ledger row is already committed, so a swallowed throw here means
    // the event is now silently, permanently skipped with zero trace.
    logger.error('[processProjectionAtMostOnce] subscriber action threw after ledger commit', subscriberId, eventId, err)
  }
}
