import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateType } from '@powersync/web'
import type { PostgrestError } from '@supabase/supabase-js'

// Capture the upsert/update/delete builder calls so we can assert how each op
// is translated for the append-only audit_log table.
const upsert = vi.fn(() => ({ error: null }))
const update = vi.fn(() => ({ eq: () => ({ error: null }) }))
const del    = vi.fn(() => ({ eq: () => ({ error: null }) }))
const from   = vi.fn(() => ({ upsert, update, delete: del }))
const rpc    = vi.fn(() => ({ error: null }))

vi.mock('@/data/supabase/client', () => ({
  supabase: { from: (t: string) => from(t), rpc: (fn: string, args: unknown) => rpc(fn, args) },
}))

import { runOp, isPermanentError } from '../ops'

describe('runOp — audit_log is append-only', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts audit_log rows with ignoreDuplicates (ON CONFLICT DO NOTHING), never a plain upsert', async () => {
    await runOp(UpdateType.PUT, 'audit_log', 'a1', { event: 'sale.completed' })
    expect(upsert).toHaveBeenCalledWith(
      { id: 'a1', event: 'sale.completed' },
      { ignoreDuplicates: true },
    )
  })

  it('drops PATCH on audit_log — never sends an UPDATE that would trip the trigger', async () => {
    const err = await runOp(UpdateType.PATCH, 'audit_log', 'a1', { event: 'x' })
    expect(err).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('drops DELETE on audit_log', async () => {
    const err = await runOp(UpdateType.DELETE, 'audit_log', 'a1', undefined)
    expect(err).toBeNull()
    expect(del).not.toHaveBeenCalled()
  })

  it('still upserts (with conflict-update) for every other table', async () => {
    await runOp(UpdateType.PUT, 'sales', 's1', { total_usd: 10 })
    expect(upsert).toHaveBeenCalledWith({ id: 's1', total_usd: 10 })
  })

  it('upserts audit_log on source_event_id (ignoreDuplicates) when the row carries one', async () => {
    await runOp(UpdateType.PUT, 'audit_log', 'row1', { event: 'expense.recorded', source_event_id: 'evt1' })
    expect(upsert).toHaveBeenCalledWith(
      { id: 'row1', event: 'expense.recorded', source_event_id: 'evt1' },
      { onConflict: 'source_event_id', ignoreDuplicates: true },
    )
  })

  it('falls back to the existing id-based upsert when source_event_id is absent (legacy/manual rows)', async () => {
    await runOp(UpdateType.PUT, 'audit_log', 'row2', { event: 'staff.pin_changed' })
    expect(upsert).toHaveBeenCalledWith(
      { id: 'row2', event: 'staff.pin_changed' },
      { ignoreDuplicates: true },
    )
  })
})

describe('runOp — notifications source_event_id dedup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts notifications on source_event_id (ignoreDuplicates) on PUT', async () => {
    await runOp(UpdateType.PUT, 'notifications', 'row1', { type: 'discount.large_applied', source_event_id: 'evt1' })
    expect(upsert).toHaveBeenCalledWith(
      { id: 'row1', type: 'discount.large_applied', source_event_id: 'evt1' },
      { onConflict: 'source_event_id', ignoreDuplicates: true },
    )
  })

  it('falls through to a normal per-id UPDATE for notifications on PATCH (marking read_at)', async () => {
    await runOp(UpdateType.PATCH, 'notifications', 'row1', { read_at: '2026-08-06T00:00:00.000Z' })
    expect(update).toHaveBeenCalledWith({ read_at: '2026-08-06T00:00:00.000Z' })
  })
})

describe('runOp — daily_event_counts idempotent apply (WAFI-151)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls apply_daily_event_count with the source event id on PUT, never upserts the row directly', async () => {
    await runOp(UpdateType.PUT, 'daily_event_counts', 'row1', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 1, source_event_id: 'evt1',
    })
    expect(rpc).toHaveBeenCalledWith('apply_daily_event_count', { p_event_id: 'evt1' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('calls apply_daily_event_count on PATCH too, never a plain UPDATE', async () => {
    await runOp(UpdateType.PATCH, 'daily_event_counts', 'row1', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 2, source_event_id: 'evt2',
    })
    expect(rpc).toHaveBeenCalledWith('apply_daily_event_count', { p_event_id: 'evt2' })
    expect(update).not.toHaveBeenCalled()
  })

  it('returns null and never calls rpc when source_event_id is missing (pre-migration local row)', async () => {
    await runOp(UpdateType.PUT, 'daily_event_counts', 'row3', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 1,
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns null and never calls rpc on PATCH when source_event_id is missing', async () => {
    const err = await runOp(UpdateType.PATCH, 'daily_event_counts', 'row4', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 1,
    })
    expect(err).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ignores the local absolute count value in opData -- only source_event_id is forwarded', async () => {
    // A device with a stale local view (e.g. count: 47 after a long offline stretch)
    // must not upload that absolute value -- the server derives everything from the
    // event itself, keyed only by source_event_id.
    await runOp(UpdateType.PUT, 'daily_event_counts', 'row2', {
      shop_id: 'shop1', event_type: 'sale.completed', day: '2026-08-11', count: 47, source_event_id: 'evt3',
    })
    expect(rpc).toHaveBeenCalledWith('apply_daily_event_count', { p_event_id: 'evt3' })
  })
})

describe('runOp — profit_cache idempotent apply (WAFI-153)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls apply_profit_cache with the source event id on PUT, never upserts the row directly', async () => {
    await runOp(UpdateType.PUT, 'profit_cache', 'row1', {
      shop_id: 'shop1', day: '2026-08-11', revenue_usd: 999, source_event_id: 'evt1',
    })
    expect(rpc).toHaveBeenCalledWith('apply_profit_cache', { p_event_id: 'evt1' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('calls apply_profit_cache on PATCH too, never a plain UPDATE', async () => {
    await runOp(UpdateType.PATCH, 'profit_cache', 'row1', {
      shop_id: 'shop1', day: '2026-08-11', revenue_usd: 999, source_event_id: 'evt2',
    })
    expect(rpc).toHaveBeenCalledWith('apply_profit_cache', { p_event_id: 'evt2' })
    expect(update).not.toHaveBeenCalled()
  })

  it('returns null and never calls rpc when source_event_id is missing', async () => {
    const err = await runOp(UpdateType.PUT, 'profit_cache', 'row3', {
      shop_id: 'shop1', day: '2026-08-11',
    })
    expect(err).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('isPermanentError — quarantine classification', () => {
  const err = (code: string, message = 'x'): PostgrestError =>
    ({ code, message, details: '', hint: '', name: 'PostgrestError' } as unknown as PostgrestError)

  it('treats integrity-constraint violations (SQLSTATE 23xxx) as permanent', () => {
    expect(isPermanentError(err('23505'))).toBe(true) // unique_violation
    expect(isPermanentError(err('23503'))).toBe(true) // foreign_key_violation
    expect(isPermanentError(err('23514'))).toBe(true) // check_violation
  })

  it('treats data exceptions (SQLSTATE 22xxx) as permanent', () => {
    expect(isPermanentError(err('22001'))).toBe(true) // string_data_right_truncation
    expect(isPermanentError(err('22P02'))).toBe(true) // invalid_text_representation
  })

  it('treats RLS / insufficient-privilege (42501) as permanent', () => {
    expect(isPermanentError(err('42501'))).toBe(true)
  })

  it('treats PostgREST error codes (RLS / schema rejections) as permanent', () => {
    expect(isPermanentError(err('PGRST301'))).toBe(true)
    expect(isPermanentError(err('PGRST204'))).toBe(true)
  })

  it('treats a rate-limited events insert as permanent, so it cannot stall the shared batch', () => {
    // 076_events_rate_limit.sql raises this with SQLSTATE P0001; PostgREST may or may not
    // surface a .code for a custom-raised exception, so the classification matches on the
    // message. An event is best-effort telemetry -- quarantining one beats re-queueing the
    // whole batch (sales included) behind it forever.
    expect(isPermanentError(err('P0001', 'events_rate_limit_exceeded'))).toBe(true)
    expect(isPermanentError(err('', 'events_rate_limit_exceeded'))).toBe(true)
  })

  it('treats a missing/empty code (network failure, fetch error) as transient', () => {
    expect(isPermanentError(err(''))).toBe(false)
    expect(isPermanentError(err(undefined as unknown as string))).toBe(false)
  })

  it('treats server-side / connection errors (5xx-class, e.g. 53xxx, 08xxx) as transient', () => {
    expect(isPermanentError(err('53300'))).toBe(false) // too_many_connections
    expect(isPermanentError(err('08006'))).toBe(false) // connection_failure
    expect(isPermanentError(err('57014'))).toBe(false) // query_canceled
  })
})
