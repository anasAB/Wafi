import { db } from '@/data/powersync/db'
import { hashPin, generateSalt, verifyPin } from './usePinAuth'

// Eight single-use codes — the standard backup-code count: enough for several
// rescues, few enough to write on one line. The alphabet excludes 0/O/1/I to
// avoid handwriting ambiguity (shop owners write these on paper).
export const RECOVERY_CODE_COUNT = 8
const CODE_LENGTH = 8
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

type CodeRecord = { hash: string; salt: string; usedAt: string | null }

/** Fold a user-typed code to its canonical form so dashes, spaces and case
 *  never cause a false mismatch. Anything outside the alphabet is dropped. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(new RegExp(`[^${ALPHABET}]`, 'g'), '')
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

async function readCodes(staffId: string): Promise<CodeRecord[]> {
  const row = await db.getOptional<{ recovery_codes: string }>(
    `SELECT recovery_codes FROM staff WHERE id = ?`, [staffId],
  )
  try { return JSON.parse(row?.recovery_codes ?? '[]') as CodeRecord[] }
  catch { return [] }
}

async function writeCodes(staffId: string, codes: CodeRecord[]): Promise<void> {
  await db.execute(`UPDATE staff SET recovery_codes = ? WHERE id = ?`, [JSON.stringify(codes), staffId])
}

export function useRecoveryCodes() {
  /** Generate a fresh set, REPLACING any existing codes (regenerating
   *  invalidates the old sheet). Returns plaintext ONCE; only hashes persist. */
  async function generate(staffId: string): Promise<string[]> {
    const plaintext: string[] = []
    const records: CodeRecord[] = []
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code = randomCode()
      const salt = generateSalt()
      plaintext.push(code)
      records.push({ hash: await hashPin(code, salt), salt, usedAt: null })
    }
    await writeCodes(staffId, records)
    return plaintext
  }

  /** Verify a code against the unused records; on the first match, mark it used
   *  (single-use) and persist. Returns whether a code was consumed. */
  async function verifyAndConsume(staffId: string, code: string): Promise<boolean> {
    const normalized = normalizeCode(code)
    if (!normalized) return false
    const codes = await readCodes(staffId)
    for (const rec of codes) {
      if (rec.usedAt) continue
      if (await verifyPin(normalized, rec.hash, rec.salt)) {
        rec.usedAt = new Date().toISOString()
        await writeCodes(staffId, codes)
        return true
      }
    }
    return false
  }

  async function remaining(staffId: string): Promise<number> {
    return (await readCodes(staffId)).filter((r) => !r.usedAt).length
  }

  return { generate, verifyAndConsume, remaining }
}
