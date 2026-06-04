import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin } from '../usePinAuth'

describe('usePinAuth', () => {
  it('hashPin produces a 64-character hex string', async () => {
    const hash = await hashPin('1234')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('hashPin is deterministic — same PIN yields same hash', async () => {
    expect(await hashPin('5678')).toBe(await hashPin('5678'))
  })

  it('hashPin produces different hashes for different PINs', async () => {
    expect(await hashPin('1111')).not.toBe(await hashPin('2222'))
  })

  it('verifyPin returns true for correct PIN', async () => {
    const hash = await hashPin('9999')
    expect(await verifyPin('9999', hash)).toBe(true)
  })

  it('verifyPin returns false for wrong PIN', async () => {
    const hash = await hashPin('9999')
    expect(await verifyPin('0000', hash)).toBe(false)
  })
})
