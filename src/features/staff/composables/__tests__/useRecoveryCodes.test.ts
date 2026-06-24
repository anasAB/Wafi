import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useRecoveryCodes, normalizeCode, RECOVERY_CODE_COUNT } from '../useRecoveryCodes'
import { db } from '@/data/powersync/db'

// An in-memory stand-in for the single staff row's recovery_codes cell.
let cell = '[]'
beforeEach(() => {
  vi.clearAllMocks()
  cell = '[]'
  vi.mocked(db.getOptional).mockImplementation(async () => ({ recovery_codes: cell }) as any)
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

  it('verifyAndConsume rejects an unknown code', async () => {
    const { generate, verifyAndConsume } = useRecoveryCodes()
    await generate('owner-1')
    expect(await verifyAndConsume('owner-1', 'ZZZZZZZZ')).toBe(false)
  })

  it('remaining counts only unused codes', async () => {
    const { generate, verifyAndConsume, remaining } = useRecoveryCodes()
    const codes = await generate('owner-1')
    expect(await remaining('owner-1')).toBe(RECOVERY_CODE_COUNT)
    await verifyAndConsume('owner-1', codes[0])
    expect(await remaining('owner-1')).toBe(RECOVERY_CODE_COUNT - 1)
  })
})
