import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin, generateSalt } from '../usePinAuth'

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

describe('usePinAuth — salted hashing (WAFI-012)', () => {
  it('generateSalt produces distinct random hex salts', () => {
    const a = generateSalt()
    const b = generateSalt()
    expect(a).toMatch(/^[0-9a-f]+$/)
    expect(a.length).toBeGreaterThanOrEqual(16)
    expect(a).not.toBe(b)
  })

  it('two staff with the same PIN get different hashes (per-staff salt)', async () => {
    const s1 = generateSalt()
    const s2 = generateSalt()
    expect(await hashPin('1234', s1)).not.toBe(await hashPin('1234', s2))
  })

  it('same PIN + same salt is deterministic', async () => {
    const salt = generateSalt()
    expect(await hashPin('1234', salt)).toBe(await hashPin('1234', salt))
  })

  it('verifyPin matches when given the right salt', async () => {
    const salt = generateSalt()
    const hash = await hashPin('1234', salt)
    expect(await verifyPin('1234', hash, salt)).toBe(true)
    expect(await verifyPin('0000', hash, salt)).toBe(false)
  })

  it('verify-until-reset: a legacy unsalted hash still verifies when salt is null', async () => {
    const legacy = await hashPin('1234')              // pre-WAFI-012 unsalted hash
    expect(await verifyPin('1234', legacy, null)).toBe(true)
    expect(await verifyPin('1234', legacy)).toBe(true)
  })
})
