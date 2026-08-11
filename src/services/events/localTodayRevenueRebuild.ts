import { db } from '@/data/powersync/db'
import { SalesEventType, type SaleCompletedPayload } from '@/services/events/domainEvent.types'

type RebuildResult =
  | { status: 'success'; revenueUsd: number; revenueSyp: number }
  | { status: 'coverage_unavailable'; reason: string }

/**
 * WAFI-151 Plan 2: coverage-checked rebuild of local_today_revenue_projection.
 * "Today" is the shop's current event_projection_day (shop-local), not the
 * device's calendar day -- both are read from the same synced `events` rows
 * this function already needs, so there is no separate device-clock lookup.
 * A device timezone differing from the shop's would otherwise create an
 * inconsistency between what the client considers "today" and how events
 * are actually day-bucketed everywhere else in this design.
 *
 * Coverage check (design spec, Client-Side Implementation): compares the
 * local count of the exact event subset this projection depends on
 * (sale.completed) against the synced authoritative daily_event_counts row
 * for the same key. A missing authoritative row is coverage-unavailable, not
 * zero. Any local event missing a server-assigned sequence is also a
 * coverage failure -- an unsynced/local-only event cannot be safely mixed
 * into a deterministic replay. On failure, rebuild aborts with no changes.
 */
export async function rebuildLocalTodayRevenueProjection(shopId: string): Promise<RebuildResult> {
  const today = await getShopLocalToday(shopId)

  const localCount = await db.getOptional<{ n: number }>(
    `SELECT count(*) AS n FROM events WHERE shop_id = ? AND type = ? AND event_projection_day = ?`,
    [shopId, SalesEventType.Completed, today],
  )
  const authoritative = await db.getOptional<{ count: number }>(
    `SELECT count FROM daily_event_counts WHERE shop_id = ? AND event_type = ? AND day = ?`,
    [shopId, SalesEventType.Completed, today],
  )

  if (!authoritative) {
    return {
      status: 'coverage_unavailable',
      reason: `no authoritative daily_event_counts row synced yet for ${today} -- coverage cannot be established, not treated as zero`,
    }
  }
  if ((localCount?.n ?? 0) !== authoritative.count) {
    return {
      status: 'coverage_unavailable',
      reason: `local event count (${localCount?.n ?? 0}) does not match the synced authoritative count (${authoritative.count}) for ${today} -- coverage unavailable, resync and retry`,
    }
  }

  const unsequenced = await db.getOptional<{ n: number }>(
    `SELECT count(*) AS n FROM events WHERE shop_id = ? AND type = ? AND event_projection_day = ? AND sequence IS NULL`,
    [shopId, SalesEventType.Completed, today],
  )
  if ((unsequenced?.n ?? 0) > 0) {
    return {
      status: 'coverage_unavailable',
      reason: `${unsequenced!.n} local event(s) for ${today} lack a server-assigned sequence -- cannot safely replay a mix of sequenced and unsequenced events`,
    }
  }

  const rows = await db.getAll<{ id: string; payload: string; sequence: number }>(
    `SELECT id, payload, sequence FROM events WHERE shop_id = ? AND type = ? AND event_projection_day = ? ORDER BY sequence ASC`,
    [shopId, SalesEventType.Completed, today],
  )

  let revenueUsd = 0
  let revenueSyp = 0
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as SaleCompletedPayload
    revenueUsd += payload.totalUsd
    revenueSyp += payload.totalSyp
  }

  const existing = await db.getOptional<{ id: string }>(
    `SELECT id FROM local_today_revenue_projection WHERE shop_id = ? AND date = ?`,
    [shopId, today],
  )

  // The projection write and every ledger entry commit as one local
  // transaction (design spec, "Client-side concurrency": rebuild must run
  // inside an exclusive local transaction). If anything in here throws,
  // writeTransaction rolls back the whole thing -- neither the projection
  // nor any ledger entry is left half-written.
  await db.writeTransaction(async (tx) => {
    if (existing) {
      await tx.execute(
        `UPDATE local_today_revenue_projection SET revenue_usd = ?, revenue_syp = ?, updated_at = ? WHERE id = ?`,
        [revenueUsd, revenueSyp, new Date().toISOString(), existing.id],
      )
    } else {
      await tx.execute(
        `INSERT INTO local_today_revenue_projection (id, shop_id, date, revenue_usd, revenue_syp, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), shopId, today, revenueUsd, revenueSyp, new Date().toISOString()],
      )
    }

    // Record every replayed event in the local ledger so incremental
    // processing after this rebuild treats them as already-applied by ID
    // (Core Architectural Invariant).
    for (const row of rows) {
      await tx.execute(
        `INSERT INTO local_event_processed_ledger (id, subscriber_id, event_id, processed_at) VALUES (?, ?, ?, ?)`,
        [crypto.randomUUID(), 'today_revenue_projection', row.id, new Date().toISOString()],
      )
    }
  })

  return { status: 'success', revenueUsd, revenueSyp }
}

async function getShopLocalToday(shopId: string): Promise<string> {
  // event_projection_day on the most recent synced event for this shop is
  // already computed shop-local server-side -- reusing it here means this
  // function never needs its own timezone logic or a second source of truth
  // for "what day is it for this shop right now."
  const latest = await db.getOptional<{ event_projection_day: string }>(
    `SELECT event_projection_day FROM events WHERE shop_id = ? ORDER BY sequence DESC LIMIT 1`,
    [shopId],
  )
  if (latest) return latest.event_projection_day
  // No events synced yet for this shop at all -- fall back to the device's
  // own UTC date; there is nothing else to derive "today" from.
  return new Date().toISOString().slice(0, 10)
}
