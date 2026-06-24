import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateType } from '@powersync/web'
import type { PostgrestError } from '@supabase/supabase-js'

// Capture the upsert/update/delete builder calls so we can assert how each op
// is translated for the append-only audit_log table.
const upsert = vi.fn(() => ({ error: null }))
const update = vi.fn(() => ({ eq: () => ({ error: null }) }))
const del    = vi.fn(() => ({ eq: () => ({ error: null }) }))
const from   = vi.fn(() => ({ upsert, update, delete: del }))

vi.mock('@/data/supabase/client', () => ({ supabase: { from: (t: string) => from(t) } }))

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
