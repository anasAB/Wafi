# Owner Account Recovery (lost PIN **and** lost/absent account password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an owner who forgot their operator-PIN **and** does not have the shop account password a real recovery path, without weakening the WAFI-056 role rules.

**Architecture:** WAFI-056 made owner-PIN recovery depend on the shop **account password** (`verifyAccountPassword`). That is a dead end if the owner never knew / forgot the password, because our login email is the synthetic `phone@wafi.app` we never deliver to, and the manager→owner reset is deliberately forbidden (privilege-escalation hole). This plan adds three independent layers: (1) capture an optional **recovery email** in the signup data layer so a future password-reset/support flow has a channel; (2) **offline single-use recovery codes** generated from an owner-only Settings screen and consumed by the `PinRecovery` owner path — the primary self-service rescue, working fully offline; (3) a **support-assisted admin-reset runbook + service-role script** as the last resort when no channel was ever set.

**Tech Stack:** Vue 3 + `<script setup>` + TypeScript, Pinia, vue-i18n, PowerSync (local SQLite, `db.execute`), Supabase Auth (`@supabase/supabase-js`), Vitest + @vue/test-utils. SHA-256 hashing via the existing `hashPin`/`generateSalt`/`verifyPin` in `usePinAuth.ts`.

## Global Constraints

- **No new libraries.** Reuse `hashPin`/`generateSalt`/`verifyPin` (`src/features/staff/composables/usePinAuth.ts`), `db.execute` (`src/data/powersync/db`), and `useAuditLog`.
- **Offline-first.** Recovery codes MUST verify with no network — their hashes live in the synced local `staff` row. Only the account-password and email-reset paths may require connectivity, and the UI must say so.
- **Do NOT weaken WAFI-056.** `canResetPin` stays as-is; a manager still cannot reset an owner or another manager. Owner recovery is identity-level (code / password / support), never peer-operator.
- **Plain-language, bilingual.** All new copy lives in `src/i18n/ar.ts` **and** `src/i18n/en.ts` under the existing `staff` namespace; no accounting/security jargon ("recovery code" → "رمز استعادة", not "token").
- **Migrations are sequential and expand-only.** Next number is `022`. Never rename/drop existing columns. `staff` is already in the PowerSync publication (migration `004`), so a new `staff` column replicates automatically — no new sync rule.
- **Brand:** dark glass cards, brand blue `#1A56DB`, `#0D1828` card bg (matches `LockScreen.vue` / `PinRecovery.vue`). The owner-only Settings surface follows existing settings screens.
- **Secrets never in source.** The service-role admin script reads the key from an env var; it is dev/ops tooling, never imported by the app bundle.

---

## File Structure

- `src/data/supabase/auth.ts` — extend `SignUpInput` + `signUpOwner` with optional `recoveryEmail` (metadata only). **Layer 1.**
- `supabase/migrations/022_staff_recovery_codes.sql` — add `recovery_codes JSONB` to `staff`. **Layer 2.**
- `src/features/staff/composables/useRecoveryCodes.ts` — generate / verify-and-consume / count single-use codes. **Layer 2 core.**
- `src/features/staff/composables/__tests__/useRecoveryCodes.test.ts` — tests for the above.
- `src/features/audit/composables/useAuditLog.ts` — add `logRecoveryCodesGenerated` + `logRecoveryCodeUsed`. **Layer 2.**
- `src/features/staff/components/PinRecovery.vue` — add the "I have a recovery code" branch (owner target). **Layer 2.**
- `src/features/settings/screens/RecoveryCodesScreen.vue` — owner-only generate/view-count screen. **Layer 2.**
- `src/pages/SettingsPage.vue` (+ settings nav i18n) — register the new section. **Layer 2.**
- `src/i18n/ar.ts`, `src/i18n/en.ts` — new `staff.*` recovery-code keys + a settings nav label. **Layer 2.**
- `docs/runbooks/owner-account-password-reset.md` — support SOP. **Layer 3.**
- `scripts/admin/reset-owner-password.mjs` — service-role reset script. **Layer 3.**

> **Discovered during planning (read before starting):** `src/pages/SignupPage.vue` is a **prototype** — it writes to a local `store` and routes to `/onboarding` after a fake delay; it never calls `signUpOwner`. Therefore Layer 1 here is **data-layer only** (so the field is captured the moment signup is wired). Do **not** add a recovery-email input to the mock form in this plan; that belongs to the ticket that wires real signup. This is intentional scope, not an omission.

---

## Task 1: Capture an optional recovery email in the auth data layer (Layer 1)

**Files:**
- Modify: `src/data/supabase/auth.ts` (`SignUpInput`, `signUpOwner`)
- Test: `src/__tests__/data/auth.test.ts`

**Interfaces:**
- Consumes: existing `signUpOwner(input: SignUpInput)`, `phoneToEmail`.
- Produces: `SignUpInput.recoveryEmail?: string`; when present and non-empty, `signUpOwner` includes `recovery_email` in `options.data` metadata (trimmed, lowercased). When absent/blank, the metadata key is omitted entirely.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/data/auth.test.ts` inside `describe('signUpOwner', ...)`:

```ts
it('carries a trimmed, lowercased recovery_email in metadata when provided', async () => {
  await signUpOwner({
    phone: '+963944123456', password: 'secret123',
    shopName: 's', businessType: 'general', country: 'SY',
    recoveryEmail: '  Owner@Example.COM ',
  })
  expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
    options: { data: expect.objectContaining({ recovery_email: 'owner@example.com' }) },
  }))
})

it('omits recovery_email entirely when not provided or blank', async () => {
  await signUpOwner({ phone: '0944', password: 'secret123', shopName: 's', businessType: 'general', country: 'SY', recoveryEmail: '   ' })
  const call = signUp.mock.calls.at(-1)![0]
  expect(call.options.data).not.toHaveProperty('recovery_email')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/data/auth.test.ts`
Expected: FAIL — `recovery_email` not present in metadata.

- [ ] **Step 3: Implement**

In `src/data/supabase/auth.ts`, extend the type:

```ts
export type SignUpInput = {
  phone:         string
  password:      string
  shopName:      string
  businessType:  string
  country:       string
  recoveryEmail?: string   // optional real email — the only assisted-recovery channel; login stays phone-based
}
```

In `signUpOwner`, build the metadata so the key is omitted when blank:

```ts
export async function signUpOwner(input: SignUpInput): Promise<AuthOutcome> {
  try {
    const recovery = input.recoveryEmail?.trim().toLowerCase()
    const { error } = await supabase.auth.signUp({
      email:    phoneToEmail(input.phone),
      password: input.password,
      options: {
        data: {
          shop_name:     input.shopName,
          business_type: input.businessType,
          country:       input.country,
          phone:         input.phone,
          ...(recovery ? { recovery_email: recovery } : {}),
        },
      },
    })
    if (error) return fail(classifyAuthError(error.message), error.message)
    return { ok: true }
  } catch (e) {
    return fail('offline', e instanceof Error ? e.message : 'network error')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/data/auth.test.ts`
Expected: PASS (all `signUpOwner` tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/data/supabase/auth.ts src/__tests__/data/auth.test.ts
git commit -m "feat(auth): capture optional recovery_email in signUpOwner metadata (WAFI-057 L1)"
```

---

## Task 2: Migration — `recovery_codes` column on `staff` (Layer 2)

**Files:**
- Create: `supabase/migrations/022_staff_recovery_codes.sql`

**Interfaces:**
- Produces: `public.staff.recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb`, replicated via the existing PowerSync publication (migration `004`). Local PowerSync schema maps it as a TEXT/JSON column; the app reads it with `JSON.parse(row.recovery_codes ?? '[]')`.

- [ ] **Step 1: Write the migration**

```sql
-- Wafi POS — owner offline recovery codes (WAFI-057).
-- Expand-only: nullable-by-default JSONB array of single-use code records,
-- each { "hash": text, "salt": text, "usedAt": iso8601 | null }. Hashes only —
-- never plaintext. Rides the existing PowerSync publication (004) so it syncs
-- to the shop's devices and verifies OFFLINE with no extra round-trip.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.staff.recovery_codes IS
  'Single-use owner recovery codes as [{hash,salt,usedAt}]. SHA-256(salt+code); plaintext shown once at generation and never stored.';
```

- [ ] **Step 2: Apply locally and verify the column exists**

Run: `npx supabase db push` (or the project's migration runner)
Expected: migration `022` applies; `\d public.staff` shows `recovery_codes` jsonb.

> **Note for the implementer:** the local PowerSync client schema (where `staff` columns are declared for the on-device SQLite mirror) must list `recovery_codes`. Find the staff table definition in the PowerSync schema (search `pin_salt` — it sits beside it) and add `recovery_codes` as a text column so the value syncs down. If the schema is generated, regenerate it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_staff_recovery_codes.sql
git commit -m "feat(db): add staff.recovery_codes for offline owner recovery (WAFI-057 L2)"
```

---

## Task 3: `useRecoveryCodes` composable — generate / verify-and-consume / count (Layer 2 core)

**Files:**
- Create: `src/features/staff/composables/useRecoveryCodes.ts`
- Test: `src/features/staff/composables/__tests__/useRecoveryCodes.test.ts`

**Interfaces:**
- Consumes: `hashPin`, `generateSalt`, `verifyPin` from `./usePinAuth`; `db` from `@/data/powersync/db`.
- Produces:
  - `RECOVERY_CODE_COUNT = 8`
  - `normalizeCode(raw: string): string` — uppercase, strip everything but `A–Z`/`2–9`.
  - `useRecoveryCodes()` → `{ generate(staffId): Promise<string[]>, verifyAndConsume(staffId, code): Promise<boolean>, remaining(staffId): Promise<number> }`.
  - Stored record shape: `{ hash: string; salt: string; usedAt: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/staff/composables/__tests__/useRecoveryCodes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useRecoveryCodes.ts`**

```ts
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
```

> **Test-vector note:** the `normalizeCode` test expects `' a1b2-c3d4 '` → `'AB2CD4'`. With the alphabet excluding `0 O 1 I`, the `1` is stripped and `A B 2 C D 4` remain. Keep the alphabet and the expectation in sync if either changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/staff/composables/__tests__/useRecoveryCodes.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/staff/composables/useRecoveryCodes.ts src/features/staff/composables/__tests__/useRecoveryCodes.test.ts
git commit -m "feat(staff): single-use offline recovery codes composable (WAFI-057 L2)"
```

---

## Task 4: Audit events for recovery-code generation and use (Layer 2)

**Files:**
- Modify: `src/features/audit/composables/useAuditLog.ts`
- Modify: `src/features/audit/audit.types.ts` (add the two event strings to the `AuditEvent` union)
- Test: `src/features/audit/__tests__/useAuditLog.recoveryCodes.test.ts`

**Interfaces:**
- Consumes: existing `_logSensitive`.
- Produces:
  - `logRecoveryCodesGenerated(ownerId: string, ownerName: string): Promise<void>` → event `staff.recovery_codes_generated`.
  - `logRecoveryCodeUsed(ownerId: string, ownerName: string): Promise<void>` → event `staff.recovery_code_used`.
  - Both are security-sensitive (surface write failures), entity `'staff'`, entityId `ownerId`.

- [ ] **Step 1: Add the event strings to the union**

In `src/features/audit/audit.types.ts`, add to the `AuditEvent` union (next to `'staff.pin_changed'`):

```ts
  | 'staff.recovery_codes_generated'
  | 'staff.recovery_code_used'
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { db } from '@/data/powersync/db'

describe('useAuditLog recovery-code events (WAFI-057)', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any) })

  it('logRecoveryCodeUsed writes a sensitive audit row naming the owner', async () => {
    const { logRecoveryCodeUsed } = useAuditLog()
    await logRecoveryCodeUsed('owner-1', 'أحمد')
    const call = vi.mocked(db.execute).mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'))
    expect(call).toBeTruthy()
    expect(call![1]).toEqual(expect.arrayContaining(['staff.recovery_code_used', 'staff', 'owner-1']))
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/audit/__tests__/useAuditLog.recoveryCodes.test.ts`
Expected: FAIL — `logRecoveryCodeUsed` is not a function.

- [ ] **Step 4: Implement**

In `useAuditLog.ts`, next to `logPinChanged`, add:

```ts
  const logRecoveryCodesGenerated = (ownerId: string, ownerName: string) =>
    _logSensitive('staff.recovery_codes_generated', 'staff', ownerId, { name: ownerName })

  const logRecoveryCodeUsed = (ownerId: string, ownerName: string) =>
    _logSensitive('staff.recovery_code_used', 'staff', ownerId, { name: ownerName })
```

Add both to the returned object.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/audit/__tests__/useAuditLog.recoveryCodes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/audit/composables/useAuditLog.ts src/features/audit/audit.types.ts src/features/audit/__tests__/useAuditLog.recoveryCodes.test.ts
git commit -m "feat(audit): recovery-code generated/used events (WAFI-057 L2)"
```

---

## Task 5: i18n keys for recovery codes (Layer 2)

**Files:**
- Modify: `src/i18n/ar.ts`, `src/i18n/en.ts`

**Interfaces:**
- Produces: keys under the existing `staff` namespace and one `settings.recovery` nav label, consumed by Tasks 6 & 7.

- [ ] **Step 1: Add keys to `src/i18n/ar.ts`**

Inside the existing `staff: { ... }` block, append:

```ts
    byRecoveryCode:     'أملك رمز استعادة',
    byRecoveryCodeHint: 'استخدم أحد رموز الاستعادة التي حفظتها — يعمل بدون إنترنت',
    enterRecoveryCode:  'أدخل رمز الاستعادة',
    recoveryCodePlaceholder: 'مثال: ABCD-2345',
    wrongRecoveryCode:  'رمز الاستعادة غير صحيح أو مستخدم من قبل.',
    codesTitle:         'رموز استعادة الحساب',
    codesIntro:         'احفظ هذه الرموز في مكان آمن. كل رمز يُستخدم مرة واحدة لاستعادة دخول المالك إن نسيت رمزك السري.',
    codesRemaining:     'المتبقي: {count} من {total}',
    codesGenerate:      'إنشاء رموز جديدة',
    codesRegenerateWarn: 'إنشاء رموز جديدة يُلغي الرموز القديمة.',
    codesShownOnce:     'لن تظهر هذه الرموز مرة أخرى — احفظها الآن.',
    codesCopied:        'تم النسخ',
    codesDone:          'حفظتها — تم',
```

Inside the existing `settings: { ... }` block, append:

```ts
    recoveryCodes:   'رموز الاستعادة',
```

- [ ] **Step 2: Add the parallel keys to `src/i18n/en.ts`**

Inside `staff: { ... }`:

```ts
    byRecoveryCode:     'I have a recovery code',
    byRecoveryCodeHint: 'Use one of the recovery codes you saved — works offline',
    enterRecoveryCode:  'Enter the recovery code',
    recoveryCodePlaceholder: 'e.g. ABCD-2345',
    wrongRecoveryCode:  'That recovery code is wrong or already used.',
    codesTitle:         'Account recovery codes',
    codesIntro:         'Save these somewhere safe. Each code works once to restore owner access if you forget your PIN.',
    codesRemaining:     '{count} of {total} left',
    codesGenerate:      'Generate new codes',
    codesRegenerateWarn: 'Generating new codes invalidates the old ones.',
    codesShownOnce:     'These codes won’t be shown again — save them now.',
    codesCopied:        'Copied',
    codesDone:          'I’ve saved them — done',
```

Inside `settings: { ... }`:

```ts
    recoveryCodes:   'Recovery codes',
```

- [ ] **Step 3: Verify the bundle type-checks**

Run: `npx vue-tsc -p tsconfig.json --noEmit`
Expected: no errors from `ar.ts`/`en.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/ar.ts src/i18n/en.ts
git commit -m "i18n(staff): recovery-code copy in ar + en (WAFI-057 L2)"
```

---

## Task 6: Owner-only "Recovery codes" Settings screen (Layer 2)

**Files:**
- Create: `src/features/settings/screens/RecoveryCodesScreen.vue`
- Modify: `src/pages/SettingsPage.vue` (register the section; owner/`can_manage_settings`-gated like the Staff section)
- Test: `src/features/settings/screens/__tests__/RecoveryCodesScreen.test.ts`

**Interfaces:**
- Consumes: `useRecoveryCodes()` (Task 3), `useSessionStore` (`activeStaff` — the owner), `useAuditLog().logRecoveryCodesGenerated` (Task 4), `useI18n` keys (Task 5).
- Produces: a screen that shows remaining count and, on Generate, displays the plaintext codes **once** with a copy action, then a "done" that clears them from memory.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { i18n } from '@/i18n'

const generate = vi.fn()
const remaining = vi.fn()
vi.mock('@/features/staff/composables/useRecoveryCodes', () => ({
  useRecoveryCodes: () => ({ generate, remaining, verifyAndConsume: vi.fn() }),
  RECOVERY_CODE_COUNT: 8,
}))
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({ logRecoveryCodesGenerated: vi.fn() }),
}))

import RecoveryCodesScreen from '../RecoveryCodesScreen.vue'
import { useSessionStore } from '@/store/session.store'

function mountIt() {
  return mount(RecoveryCodesScreen, { global: { plugins: [i18n] } })
}

describe('RecoveryCodesScreen (WAFI-057)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    remaining.mockResolvedValue(8)
    const session = useSessionStore()
    session.setActiveStaff({ id: 'owner-1', name: 'أحمد', role: 'owner' } as any)
  })

  it('reveals the generated codes exactly once and hides them again on done', async () => {
    generate.mockResolvedValue(['ABCD2345', 'EFGH6789'])
    const w = mountIt()
    await w.get('[data-test="generate"]').trigger('click')
    await Promise.resolve(); await Promise.resolve()
    expect(w.text()).toContain('ABCD2345')
    await w.get('[data-test="codes-done"]').trigger('click')
    expect(w.text()).not.toContain('ABCD2345')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/settings/screens/__tests__/RecoveryCodesScreen.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `RecoveryCodesScreen.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRecoveryCodes, RECOVERY_CODE_COUNT } from '@/features/staff/composables/useRecoveryCodes'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { useSessionStore } from '@/store/session.store'

// Owner-only: generate/replace the owner's offline recovery codes. Codes are
// shown ONCE here and never persisted in plaintext (see useRecoveryCodes).
const { t } = useI18n()
const { generate, remaining } = useRecoveryCodes()
const { logRecoveryCodesGenerated } = useAuditLog()
const session = useSessionStore()

const left      = ref(0)
const codes     = ref<string[] | null>(null) // non-null only while showing a fresh set
const busy      = ref(false)
const copied    = ref(false)

const owner = () => session.activeStaff

onMounted(async () => { if (owner()) left.value = await remaining(owner()!.id) })

async function onGenerate() {
  const o = owner()
  if (!o || busy.value) return
  busy.value = true
  try {
    codes.value = await generate(o.id)
    left.value = RECOVERY_CODE_COUNT
    await logRecoveryCodesGenerated(o.id, o.name)
  } finally { busy.value = false }
}

async function copyAll() {
  if (!codes.value) return
  try { await navigator.clipboard.writeText(codes.value.join('\n')); copied.value = true }
  catch { /* clipboard blocked — the codes are visible to copy by hand */ }
}

function done() { codes.value = null; copied.value = false }
</script>

<template>
  <div class="rc">
    <h2 class="rc-title">{{ t('staff.codesTitle') }}</h2>

    <!-- Reveal-once view -->
    <template v-if="codes">
      <p class="rc-warn">{{ t('staff.codesShownOnce') }}</p>
      <ul class="rc-grid" dir="ltr">
        <li v-for="c in codes" :key="c" class="rc-code">{{ c }}</li>
      </ul>
      <button type="button" class="rc-secondary" @click="copyAll">
        {{ copied ? t('staff.codesCopied') : '⧉' }}
      </button>
      <button type="button" class="rc-primary" data-test="codes-done" @click="done">
        {{ t('staff.codesDone') }}
      </button>
    </template>

    <!-- Default view -->
    <template v-else>
      <p class="rc-intro">{{ t('staff.codesIntro') }}</p>
      <p class="rc-remaining">{{ t('staff.codesRemaining', { count: left, total: RECOVERY_CODE_COUNT }) }}</p>
      <p class="rc-warn-soft">{{ t('staff.codesRegenerateWarn') }}</p>
      <button type="button" class="rc-primary" data-test="generate" :disabled="busy" @click="onGenerate">
        {{ t('staff.codesGenerate') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.rc { display: flex; flex-direction: column; gap: 0.75rem; max-width: 28rem; }
.rc-title { font-size: 1.125rem; font-weight: 800; color: #E8EDF5; }
.rc-intro, .rc-warn-soft { font-size: 0.85rem; color: #8EA3BF; line-height: 1.6; }
.rc-remaining { font-size: 0.95rem; font-weight: 700; color: #C8D5E8; }
.rc-warn { font-size: 0.85rem; color: #FBBF24; font-weight: 700; }
.rc-grid {
  list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;
}
.rc-code {
  font-family: monospace; font-size: 1rem; letter-spacing: 0.15em; color: #E8EDF5;
  background: #0D1828; border: 1px solid rgba(26,86,219,0.30); border-radius: 0.5rem;
  padding: 0.6rem; text-align: center;
}
.rc-primary {
  height: 48px; border-radius: 0.875rem; border: none; cursor: pointer;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; font-weight: 700; font-family: inherit;
}
.rc-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-secondary {
  align-self: flex-start; padding: 0.4rem 0.8rem; border-radius: 0.5rem; cursor: pointer;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #C8D5E8; font-family: inherit;
}
</style>
```

- [ ] **Step 4: Register the section in `SettingsPage.vue`**

Follow the existing Staff-section pattern in `src/pages/SettingsPage.vue`: add a section entry keyed `recoveryCodes` whose label is `t('settings.recoveryCodes')`, gated to owners (the same `can_manage_settings`/owner gate the Staff section uses), rendering `<RecoveryCodesScreen />`. Import the component at the top. (Mirror exactly how the Staff section is declared and guarded — do not invent a new gating mechanism.)

- [ ] **Step 5: Run test + type-check**

Run: `npx vitest run src/features/settings/screens/__tests__/RecoveryCodesScreen.test.ts`
Expected: PASS.
Run: `npx vue-tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/screens/RecoveryCodesScreen.vue src/pages/SettingsPage.vue src/features/settings/screens/__tests__/RecoveryCodesScreen.test.ts
git commit -m "feat(settings): owner-only recovery-codes screen (WAFI-057 L2)"
```

---

## Task 7: `PinRecovery` — "I have a recovery code" branch for the owner (Layer 2)

**Files:**
- Modify: `src/features/staff/components/PinRecovery.vue`
- Test: `src/features/staff/components/__tests__/PinRecovery.codes.test.ts`

**Interfaces:**
- Consumes: `useRecoveryCodes().verifyAndConsume` (Task 3), `useStaff().updateStaffPin` (existing — sets PIN + clears lockout + logs with explicit actor), `useAuditLog().logRecoveryCodeUsed` (Task 4), i18n keys (Task 5).
- Produces: a new step `'owner-code'` reachable from the `choose` step **only when `target.role === 'owner'`**, sitting beside the existing owner-password option. On a valid code it transitions to the existing `set-pin` step with `authoriser.value = null` (owner self-recovery: actor === target). On success it also writes `logRecoveryCodeUsed`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { i18n } from '@/i18n'

const verifyAndConsume = vi.fn()
vi.mock('@/features/staff/composables/useRecoveryCodes', () => ({
  useRecoveryCodes: () => ({ verifyAndConsume, generate: vi.fn(), remaining: vi.fn() }),
  normalizeCode: (s: string) => s, RECOVERY_CODE_COUNT: 8,
}))
const updateStaffPin = vi.fn()
vi.mock('@/features/staff/composables/useStaff', () => ({
  useStaff: () => ({ staff: { value: [] }, loadStaff: vi.fn(), resetStaffPin: vi.fn(), updateStaffPin }),
}))
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({ logRecoveryCodeUsed: vi.fn() }),
}))
vi.mock('@/data/supabase/auth', () => ({ verifyAccountPassword: vi.fn() }))

import PinRecovery from '../PinRecovery.vue'

const owner = { id: 'owner-1', name: 'أحمد', role: 'owner', pinHash: 'x', pinSalt: 's', permissions: {}, isActive: true, shopId: 's', createdAt: '' }

function mountIt() {
  return mount(PinRecovery, { props: { target: owner as any }, global: { plugins: [i18n] } })
}

describe('PinRecovery recovery-code path (WAFI-057)', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('offers the recovery-code option for an owner target', () => {
    const w = mountIt()
    expect(w.text()).toContain(i18n.global.t('staff.byRecoveryCode'))
  })

  it('a valid code advances to set-pin; an invalid one shows an error', async () => {
    verifyAndConsume.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const w = mountIt()
    await w.get('[data-test="path-code"]').trigger('click')
    await w.get('[data-test="code-input"]').setValue('BADCODE0')
    await w.get('[data-test="code-submit"]').trigger('click')
    await Promise.resolve(); await Promise.resolve()
    expect(w.text()).toContain(i18n.global.t('staff.wrongRecoveryCode'))

    await w.get('[data-test="code-input"]').setValue('GOODCODE')
    await w.get('[data-test="code-submit"]').trigger('click')
    await Promise.resolve(); await Promise.resolve()
    // Now on the set-pin step — the PIN pad is shown (prompt changed).
    expect(w.text()).toContain(i18n.global.t('staff.newPinFor', { name: owner.name }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/staff/components/__tests__/PinRecovery.codes.test.ts`
Expected: FAIL — no recovery-code option / `data-test="path-code"` missing.

- [ ] **Step 3: Implement the new branch**

In `PinRecovery.vue` `<script setup>`:

1. Add imports:

```ts
import { useRecoveryCodes } from '../composables/useRecoveryCodes'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
```

2. Wire composables and state (near the existing declarations):

```ts
const { verifyAndConsume } = useRecoveryCodes()
const { logRecoveryCodeUsed } = useAuditLog()
const code = ref('')
```

3. Extend the `Step` union with `'owner-code'`.

4. Add handlers:

```ts
function chooseCode() {
  error.value = ''
  authoriser.value = null      // owner self-recovery: actor === target
  code.value = ''
  step.value = 'owner-code'
}

async function submitRecoveryCode() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    const ok = await verifyAndConsume(props.target.id, code.value)
    if (!ok) { error.value = t('staff.wrongRecoveryCode'); return }
    await logRecoveryCodeUsed(props.target.id, props.target.name)
    code.value = ''
    step.value = 'set-pin'      // reuses the existing set/confirm + commitReset(authoriser=null) path
  } finally { busy.value = false }
}
```

5. The existing `commitReset` already handles `authoriser.value === null` by calling `updateStaffPin(target.id, pin, { id: target.id, name: target.name })` — no change needed.

In the template, add the option to the `choose` step (only for owners — `showOwnerPath` already gates owner-only UI) beside the password button:

```vue
        <button v-if="showOwnerPath" type="button" class="method-btn" data-test="path-code" @click="chooseCode">
          <span class="method-label">{{ t('staff.byRecoveryCode') }}</span>
          <span class="method-hint">{{ t('staff.byRecoveryCodeHint') }}</span>
        </button>
```

Add the new step block (next to `owner-password`):

```vue
    <template v-else-if="step === 'owner-code'">
      <p class="prompt">{{ t('staff.enterRecoveryCode') }}</p>
      <div class="pw-card">
        <input
          v-model="code"
          type="text"
          class="pw-input"
          data-test="code-input"
          :placeholder="t('staff.recoveryCodePlaceholder')"
          dir="ltr"
          autocomplete="one-time-code"
          @keydown.enter="submitRecoveryCode"
        />
      </div>
      <button type="button" class="btn-primary" data-test="code-submit" :disabled="busy || !code" @click="submitRecoveryCode">
        {{ busy ? t('staff.saving') : t('staff.verify') }}
      </button>
      <button type="button" class="back-btn" @click="back">{{ t('common.back') }}</button>
    </template>
```

Extend `back()` so `'owner-code'` returns to `choose` (it already falls through to `step.value = 'choose'` for non-special steps — confirm `'owner-code'` is not special-cased, so the default branch handles it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/staff/components/__tests__/PinRecovery.codes.test.ts`
Expected: PASS (3 assertions across 2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/staff/components/PinRecovery.vue src/features/staff/components/__tests__/PinRecovery.codes.test.ts
git commit -m "feat(staff): owner recovery via offline recovery code in PinRecovery (WAFI-057 L2)"
```

---

## Task 8: Support-assisted reset runbook + service-role script (Layer 3)

**Files:**
- Create: `docs/runbooks/owner-account-password-reset.md`
- Create: `scripts/admin/reset-owner-password.mjs`

**Interfaces:**
- Produces: an ops runbook and a Node script that, given a phone, sets a new account password via the Supabase Admin API. Never imported by the app; reads the service-role key from `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/owner-account-password-reset.md`:

```markdown
# Runbook — Owner account-password reset (last resort)

Use ONLY when an owner is locked out of owner-level access AND has no working
recovery path: forgot the operator-PIN, has no unused recovery codes, and
cannot sign in with the account password. The shop keeps operating in the
meantime — managers and cashiers still log in with their own PINs; only
owner-level functions (settings, staff, owner PIN) are blocked.

## 1. Verify shop ownership (out-of-band — do NOT skip)
Confirm at least TWO of:
- The `recovery_email` on file (Supabase → Auth → user metadata) matches the
  email the requester controls (send a value to it, have them read it back).
- Shop facts only the owner would know: shop name, phone, approximate signup
  date, recent sales/staff names.
- For pilots: a known founder vouches for the person (brother / CEO contact).

Record who verified, when, and which facts matched.

## 2. Reset the password
Run the script (operator workstation, never committed env):

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      node scripts/admin/reset-owner-password.mjs --phone "+963944123456"

It prints a temporary password. Share it over a channel the owner controls,
and tell them to change it immediately after signing in.

## 3. After reset
- Owner signs in with the temp password, then sets a new account password.
- Owner re-enters the app and resets their operator-PIN normally (or uses the
  account-password path in "Forgot PIN?").
- Have the owner generate a fresh set of recovery codes (Settings → Recovery
  codes) so this never recurs.
- Confirm an audit entry exists; note the reset in the support log.
```

- [ ] **Step 2: Write the script**

Create `scripts/admin/reset-owner-password.mjs`:

```js
#!/usr/bin/env node
// Last-resort owner password reset via the Supabase Admin API. Ops tooling only —
// NOT part of the app bundle. Requires the service-role key (never in source).
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//          node scripts/admin/reset-owner-password.mjs --phone "+963944123456"
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const phoneArg = process.argv.indexOf('--phone')
if (phoneArg === -1 || !process.argv[phoneArg + 1]) { console.error('Pass --phone "<E.164 phone>"'); process.exit(1) }
const phone = process.argv[phoneArg + 1]

// Mirror src/data/supabase/auth.ts phoneToEmail — the login email is synthetic.
const email = `${phone.replace(/\D+/g, '')}@wafi.app`
const tempPassword = 'Wafi-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// Find the user by their synthetic email, then set a new password.
const { data, error: listErr } = await admin.auth.admin.listUsers()
if (listErr) { console.error('listUsers failed:', listErr.message); process.exit(1) }
const user = data.users.find((u) => u.email === email)
if (!user) { console.error('No account for', email); process.exit(1) }

const { error } = await admin.auth.admin.updateUserById(user.id, { password: tempPassword })
if (error) { console.error('reset failed:', error.message); process.exit(1) }

console.log('Temporary password for', email, '\n\n   ', tempPassword, '\n\nTell the owner to change it right after signing in.')
```

- [ ] **Step 3: Sanity-check the script parses**

Run: `node --check scripts/admin/reset-owner-password.mjs`
Expected: no output (syntax OK). (Do not run it against production without a verified request.)

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/owner-account-password-reset.md scripts/admin/reset-owner-password.mjs
git commit -m "docs(ops): owner account-password reset runbook + admin script (WAFI-057 L3)"
```

---

## Task 9: Full regression + build gate

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all tests pass (existing 604 + the new recovery tests).

- [ ] **Step 2: Build (type-checks tests too — see build_deploy_gotchas)**

Run: `npm run build`
Expected: green build, no type errors.

- [ ] **Step 3: Commit any fixups**

Stage **only** files this plan created/modified (the working tree contains unrelated
in-progress changes — never `git add -A`). If there are no fixups, skip the commit.

```bash
git add <only-the-WAFI-057-files-you-changed>
git commit -m "chore: WAFI-057 owner account recovery — green build + suite"
```

---

## Acceptance Criteria

- [ ] An owner who forgot their PIN and has **no** account password can recover by entering a saved **recovery code** from "Forgot PIN?", fully **offline**, and set a new owner PIN.
- [ ] Recovery codes are **single-use**: a consumed code is rejected on reuse; `remaining` reflects the count.
- [ ] Recovery-code **plaintext is shown exactly once** (at generation) and never persisted; only salted hashes are stored, and they **sync** so recovery works on the owner's device offline.
- [ ] The Recovery-codes screen is **owner-only** (same gate as Staff).
- [ ] Generating and using a recovery code each write an **audit** row naming the owner.
- [ ] `signUpOwner` carries an optional `recovery_email` in metadata (trimmed/lowercased; omitted when blank). No UI change to the mock signup form.
- [ ] A documented **support runbook + service-role script** exists for the no-channel last resort, with explicit identity-verification steps.
- [ ] WAFI-056 is unchanged: a manager still **cannot** reset an owner/another manager; `canResetPin` untouched.
- [ ] All new flows exist in **ar + en** and render correctly (RTL via the existing `PinRecovery` `dir` binding).
- [ ] `npx vitest run` green; `npm run build` green.

## Definition of Done

Tests: recovery-code generate/verify/consume/remaining; audit events; owner-code path in `PinRecovery` (valid advances to set-pin, invalid errors); Settings screen reveals-once; `signUpOwner` recovery_email metadata. Migration `022` applied and the local PowerSync schema updated so `recovery_codes` syncs. Verified on device offline (generate codes online once → go offline → forget PIN → recover via code → set new PIN → sign in), both languages. Merged, `npm run build` green, existing staff/PIN/auth tests pass.

## Edge cases (must all be handled)
- **Owner has zero unused codes** → the code path still appears but every entry fails with `wrongRecoveryCode`; the owner falls back to the account-password path or the support runbook. (Optionally hide the option when `remaining === 0` — a nice-to-have, not required.)
- **Regenerating codes** → old codes stop working immediately (the array is replaced). The screen warns before generating.
- **Code entered with dashes/spaces/lowercase** → `normalizeCode` folds it; still matches.
- **Offline generation** → codes generate and persist locally offline; they reach other devices once sync runs (state this; don't claim instant cross-device).
- **Non-owner target** → the recovery-code and owner-password options never render (`showOwnerPath` is false); cashiers/managers recover only via a supervisor (WAFI-056).
- **Lost the code sheet too** → support runbook (Layer 3) is the floor; never a state where nobody can recover the shop.
- **Concurrent consume on two devices** → each device consumes against its local copy; on sync the `usedAt` writes converge (last-writer-wins per the existing sync model). Worst case a code appears usable twice briefly across devices — acceptable for a rare rescue; note it, don't engineer distributed locking.
```
