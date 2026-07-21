# WAFI-201: Investigate Role-Aware PowerSync Sync Buckets (Offline Confidentiality Gap)

**Type:** Spike | **Priority:** P2 | **Depends on:** WAFI-122

**Problem:** WAFI-122 closes direct-API role enforcement via RLS, but
PowerSync's own bulk-sync path bypasses RLS entirely (documented in
ADR-010). A cashier's synced device holds a full local copy of
role-restricted tables (staff, audit_log, other staff's sales) in SQLite,
regardless of RLS.

**Goal:** Determine whether this gap can be closed, and at what cost.

**Investigate:**
1. Current PowerSync version/edition's actual support for
   `subscription.parameter()`-based bucket branching — the prior attempt
   (ADR-009) returned zero rows; confirm whether this was a version
   limitation, a syntax error, or an edition-3 constraint, and whether a
   newer version fixes it.
2. Encrypted local SQLite as an independent mitigation (protects against
   device theft / rooted-device inspection even if sync stays unbranched).
3. Device attestation feasibility on the target hardware (cheap Android
   tablets, per CLAUDE.md's hardware section).
4. Cost/complexity of a from-scratch alternative: separate sync streams per
   role tier, if PowerSync itself cannot branch reliably.

**Definition of Done:** A written recommendation (accept the gap
long-term / fix via PowerSync config change / fix via encryption / fix via
custom sync-stream architecture), with an updated ADR-010 status.
