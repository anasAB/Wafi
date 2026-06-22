# Golden-Path Verification Runbook

> Type: verify-and-fix (not a build plan). Owner: the free dev.
> Goal: prove the brother's shop actually works end-to-end on a production build — signed in, syncing, offline-capable, isolated — with **sample data** (real inventory loads post-trip).
> Independent of Tier 1/2/3 feature work. Not blocked by inventory.

## Why this is the priority
Provisioning is done and sync streams are deployed, but the acceptance criteria that decide whether the product *functions* (Task 1 AC1/3/5/7, Task 2 isolation, the `powersync.yaml` deploy) have **never been verified**. A broken sync/offline path makes every feature fix moot. Verify first; fix what fails.

## Setup (once)
- Production build with: `VITE_DEV_AUTO_SIGNIN=true`, the brother's account creds (`VITE_DEV_SUPABASE_EMAIL`/`PASSWORD`), `VITE_SUPABASE_URL`/`ANON_KEY`, `VITE_POWERSYNC_URL`, and the trip workaround `VITE_STUB_SHOP_ID` = his real shop id (WAFI-001 stub).
- A throwaway second Supabase account (for the isolation check), provisioned to a *different* shop.
- A few sample products added by hand (no real catalog needed).

## Checks — each is PASS/FAIL; on FAIL, fix then re-run

- [ ] **V1 — Sync rules deploy (do first).** Paste `powersync.yaml` into the PowerSync dashboard Sync Streams editor and save. PASS = saves with no validator error. FAIL → switch to the parameter-query form written in the file's own comments (lines ~19-27), re-save. *Nothing else can pass until this does.*

- [ ] **V2 — Opens signed in (Task 1 AC1).** Launch the prod build in a browser tab. PASS = lands on Home already authenticated, no login screen, and sample data syncs down. FAIL → check `bootstrapDevAuth` runs in PROD when the flag is set (Task 1 change), and the connector's `fetchCredentials` returns a token.

- [ ] **V3 — Rings + syncs a sale.** Ring a sample sale. PASS = it appears in `public.sales` for the stub shop id; no 403 in console. FAIL → inspect the upload error surfaced by `useSync` (RLS reject = shop_id mismatch).

- [ ] **V4 — Offline reload (Task 1 AC3).** Turn off network, reload the tab. PASS = app opens on the persisted session, POS usable, a sale queues locally. Turn network back on → queue syncs (indicator yellow→green). FAIL → check session persistence + service-worker shell caching.

- [ ] **V5 — PWA == tab (Task 1 AC5/AC7).** Install the PWA; open it. PASS = same shop, same data as the browser tab. FAIL → same-origin/session issue.

- [ ] **V6 — Cross-account isolation (Task 2).** Sign in the throwaway second account (separate browser profile/incognito). PASS = it sees **none** of the brother's products/sales/customers/etc. Re-confirm via SQL impersonation if needed. FAIL → **stop and escalate** — this is a tenant-isolation breach (RLS / sync-rule scoping), the most serious possible failure.

- [ ] **V7 — Offline → online resilience.** Repeat V4's offline→online cycle ~10 times with sales each time. PASS = no data loss, no duplicate sale numbers, indicator recovers cleanly every time.

## Output
- A short pass/fail report per check, with any fixes made (file:line) and any FAILs that needed escalation.
- If V1 or V6 fail, flag immediately — those are trip-blocking / security-blocking respectively.

## Notes
- This exercises the same paths the brother will use; doing it now (with sample data) means the only post-trip step is loading his real catalog into an already-proven product.
- Coordinate file-wise: fixes here are likely in `data/powersync/`, `data/supabase/`, `store/device.store.ts`, `features/sync/` — disjoint from the Tier 1/3 feature files, so safe alongside them.
