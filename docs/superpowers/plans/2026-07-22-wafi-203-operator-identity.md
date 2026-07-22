# WAFI-203: Operator Identity Must Be Server-Authoritative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the JWT `staff_id` claim and the locally-active operator agree at every sale-attribution point, so migration `064_wafi202_sales_immutability.sql`'s strict `staff_id = auth_staff_id()` RLS policy can safely go live in production.

**Architecture:** Extract a single `establishOperatorIdentity(staff, pin)` helper that both the login flow (`openShift`) and the mid-shift switch flow (`switchTo`) call before adopting a new local identity. A persisted `lastConfirmedOperatorId` on the device store lets same-identity re-entry skip the network entirely; a genuinely new identity while offline is refused (not silently applied) so local state can never outrun what the server has confirmed. A checkout-time gate in `usePayment.confirm()` refuses to write a sale with no active operator at all.

**Tech Stack:** Vue 3 (Composition API), Pinia (with `pinia-plugin-persistedstate` via each store's `persist` option), Vitest, Supabase JS client (`supabase.rpc`, `supabase.auth`).

## Global Constraints

- No server-side changes — `switch_active_operator` (migration `054_auth_role_helpers.sql`'s successor of 045/048) and the JWT hook already support everything this plan needs.
- Offline-first: nothing in this plan may block a returning/resuming operator from working offline. Only a *genuinely new* identity is gated on connectivity.
- All new/changed user-facing strings are Arabic, RTL, matching the existing style in `LockScreen.vue`.
- Every new async helper function must be independently unit-testable without a live Supabase connection (mock `@/data/supabase/client`, following the existing pattern in `useOperatorSwitch.test.ts`).

---

### Task 1: `establishOperatorIdentity` helper + device-store field

**Files:**
- Modify: `src/store/device.store.ts`
- Modify: `src/features/staff/composables/useOperatorSwitch.ts`
- Modify: `src/features/staff/composables/__tests__/useOperatorSwitch.test.ts`

**Interfaces:**
- Produces: `export type EstablishIdentityResult = { status: 'confirmed' } | { status: 'offline-same-identity' } | { status: 'blocked'; reason: string }`
- Produces: `export async function establishOperatorIdentity(staff: Staff, pin: string): Promise<EstablishIdentityResult>` — from `src/features/staff/composables/useOperatorSwitch.ts`
- Produces: `export class OperatorSwitchBlockedError extends Error {}` — from the same file
- Produces (device store): `lastConfirmedOperatorId: Ref<string | null>` on `useDeviceStore()`
- Consumes: `useDeviceStore()` (`deviceId`, new `lastConfirmedOperatorId`), `decodeSessionIdClaim` (already in this file), `supabase` client from `@/data/supabase/client`

- [ ] **Step 1: Add `lastConfirmedOperatorId` to the device store**

In `src/store/device.store.ts`, add the new ref next to `deviceId`/`deviceCode` (around line 30):

```ts
  const deviceId   = ref<string>((import.meta.env.VITE_STUB_DEVICE_ID   ?? '') as string)
  const deviceCode = ref<string>((import.meta.env.VITE_STUB_DEVICE_CODE ?? '') as string)

  // WAFI-203: the last staff id the SERVER confirmed as this device's active
  // operator (set only on a successful switch_active_operator RPC call, in
  // lockstep with the JWT's staff_id claim actually changing). Lets a
  // returning/resuming operator re-establish their own identity fully
  // offline, since the JWT already carries their id from the earlier
  // confirmation — while a genuinely different identity still requires one
  // successful round trip. See docs/superpowers/specs/2026-07-22-wafi-203-operator-identity-design.md.
  const lastConfirmedOperatorId = ref<string | null>(null)
```

Update the store's `return` statement to include it:

```ts
  return { shopId, deviceId, deviceCode, lastConfirmedOperatorId, refreshShopId, ensureDeviceRegistered }
```

Update the `persist` option so it survives app restarts:

```ts
}, {
  // Persist shopId plus the claimed device identity, so an offline cold-start
  // reuses this device's registered code instead of re-registering.
  persist: { pick: ['shopId', 'deviceId', 'deviceCode', 'lastConfirmedOperatorId'] },
})
```

- [ ] **Step 2: Write the failing tests for `establishOperatorIdentity`**

Replace the three "offline fallback" tests inside the `describe('switch_active_operator RPC + forced session refresh (WAFI-122)', ...)` block in `src/features/staff/composables/__tests__/useOperatorSwitch.test.ts` (the ones named `'does not block the switch on offline RPC failure...'`, `'does not call the RPC (and does not refresh the session) when session_id decode fails...'`, and `'does not block the switch when supabase.rpc resolves an error object...'`) — their old "never block offline" assumption is exactly what this ticket removes. Replace the whole block with:

```ts
  describe('establishOperatorIdentity (WAFI-203)', () => {
    const cashier = { id: 'staff-1', name: 'Ahmed', role: 'cashier', permissions: {} } as any

    it('calls switch_active_operator with device_id/session_id/staff_id/pin, then refreshSession, then confirms', async () => {
      const { useDeviceStore }            = await import('@/store/device.store')
      const { establishOperatorIdentity } = await import('@/features/staff/composables/useOperatorSwitch')

      useDeviceStore().deviceId = 'device-1'

      const result = await establishOperatorIdentity(cashier, '1234')

      expect(getSessionMock).toHaveBeenCalledOnce()
      expect(rpcMock).toHaveBeenCalledWith('switch_active_operator', {
        p_device_id: 'device-1',
        p_session_id: 'session-abc',
        p_staff_id: 'staff-1',
        p_pin: '1234',
      })
      expect(refreshSessionMock).toHaveBeenCalledOnce()
      expect(result).toEqual({ status: 'confirmed' })
      expect(useDeviceStore().lastConfirmedOperatorId).toBe('staff-1')
    })

    it('skips the network entirely when staff.id already matches lastConfirmedOperatorId', async () => {
      const { useDeviceStore }            = await import('@/store/device.store')
      const { establishOperatorIdentity } = await import('@/features/staff/composables/useOperatorSwitch')

      useDeviceStore().lastConfirmedOperatorId = 'staff-1'

      const result = await establishOperatorIdentity(cashier, '1234')

      expect(result).toEqual({ status: 'offline-same-identity' })
      expect(getSessionMock).not.toHaveBeenCalled()
      expect(rpcMock).not.toHaveBeenCalled()
      expect(refreshSessionMock).not.toHaveBeenCalled()
    })

    it('throws on server-side PIN mismatch (RPC returns ok: false) — not treated as offline', async () => {
      rpcMock.mockResolvedValueOnce({ data: false, error: null })
      const { establishOperatorIdentity } = await import('@/features/staff/composables/useOperatorSwitch')

      await expect(establishOperatorIdentity(cashier, '9999')).rejects.toThrow(/pin/i)
      expect(refreshSessionMock).not.toHaveBeenCalled()
    })

    it('blocks (does not confirm) a NEW identity when the session_id claim cannot be decoded', async () => {
      getSessionMock.mockResolvedValueOnce({
        data: { session: { access_token: fakeAccessToken(null) } },
        error: null,
      })
      const { useDeviceStore }            = await import('@/store/device.store')
      const { establishOperatorIdentity } = await import('@/features/staff/composables/useOperatorSwitch')

      const result = await establishOperatorIdentity(cashier, '1234')

      expect(result.status).toBe('blocked')
      expect(rpcMock).not.toHaveBeenCalled()
      expect(refreshSessionMock).not.toHaveBeenCalled()
      expect(useDeviceStore().lastConfirmedOperatorId).toBeNull()
    })

    it('blocks a NEW identity when the RPC rejects (network error)', async () => {
      rpcMock.mockRejectedValueOnce(new Error('network error'))
      const { useDeviceStore }            = await import('@/store/device.store')
      const { establishOperatorIdentity } = await import('@/features/staff/composables/useOperatorSwitch')

      const result = await establishOperatorIdentity(cashier, '1234')

      expect(result.status).toBe('blocked')
      expect(refreshSessionMock).not.toHaveBeenCalled()
      expect(useDeviceStore().lastConfirmedOperatorId).toBeNull()
    })

    it('blocks a NEW identity when supabase.rpc resolves an error object instead of throwing', async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: new Error('offline') })
      const { useDeviceStore }            = await import('@/store/device.store')
      const { establishOperatorIdentity } = await import('@/features/staff/composables/useOperatorSwitch')

      const result = await establishOperatorIdentity(cashier, '1234')

      expect(result.status).toBe('blocked')
      expect(refreshSessionMock).not.toHaveBeenCalled()
      expect(useDeviceStore().lastConfirmedOperatorId).toBeNull()
    })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/features/staff/composables/__tests__/useOperatorSwitch.test.ts`
Expected: FAIL — `establishOperatorIdentity` is not exported yet (`SyntaxError` / `undefined is not a function`).

- [ ] **Step 4: Implement `establishOperatorIdentity` and `OperatorSwitchBlockedError`**

In `src/features/staff/composables/useOperatorSwitch.ts`, add after `decodeSessionIdClaim` and before the `useOperatorSwitch` JSDoc comment:

```ts
/** Thrown by `switchTo` when a genuinely new identity is attempted while
 *  offline. The caller should show `message` and leave the previous
 *  operator active — nothing local has changed. */
export class OperatorSwitchBlockedError extends Error {}

export type EstablishIdentityResult =
  | { status: 'confirmed' }
  | { status: 'offline-same-identity' }
  | { status: 'blocked'; reason: string }

const NEEDS_CONNECTIVITY_MESSAGE = 'تحتاج إلى اتصال بالإنترنت لتأكيد هويتك — حاول مرة أخرى'

/**
 * Establish `staff` as this device's server-confirmed active operator.
 *
 * WAFI-203: the JWT's `staff_id` claim and the locally-active operator must
 * never diverge. If `staff` is already this device's last-confirmed
 * identity, the JWT already carries their id from an earlier confirmation —
 * safe to proceed with no network call. Otherwise this is a genuinely NEW
 * identity for this device: it is only adopted once
 * switch_active_operator + refreshSession have both succeeded. On any
 * offline/network failure for a new identity, this returns `blocked` rather
 * than applying anything locally — the caller must not set the active
 * operator in that case.
 */
export async function establishOperatorIdentity(
  staff: Staff,
  pin: string,
): Promise<EstablishIdentityResult> {
  const device = useDeviceStore()

  if (device.lastConfirmedOperatorId === staff.id) {
    return { status: 'offline-same-identity' }
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token
  const sessionId = accessToken ? decodeSessionIdClaim(accessToken) : null

  if (sessionId === null) {
    // No genuine session_id to hand the RPC — see decodeSessionIdClaim's own
    // header comment for why this must never be passed through as a value.
    return { status: 'blocked', reason: NEEDS_CONNECTIVITY_MESSAGE }
  }

  try {
    const { data: ok, error } = await supabase.rpc('switch_active_operator', {
      p_device_id:  device.deviceId,
      p_session_id: sessionId,
      p_staff_id:   staff.id,
      p_pin:        pin,
    })

    if (error) {
      return { status: 'blocked', reason: NEEDS_CONNECTIVITY_MESSAGE }
    }
    if (!ok) {
      throw new Error('server-side PIN verification failed')
    }

    await supabase.auth.refreshSession()
    device.lastConfirmedOperatorId = staff.id
    return { status: 'confirmed' }
  } catch (e) {
    if (e instanceof Error && /pin/i.test(e.message)) throw e
    return { status: 'blocked', reason: NEEDS_CONNECTIVITY_MESSAGE }
  }
}
```

- [ ] **Step 5: Rewrite `switchTo` to use the shared helper**

Replace the entire body of `switchTo` (from `async function switchTo` through its closing brace) with:

```ts
  async function switchTo(staff: Staff, pin: string): Promise<void> {
    const from = session.activeStaff
    if (from?.id === staff.id) return // no-op: same operator, nothing to record

    const result = await establishOperatorIdentity(staff, pin)
    if (result.status === 'blocked') {
      throw new OperatorSwitchBlockedError(result.reason)
    }

    session.setActiveStaff(staff) // shift state is intentionally untouched
    await logOperatorSwitched(from?.id ?? null, from?.name ?? null, staff.id, staff.name)
  }
```

Remove the now-unused `useDeviceStore` import from the top of the file only if nothing else in the file uses it — it is no longer referenced directly inside `switchTo` (it's used inside `establishOperatorIdentity` instead, which is in the same file, so the import stays; no removal needed).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/features/staff/composables/__tests__/useOperatorSwitch.test.ts`
Expected: All tests PASS, including the two pre-existing tests `'sets the new active operator and does NOT touch the shift'` and `'writes an operator.switched audit row...'` (these still pass because a fresh Pinia in `beforeEach` means `lastConfirmedOperatorId` is `null`, `staff.id` differs from it, and the default `rpcMock`/`refreshSessionMock` resolve successfully — the `'confirmed'` path).

- [ ] **Step 7: Commit**

```bash
git add src/store/device.store.ts src/features/staff/composables/useOperatorSwitch.ts src/features/staff/composables/__tests__/useOperatorSwitch.test.ts
git commit -m "feat(wafi-203): add establishOperatorIdentity, block new identity while offline"
```

---

### Task 2: Wire `openShift`'s new-shift branch through `establishOperatorIdentity`

**Files:**
- Modify: `src/features/shifts/composables/useShift.ts`
- Modify: `src/features/shifts/composables/__tests__/useShiftZombieGuard.test.ts`
- Modify: `src/__tests__/features/useShift.deactivation.test.ts`

**Interfaces:**
- Consumes: `establishOperatorIdentity(staff, pin)` from Task 1 (`src/features/staff/composables/useOperatorSwitch.ts`)
- Produces: `openShift(staff: Staff, openingCashUsd: number, openingCashSyp: number, pin: string, openingBreakdown?: CurrencyBreakdown): Promise<OpenShiftResult>` — **signature change**: `pin` is now a required 4th parameter; `openingBreakdown` moves to 5th position (still defaults to `null`).
- Produces: `OpenShiftResult` gains a new variant: `{ status: 'identity-unconfirmed'; reason: string }`

- [ ] **Step 1: Write the failing tests**

In `src/features/shifts/composables/__tests__/useShiftZombieGuard.test.ts`, both existing tests that call `openShift` now need a `pin` argument and a mocked `supabase` client (this file currently has no such mock — `openShift`'s new-shift branch will otherwise hit the real client). Add the mock near the top of the file, right after the existing `vi.mock('@/data/powersync/db', ...)` line:

```ts
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      refreshSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'h.eyJzZXNzaW9uX2lkIjoic2Vzc2lvbi14In0.s' } },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))
```

(That access token's payload segment decodes to `{"session_id":"session-x"}` — a real base64url-encoded JSON payload, matching the shape `decodeSessionIdClaim` expects.)

Update the two calls that open a brand-new shift to pass a pin, and add one new test for the blocked/offline case:

```ts
  it('opens a fresh shift when none is open on the device', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)  // findOpenShiftForDevice → none
    const { openShift } = useShift()
    const res = await openShift(staffA, 10, 20, '1234')
    expect(res.status).toBe('opened')
    expect(vi.mocked(db.execute).mock.calls.some(insertShiftCall)).toBe(true)
  })
```

```ts
  it('reports a conflict when a DIFFERENT operator holds the device\'s open shift', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(openRow({ staff_id: 'staff-A' }) as any)
    const { openShift } = useShift()
    const res = await openShift(owner, 10, 20, '1234')
    expect(res.status).toBe('conflict')
    if (res.status === 'conflict') expect(res.shift.staffId).toBe('staff-A')
    expect(vi.mocked(db.execute).mock.calls.some(insertShiftCall)).toBe(false)
  })
```

(The `'resumes the SAME operator\'s existing open shift'` test is unchanged — the resume branch never establishes a new identity, so it does not need a `pin` argument. Leave its `openShift(staffA, 10, 20)` call as-is — TypeScript will need a 4th argument once the signature changes, so update it to `openShift(staffA, 10, 20, '1234')` too, purely to satisfy the type, even though the value is unused on that branch.)

Add a new test in the first `describe` block, after `'opens a fresh shift when none is open on the device'`:

```ts
  it('does NOT open a new shift when identity establishment is blocked (offline, new operator)', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)  // findOpenShiftForDevice → none
    const { supabase } = await import('@/data/supabase/client')
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('network error'))

    const { openShift } = useShift()
    const res = await openShift(staffA, 10, 20, '1234')

    expect(res.status).toBe('identity-unconfirmed')
    expect(vi.mocked(db.execute).mock.calls.some(insertShiftCall)).toBe(false)
  })
```

In `src/__tests__/features/useShift.deactivation.test.ts`, add the same `supabase` mock (this file also has no existing mock of it) right after its `vi.mock('@/data/powersync/db', ...)` line — reuse the identical mock block from above — and update both `openShift` calls to pass a pin:

```ts
    const { openShift } = useShift()
    const result = await openShift(staff, 10, 100000, '1234')
```

(applies to both tests in that file — the `'blocks a NEW shift on a deactivated device'` test and the `'missing device row / null flag = active'` test).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/shifts/composables/__tests__/useShiftZombieGuard.test.ts src/__tests__/features/useShift.deactivation.test.ts`
Expected: FAIL — TypeScript error (too many/too few arguments) or the new `'identity-unconfirmed'` test failing because `openShift` doesn't produce that status yet.

- [ ] **Step 3: Implement the signature and status change**

In `src/features/shifts/composables/useShift.ts`:

Add the import at the top of the file, alongside the existing imports:

```ts
import { establishOperatorIdentity } from '@/features/staff/composables/useOperatorSwitch'
```

Update the `OpenShiftResult` type (around line 104) to add the new variant:

```ts
export type OpenShiftResult =
  | { status: 'opened';   shiftId: string }
  | { status: 'resumed';  shiftId: string }
  | { status: 'conflict'; shift: CashierShift }
  // WAFI-130: this device was deactivated by the owner — no NEW shifts. An
  // already-open shift resumes/closes normally (the check runs before insert).
  | { status: 'device-deactivated' }
  // WAFI-203: this is a genuinely NEW operator identity for this device, and
  // the server could not confirm it (offline/network failure). No shift row
  // is created — the caller should show `reason` and let the cashier retry
  // once online, or resume as whoever this device's identity already was.
  | { status: 'identity-unconfirmed'; reason: string }
```

Update `openShift`'s signature and new-shift branch (replace lines 145–180, i.e. from the `async function openShift(` line through the `if (deviceRow && deviceRow.is_active === 0) { return { status: 'device-deactivated' } }` block):

```ts
  async function openShift(
    staff: Staff,
    openingCashUsd: number,
    openingCashSyp: number,
    pin: string,
    openingBreakdown: CurrencyBreakdown = null,
  ): Promise<OpenShiftResult> {
    // Guard: at most one open shift per device (WAFI-065 Part 1). The app-level
    // check is primary — offline-first can't rely on the DB partial unique index at
    // write time; the index (migration 026) is the backstop for anything that slips
    // through on sync/server.
    const existing = await findOpenShiftForDevice()
    if (existing) {
      if (existing.staffId === staff.id) {
        // Same operator returning to their own still-open shift → re-attach, never
        // create a second row. No new identity is being claimed, so no RPC call.
        session.setActiveStaff(staff)
        shiftStore.openShift(existing.id, staff)
        return { status: 'resumed', shiftId: existing.id }
      }
      // A different operator already holds the device's open shift → do not open a
      // second. Caller surfaces Story 5.3 (notify non-owner / owner force-close).
      return { status: 'conflict', shift: existing }
    }

    // WAFI-130 deactivation enforcement: a device the owner turned off cannot
    // open NEW shifts once the flag has synced. Enforced at the write layer,
    // not just UI. Resume (above) and close stay allowed so an in-flight shift
    // can finish cleanly. Missing row / null flag = active (legacy, offline
    // first-run) — never brick a working register on absent data.
    const deviceRow = await db.getOptional<{ is_active: number | null }>(
      `SELECT is_active FROM devices WHERE shop_id = ? AND code = ?`,
      [device.shopId, device.deviceCode]
    )
    if (deviceRow && deviceRow.is_active === 0) {
      return { status: 'device-deactivated' }
    }

    // WAFI-203: opening a brand-new shift for `staff` establishes a NEW
    // server-side identity for this device (there is no existing shift to
    // fall back to, unlike the resume branch above). This must be
    // server-confirmed before the shift is created — a blocked result means
    // no shift row is written and local state is untouched.
    const identity = await establishOperatorIdentity(staff, pin)
    if (identity.status === 'blocked') {
      return { status: 'identity-unconfirmed', reason: identity.reason }
    }
```

Leave everything from `const shiftId = crypto.randomUUID()` onward unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/shifts/composables/__tests__/useShiftZombieGuard.test.ts src/__tests__/features/useShift.deactivation.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run the full test suite to catch any other `openShift` call sites**

Run: `npx vitest run`
Expected: Any other test file calling `useShift()`'s `openShift` with the old 3-argument signature will now fail TypeScript/argument-count checks. At the time this plan was written, the only call sites are the two test files already updated in this task and `LockScreen.vue` (handled in Task 3). If `npx vitest run` surfaces a different failing file, add a `'1234'` (or any 4-digit string) pin argument to its `openShift(...)` call the same way, and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/features/shifts/composables/useShift.ts src/features/shifts/composables/__tests__/useShiftZombieGuard.test.ts src/__tests__/features/useShift.deactivation.test.ts
git commit -m "feat(wafi-203): require server-confirmed identity to open a new shift"
```

---

### Task 3: Update `LockScreen.vue` for the new signature and blocked/unconfirmed cases

**Files:**
- Modify: `src/features/shifts/components/LockScreen.vue`

**Interfaces:**
- Consumes: `openShift(staff, openingCashUsd, openingCashSyp, pin, openingBreakdown?)` from Task 2; `switchTo(staff, pin)` (unchanged signature, now throws `OperatorSwitchBlockedError` from Task 1) from `useOperatorSwitch`; `OperatorSwitchBlockedError` from `@/features/staff/composables/useOperatorSwitch`

This task has no automated test (it's a `.vue` component with no existing test file, matching the codebase's current testing pattern for `LockScreen.vue` — its logic is covered indirectly through `useShift`/`useOperatorSwitch` unit tests). Verify manually per Step 4.

- [ ] **Step 1: Store the entered PIN so it's available at the opening-cash step**

`onPinComplete` (the handler in `<script setup>`) receives `pin` as a parameter but never stores it — by the time `doOpen()` runs (after the cash-count step), the PIN is gone. Add a new ref near the other step state (next to `const selectedStaff = ref<Staff | null>(null)`, around line 40):

```ts
const selectedStaff  = ref<Staff | null>(null)
const enteredPin      = ref('')
```

In `onPinComplete`, right after the successful-PIN branch (`lockout.reset(s.id); authError.value = ''` — the two lines immediately before the `if (props.mode === 'switch')` check), store it:

```ts
  // Correct PIN — clear the failure counter for this operator.
  lockout.reset(s.id)
  authError.value = ''
  enteredPin.value = pin
```

In `back()` (the function that resets state when returning to the staff list), clear it alongside the other per-attempt fields:

```ts
function back() {
  step.value = 'pick-staff'
  selectedStaff.value = null
  authError.value = ''
  enteredPin.value = ''
  recovering.value = false
  ...
```

- [ ] **Step 2: Pass the pin through both `openShift` call sites and handle `identity-unconfirmed`**

The resume call (inside `onPinComplete`, login-mode branch — currently `await openShift(s, 0, 0)`):

```ts
    if (existing.staffId === s.id) {
      // Resume own open shift. openShift takes the resume branch and ignores the
      // (unused) cash args and pin; identity + store are re-established there.
      await openShift(s, 0, 0, enteredPin.value)
      await router.replace(resolveLanding(s))
      return
    }
```

The `doOpen()` function's call (currently 4 args ending in the tally/breakdown object) needs the pin inserted before it, and the new `identity-unconfirmed` status handled alongside the existing `conflict`/`device-deactivated` checks:

```ts
async function doOpen() {
  if (!selectedStaff.value) return
  loading.value = true
  try {
    const result = await openShift(
      selectedStaff.value,
      parseFloat(openingCashUsd.value) || 0,
      parseFloat(openingCashSyp.value) || 0,
      enteredPin.value,
      openingUseTally.value ? { usd: openingUsdBreakdown.value, syp: openingSypBreakdown.value } : null,
    )
    // A shift opened on this device between the PIN step and here (race) → surface
    // the same conflict flow rather than silently doing nothing.
    if (result.status === 'conflict') {
      conflictShift.value = result.shift
      step.value = 'conflict'
      return
    }
    // WAFI-130: the owner deactivated this device — no new shifts here.
    if (result.status === 'device-deactivated') {
      openError.value = 'هذا الجهاز موقوف من قبل المالك — لا يمكن فتح وردية جديدة عليه'
      return
    }
    // WAFI-203: this is a NEW identity for this device and the server could
    // not confirm it (offline). No shift was opened — stay on this step so
    // the cashier can retry once online.
    if (result.status === 'identity-unconfirmed') {
      openError.value = result.reason
      return
    }
    // Land on the right home before first paint: the owner and a reports-granted
    // manager get the dashboard; everyone else gets the POS, so an ungranted
    // operator never flashes the financial dashboard then bounces (WAFI-058).
    await router.replace(resolveLanding(selectedStaff.value))
  } finally {
    loading.value = false
  }
}
```

- [ ] **Step 3: Handle `switchTo`'s new blocked error in switch mode**

The `props.mode === 'switch'` branch inside `onPinComplete` currently calls `await switchTo(s, pin)` with no error handling (a thrown error would previously only happen on PIN mismatch, which can't reach here since PIN was already verified locally above). Now `switchTo` can also throw `OperatorSwitchBlockedError` for a new-identity-while-offline case. Update the import and the branch:

```ts
import { useOperatorSwitch, OperatorSwitchBlockedError } from '@/features/staff/composables/useOperatorSwitch'
```

```ts
  if (props.mode === 'switch') {
    try {
      await switchTo(s, pin)
    } catch (e) {
      if (e instanceof OperatorSwitchBlockedError) {
        authError.value = e.message
        return
      }
      throw e
    }
    // If the screen the previous operator was on is no longer permitted for the
    // new operator (e.g. Owner → ungranted Manager on the dashboard), bounce to
    // a permitted landing so financial views vanish immediately (WAFI-058). An
    // already-permitted route is left untouched — no needless yank to the
    // dashboard when switching back to the owner mid-POS.
    const required = router.currentRoute.value.meta.permission as keyof StaffPermissions | undefined
    if (!isRouteAllowed(required, s)) {
      await router.replace(resolveLanding(s))
    }
    emit('done')
    return
  }
```

- [ ] **Step 4: Manually verify in the running app**

Run: `npm run dev`

1. Open the app fresh (no prior operator on this device), pick a staff member, enter their PIN, complete the opening-cash step. Confirm the shift opens normally (this exercises the "new identity, online" path — requires the dev environment's Supabase connection to be reachable).
2. In DevTools, go offline (Network tab → Offline, or disable Wi-Fi). Use the in-app "switch operator" action to switch to a *different* staff member. Confirm you see the Arabic "needs internet" message (`openError`/`authError`) and that the previously active operator remains active (check `AppSidebar`/`AppBottomNav` still shows the original operator's name/permissions).
3. Still offline, switch back to the SAME operator who is already active (a no-op — `switchTo` returns early since `from?.id === staff.id`), confirming nothing breaks.
4. Go back online, retry the switch from step 2 — confirm it now succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/components/LockScreen.vue
git commit -m "feat(wafi-203): surface blocked/unconfirmed identity changes in the lock screen"
```

---

### Task 4: Checkout-time fail-closed gate in `usePayment.confirm()`

**Files:**
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/__tests__/features/usePayment.test.ts`

**Interfaces:**
- Consumes: `sessionStore.activeStaff` (already imported in `usePayment.ts` as `sessionStore`)

- [ ] **Step 1: Add a default active operator to the test file's shared setup**

`usePayment.test.ts`'s top-level `beforeEach` (lines 25–32) never sets an active operator today — only specific attribution tests do. Since `confirm()` is about to start throwing without one, add a default so every other test in the file keeps passing unless it explicitly overrides:

```ts
describe('usePayment', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    const { useSessionStore } = await import('@/store/session.store')
    useSessionStore().setActiveStaff({ id: 'default-op', name: 'موظف', role: 'cashier', permissions: {} } as any)
    const store = useSaleStore()
    store.clear()
    store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
    store.setLockedRate(14500)
    vi.clearAllMocks()
  })
```

- [ ] **Step 2: Write the failing test for the gate**

Add a new test, right after the existing `'attributes the sale to the active operator (staff_id) at confirm'` test:

```ts
  it('refuses to confirm a sale with no active operator (WAFI-203)', async () => {
    const { useSessionStore } = await import('@/store/session.store')
    useSessionStore().clearSession()
    setupTx({ cost_price_usd: 0, current_stock: 10 })

    const { selectMethod, confirm } = usePayment()
    selectMethod('card')

    await expect(confirm()).rejects.toThrow(/no active operator/i)
    expect(db.writeTransaction).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: FAIL — `confirm()` proceeds to call `db.writeTransaction` today regardless of `activeStaff`, so the `rejects.toThrow` assertion fails (no rejection occurs) and/or `db.writeTransaction` was called.

- [ ] **Step 4: Implement the gate**

In `src/features/payment/usePayment.ts`, inside `confirm()`, add the check as the very first line of the function body (before the existing idempotency guard):

```ts
  async function confirm(customerId?: string): Promise<CompletedSale> {
    // WAFI-203: a sale must always be attributable to a real operator — this
    // is the last line of defense before the write, matching the fail-closed
    // pattern already used by auth_permissions()/can() server-side. Both
    // openShift and switchTo now require server-confirmed identity before
    // setting this, so reaching here with no active operator means some
    // other code path skipped that gate.
    if (!sessionStore.activeStaff) throw new Error('No active operator — cannot complete sale')
    // Idempotency guard (WAFI-003): a confirm already in flight must not start a
    // second sale. Without this, a rapid double-tap or a held Enter writes a
    // duplicate sale row and burns a second receipt number. The catch path below
    // resets state, so a retry after a genuine failure is still allowed.
    if (state.value === 'confirming') throw new Error('Sale is already being confirmed')
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/features/usePayment.test.ts`
Expected: All tests PASS, including the new gate test.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: All PASS. This confirms no other test file drives `usePayment().confirm()` without an active operator (only `useFastCash.ts` wraps `confirm()` in production code, and it has no existing test file per the investigation behind this plan).

- [ ] **Step 7: Commit**

```bash
git add src/features/payment/usePayment.ts src/__tests__/features/usePayment.test.ts
git commit -m "feat(wafi-203): refuse to confirm a sale with no active operator"
```

---

### Task 5: Unblock the WAFI-202 migration and update the roadmap doc

**Files:**
- Modify: `supabase/migrations/064_wafi202_sales_immutability.sql`
- Modify: `WAFI_Production_Readiness_Plan_v3.md`

- [ ] **Step 1: Remove the migration's "do not apply" guard comment**

In `supabase/migrations/064_wafi202_sales_immutability.sql`, delete the header block (lines 1–15) that reads:

```sql
-- supabase/migrations/064_wafi202_sales_immutability.sql
-- ============================================================
-- !! DO NOT APPLY TO THE PRODUCTION SUPABASE PROJECT YET !!
-- ============================================================
-- This migration is gated on WAFI-203 ("Operator Identity Must Be
-- Server-Authoritative"), which has not shipped. Applying this migration
-- before WAFI-203 lands will REJECT EVERY NEW SALE for any shop whose
-- devices don't yet have an active-operator JWT staff_id claim -- which is
-- the current state of the pilot shop today (all sampled production
-- `sales` rows have staff_id = NULL). The strict `staff_id =
-- auth_staff_id()` INSERT policy below has no null/exception carve-out by
-- design (see the design spec's Blocking Prerequisite section) -- do not
-- add one to work around this; fix WAFI-203 first, then apply this
-- migration.
-- ============================================================
```

Replace it with:

```sql
-- supabase/migrations/064_wafi202_sales_immutability.sql
-- WAFI-203 ("Operator Identity Must Be Server-Authoritative") has shipped
-- (docs/superpowers/plans/2026-07-22-wafi-203-operator-identity.md): openShift
-- and switchTo now both require server-confirmed identity before adopting a
-- new operator, and usePayment.confirm() refuses to write a sale with no
-- active operator. This migration is safe to apply to the production
-- Supabase project.
```

(The rest of the file — the WAFI-202 explanation and the actual policy statements — is unchanged.)

- [ ] **Step 2: Update the roadmap doc's WAFI-203 row**

In `WAFI_Production_Readiness_Plan_v3.md`, find the WAFI-203 row in the Macro-Phase 1 table (currently starting `| WAFI-203 | Operator Identity Must Be Server-Authoritative | P0 | TBD (needs brainstorm) | ...`). Replace its **Effort** column value `TBD (needs brainstorm)` with `0.5 sprint` and append to the end of the **What It Builds** cell:

```
**Status: SHIPPED** — see docs/superpowers/plans/2026-07-22-wafi-203-operator-identity.md. `openShift` and `switchTo` now both require server-confirmed identity via a shared `establishOperatorIdentity` helper before adopting a new operator locally; same-identity re-entry stays fully offline via a persisted `lastConfirmedOperatorId`; `usePayment.confirm()` refuses a sale with no active operator. Migration 064 (WAFI-202) is unblocked for production.
```

Also update the WAFI-001 row's final sentence — currently `**Do not treat as done until WAFI-202 lands (migration merged, tests passing) + WAFI-203 lands (prerequisite for enabling it in production) + pentest/sign-off recorded.**` — change `+ WAFI-203 lands (prerequisite for enabling it in production)` to `+ WAFI-203 lands (SHIPPED — prerequisite satisfied)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/064_wafi202_sales_immutability.sql WAFI_Production_Readiness_Plan_v3.md
git commit -m "docs(wafi-203): unblock migration 064 for production, update roadmap status"
```

---

## Deliberately Not Applying the Migration Here

This plan ships the client-side prerequisite. Applying migration `064` to the **production** Supabase project (`supabase db push` against production, or the dashboard's migration runner) is a separate, higher-risk deploy action outside this plan's scope — it should be a deliberate step the user takes after reviewing that all four tasks above are merged and tested, not something bundled into this implementation plan.
