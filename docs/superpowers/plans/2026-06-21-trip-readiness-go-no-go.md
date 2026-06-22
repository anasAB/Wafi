# Trip Readiness — Go / No-Go + Demo Runbook

> Date: 2026-06-21 · Owner: PO
> Purpose: the single decision doc for the Syria trip. Are we ready to put Wafi in front of customer #0 (the brother), and how does the trip actually run?
> Reframed goal (post-pivot): the trip is **demo + buy-in**, run on **sample data**. His real catalog loads after the trip; real daily use begins then.

---

## 1. GO / NO-GO gate

Ship only when every line is green. Each maps to work already done or in verification.

| Gate | Source | Status |
|---|---|---|
| Tier 1 correctness verified | verified 2026-06-21 (5/5, regression tests) | ✅ |
| Tier 2 accountability verified | verified 2026-06-21 (14/14, 46 tests) | ✅ |
| Tier 3 usability done | 6/7 done; WAFI-021 void path open (NOT a trip blocker) | ✅ (effectively) |
| Golden path passes (sync / offline / isolation) | passed 2026-06-22 (7/7, V6 isolation via RLS) | ✅ |
| Integration + release-readiness passes | passed 2026-06-22 (10/12; A1 463/463, all B green) | ✅ |
| Production build succeeds + deploys (not just dev) | A1 463/463 · A2 clean · A3 deploy ✅ | ✅ |
| Runs offline on the brother's actual device | C2 ✅ (golden-path V7); A4 + C1 = on-device smoke at setup | ⏳ on-site only |

**Two hard stops (no-go regardless of everything else):**
- **Cross-account isolation fails** (golden-path V6) — a tenant breach; do not ship.
- **Production build won't deploy** (integration A2/A3) — there's nothing to put on his device.

**Known, accepted limitations to state plainly (not blockers):**
- No receipt printing yet (he has no printer; descoped).
- Real inventory loads after the trip; demo runs on sample products.
- Tenant scoping runs on the single-shop stub (`VITE_STUB_SHOP_ID`) — correct for one shop; full multi-shop is the post-trip Auth epic.

---

## 2. Demo runbook (≈5 minutes — earn "when can I have it?")

Order it to hit the three demo moments with the strongest features first. Use 5–10 sample products added beforehand.

1. **"Runs on whatever you have."** Open it on a phone *and* a tablet/laptop — same shop, same data. Installed as an app from a link.
2. **Ring a sale.** Add items, dual currency USD/SYP, set the exchange rate live and watch prices update. Take a split payment. ~30 seconds.
3. **"Works without internet."** Turn off WiFi, ring two more sales, turn it back on — watch them sync. *(The moment. Rehearse it; it must be flawless.)*
4. **Business health.** Open the dashboard — money in, expenses, profit today; best sellers. "You can see if you made money today, on your phone."
5. **Customer credit.** Add a customer, ring a sale "على الحساب", show the running balance. (His shops live on credit.)
6. **Staff + accountability.** Open a shift, ring a sale, **switch operator** without closing the shift, show the Z-report per-operator breakdown and the audit log. "You can see who did what." *(He has staff — this lands.)*

Close: "This is on your phone, works when the net's down, no paper. Want to start using it in the shop?"

---

## 3. Getting him actually using it (the real goal)

The trip succeeds if he starts *using* it, not just watching a demo.

- Build his device with auto-sign-in to his account (Task 1) + the stub shop id.
- Add 10–20 of his real fast-movers by hand *with him* so day one isn't empty.
- Walk him through the daily loop: open shift → ring sales → check the dashboard → record a credit sale → close shift / Z-report.
- Set expectations: full catalog import + receipt printing come after the trip.

---

## 4. During the trip — collect (he is customer #0, the test)

- Where he hesitates or taps the wrong thing (UX friction).
- Any number he doesn't trust or that looks wrong (correctness regressions in the wild).
- Features he asks for unprompted (real v1.5 signal).
- Whether the offline moment actually held in his shop's connectivity.
- His staff's reaction to PIN + shift + switch.

---

## 5. Immediately after the trip (the post-trip queue)

1. **Load his real inventory** (white-glove import — you bring back the catalog).
2. **Re-run golden-path + integration with real data.**
3. Address trip feedback (jumps the queue per "brother's shop is the test").
4. Then the deferred epics, in order: **Auth & Self-Serve Onboarding** (so pilot #2 can onboard) → **Server-Side Role Enforcement**.
5. Remaining Tier-3 / P2 / P3 audit tickets by customer impact.

---

## 6. The verdict (2026-06-22)

> Ready: **GO** — Tier 1–3 verified, golden path 7/7 (incl. cross-account isolation via RLS), integration/release-readiness clean (463/463 tests, production build clean, deploy works, full end-to-end chain + operator switch + audit immutability + Manager/lockout all green).
>
> Outstanding (non-blocking, on-site only): **A4 PWA update pickup** and **C1 install** — both require the brother's actual device, done as a smoke test when setting up his device. Offline (C2) already proven via golden-path V7.
>
> Recommendation: de-risk A4 + a proxy install on **any** phone before flying (cheap, removes the last unknowns); final-confirm C1 on his device at setup. Real-catalog load is post-trip by design.
