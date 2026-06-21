import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateType } from '@powersync/web'

// Capture the upsert/update/delete builder calls so we can assert how each op
// is translated for the append-only audit_log table.
const upsert = vi.fn(() => ({ error: null }))
const update = vi.fn(() => ({ eq: () => ({ error: null }) }))
const del    = vi.fn(() => ({ eq: () => ({ error: null }) }))
const from   = vi.fn(() => ({ upsert, update, delete: del }))

vi.mock('@/data/supabase/client', () => ({ supabase: { from: (t: string) => from(t) } }))

import { runOp } from '../connector'

describe('connector runOp — audit_log is append-only', () => {
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
})
