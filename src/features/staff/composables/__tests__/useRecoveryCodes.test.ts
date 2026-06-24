import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useRecoveryCodes, normalizeCode, RECOVERY_CODE_COUNT } from '../useRecoveryCodes'
import { db } from '@/data/powersync/db'

// An in-memory stand-in for the single staff row's recovery_codes cell.
// `existing` models which staff ids actually have a row, so the existence probe
// (SELECT id FROM staff) returns null for an unknown id — the case PowerSync's
// updatable views silently no-op (and can't be detected via rowsAffected).
let cell = '[]'
let existing: Set<string>
beforeEach(() => {
  vi.clearAllMocks()
  cell = '[]'
  existing = new Set(['owner-1'])
  vi.mocked(db.getOptional).mockImplementation(async (sql: string, params?: any[]) => {
    if (typeof sql === 'string' && sql.includes('SELECT id FROM staff')) {
      return existing.has(params?.[0] as string) ? ({ id: params![0] } as any) : null
    }
    return { recovery_codes: cell } as any
  })
  vi.mocked(db.execute).mockImplementation(async (sql: string, params?: any[]) => {
    if (typeof sql === 'string' && sql.includes('UPDATE staff SET recovery_codes')) cell = params![0]
    return { rows: { _array: [] } } as any
  })
})

describe('normalizeCode', () => {
  it('uppercases and strips separators and ambiguous chars', () => {
    // Alphabet excludes 0/O/1/I. Input 'a1b2-c3d4' → uppercase, drop the '1'
    // (not in the alphabet) and the dash/spaces; A B 2 C 3 D 4 all survive.
    expect(normalizeCode(' a1b2-c3d4 ')).toBe('AB2C3D4')
  })
})

describe('useRecoveryCodes', () => {
  it('generate returns RECOVERY_CODE_COUNT plaintext codes and persists only hashes', async () => {
    const { generate } = useRecoveryCodes()
    const codes = await generate('owner-1')
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT)
    const stored = JSON.parse(cell)
    expect(stored).toHaveLength(RECOVERY_CODE_COUNT)
    expect(stored.every((r: any) => r.hash && r.salt && r.usedAt === null)).toBe(true)
    // No plaintext code is stored.
    expect(cell).not.toContain(codes[0])
  })

  it('verifyAndConsume accepts a valid code once, then rejects its reuse', async () => {
    const { generate, verifyAndConsume } = useRecoveryCodes()
    const codes = await generate('owner-1')
    expect(await verifyAndConsume('owner-1', codes[0])).toBe(true)
    expect(await verifyAndConsume('owner-1', codes[0])).toBe(false) // already used
  })

  it('verifyAndConsume is formatting-insensitive', async () => {
    const { generate, verifyAndConsume } = useRecoveryCodes()
    const codes = await generate('owner-1')
    const messy = ` ${codes[1].toLowerCase().slice(0, 4)}-${codes[1].toLowerCase().slice(4)} `
    expect(await verifyAndConsume('owner-1', messy)).toBe(true)
  })

  it('verifyAndConsume tolerates a JSONB-roundtrip double-encoded value', async () => {
    // Online, the JSONB column re-encodes the stored array text as a JSON *string*
    // scalar; the client then reads a quoted string where JSON.parse yields a
    // String, not an array. The code must still be found and consumed. (Offline,
    // with no sync round-trip, the value stays a clean array — hence the
    // online-only failure that surfaced this.)
    const { generate, verifyAndConsume } = useRecoveryCodes()
    const codes = await generate('owner-1')
    cell = JSON.stringify(cell) // simulate the extra encoding the JSONB round-trip introduces
    expect(await verifyAndConsume('owner-1', codes[0])).toBe(true)
  })

  it('verifyAndConsume rejects an unknown code', async () => {
    const { generate, verifyAndConsume } = useRecoveryCodes()
    await generate('owner-1')
    expect(await verifyAndConsume('owner-1', 'ZZZZZZZZ')).toBe(false)
  })

  it('generate replaces the previous batch — old codes stop working', async () => {
    const { generate, verifyAndConsume } = useRecoveryCodes()
    const firstBatch = await generate('owner-1')
    await generate('owner-1') // regenerate: invalidates the first batch
    expect(await verifyAndConsume('owner-1', firstBatch[0])).toBe(false)
  })

  it('generate throws when the target staff row does not exist (no silent no-op)', async () => {
    // The bug: codes were generated against an id that matched no row, so the
    // write silently affected zero rows and every code later read back as "[]"
    // ("wrong or already used"). A 0-row write must fail loudly instead.
    const { generate } = useRecoveryCodes()
    await expect(generate('ghost-id')).rejects.toThrow()
    // Nothing was persisted to the real row.
    expect(cell).toBe('[]')
  })

  it('remaining counts only unused codes', async () => {
    const { generate, verifyAndConsume, remaining } = useRecoveryCodes()
    const codes = await generate('owner-1')
    expect(await remaining('owner-1')).toBe(RECOVERY_CODE_COUNT)
    await verifyAndConsume('owner-1', codes[0])
    expect(await remaining('owner-1')).toBe(RECOVERY_CODE_COUNT - 1)
  })
})
