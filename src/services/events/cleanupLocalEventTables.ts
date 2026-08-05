import { db } from '@/data/powersync/db'

/** Bounds local-only table growth (WAFI-140 Sprint 3 design spec §8a). Steps 1/3 of
 *  Sprint 2's cleanup() shape (§4a of that spec) are a PowerSync sync-rule change,
 *  configured outside this repo -- not implemented here. This covers steps 2/4:
 *  pruning the two local-only tables this sprint's earlier work introduced. */
export async function cleanupLocalEventTables(): Promise<void> {
  // Step 2: a ledger row referencing an event_id no longer present in the local
  // (sync-rule-scoped) events table can never be re-processed anyway. NOT EXISTS, not
  // NOT IN -- NOT IN has a NULL-handling trap (a NULL in the subquery makes every `NOT
  // IN` comparison UNKNOWN, matching nothing); events.id is a NOT NULL uuid primary key
  // so that trap can't fire here today, but NOT EXISTS carries no such caveat at all.
  await db.execute(
    `delete from local_event_processed_ledger l
     where not exists (select 1 from events e where e.id = l.event_id)`,
  )
  // Step 4: independent of the events cutoff -- only rows already flagged for manual
  // inspection (permanent, per eventPublishRetryQueue.ts's exhausted-retry flip to
  // 'permanent') persist past their own resolution window.
  await db.execute(
    `delete from local_event_publish_retries
     where failure_kind = 'permanent' and created_at < ?`,
    [new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString()],
  )
}

/** Runs cleanup once on start and on every PowerSync reconnect transition -- same
 *  reconnect-listener mechanism startRetryQueueSweeper() already uses (Sprint 2),
 *  reused rather than a new polling timer. App-start-only would leave a device that
 *  stays open for weeks without restarting between cleanups for a long time; reconnects
 *  happen far more often than restarts on such a device. */
export function startEventTableCleanupSweeper(): { stop: () => void } {
  void cleanupLocalEventTables()
  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void cleanupLocalEventTables()
    },
  })
  return { stop: () => unsubscribe?.() }
}
