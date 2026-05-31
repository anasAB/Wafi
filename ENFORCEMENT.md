# ENFORCEMENT.md — Automated Enforcement & Review Rules
> Load this file for: PR review, code generation validation, CI/CD setup, incident response.

---

## 1. PR Review Checklist

Run these checks before approving any PR. Flag violations explicitly.

### Code Quality (SOLID / SoC)
```
□ Each class/function has one reason to change (SRP)
□ New behaviour added without editing existing working code (OCP)
□ No constructor creates its own dependencies — injected only (DIP)
□ No interface forces a class to implement unused methods (ISP)
□ No business logic in controllers, templates, or route handlers (SoC)
□ No data access logic outside repository/service layer (SoC)
□ No logic duplicated across 3+ locations without extraction (DRY)
```

### Architecture Boundaries
```
□ No cross-feature internal imports (only via index.ts public API)
□ No service queries another service's database directly
□ No secret or credential in source code, .env file, or config committed to Git
□ State type matches owner: server data → TanStack Query, UI state → Pinia, URL state → route
□ New feature follows established folder structure
```

### Decision Documentation
```
□ If reversing this change costs > 1 sprint → ADR exists or is being created
□ If this introduces a new library → ADR exists
□ If this changes a public API contract → Contract tests updated
□ If this touches auth, payments, or PII → STRIDE checklist completed
```

### Fitness Functions (must pass in CI)
```
□ Bundle size within limits (size-limit)
□ Import boundaries not violated (import-linter / eslint-plugin-boundaries)
□ Lighthouse scores not regressed (Lighthouse CI)
□ No new high/critical vulnerabilities (Snyk / Trivy)
□ All unit tests passing
□ Contract tests passing (if inter-service change)
```

---

## 2. CI Fitness Function Setup

### Bundle Size (size-limit)
```json
// package.json
"size-limit": [
  { "path": "dist/assets/*.js",  "limit": "200 KB" },
  { "path": "dist/assets/*.css", "limit": "30 KB"  }
]
```

### Import Boundaries (import-linter)
```
// .importlinterrc
[rules.no-cross-feature-internals]
from    = { pathPattern: "src/features/**" }
forbid  = ["src/features/*/internal/**"]
allow   = ["src/features/*/index.ts"]
```

### Lighthouse CI
```js
// lighthouserc.js
module.exports = {
  assert: {
    assertions: {
      'categories:performance':   ['error', { minScore: 0.85 }],
      'categories:accessibility': ['error', { minScore: 0.90 }],
    }
  }
}
```

### Danger.js — API Spec Sync Rule
```js
// Dangerfile.js
const apiChanged  = danger.git.modified_files.some(f => f.startsWith('src/api/'));
const specChanged = danger.git.modified_files.some(f => f.includes('openapi.yaml'));
if (apiChanged && !specChanged) {
  fail('API files changed but openapi.yaml not updated. Keep the spec in sync.');
}
```

### k6 — API Latency Fitness Function
```js
export let options = {
  thresholds: { 'http_req_duration': ['p(95)<300'] },
  vus: 100, duration: '30s'
};
```

---

## 3. Security Enforcement Checklist

### Pre-Deploy Security Gate
```
□ No secrets in source code (git-secrets / truffleHog scan)
□ All dependencies scanned for known CVEs (Snyk / Dependabot)
□ STRIDE checklist completed for any auth/payment/PII feature
□ New external integrations reviewed by security owner
□ No new OWASP Top 10 violations introduced
□ mTLS enforced between services in service mesh (if applicable)
```

### Secrets Hygiene Rules
```
□ No .env files with real values committed
□ All secrets fetched from secret store at runtime (Vault / AWS Secrets Manager)
□ Rotation policy defined for all credentials
□ Access audit trail enabled on secret store
□ Docker images contain no secrets (verified by image scan)
```

---

## 4. Incident Response Runbook Structure

Every P1/P2 alert must have a runbook with this exact structure before the alert is enabled:

```markdown
# Runbook: [Alert Name]

## What this alert means
One sentence: what condition triggered this.

## Severity
P1 / P2 / P3 — definition and escalation path.

## Step 1: Immediate triage
What to check first (dashboard link, log query, health endpoint).

## Step 2: Common causes
| Symptom | Likely cause | Resolution |
|---------|-------------|------------|
| ...     | ...         | ...        |

## Step 3: Escalation
If not resolved in [X] minutes → page [role/person].

## Step 4: Communication
Status page template: "[Service] is experiencing [impact]. We are investigating. Next update: [time]."

## Post-incident
Link to postmortem template.
```

### Severity Definitions
```
P1: Service down or severely degraded for all users
    → Page on-call immediately, no acknowledgement timeout
    → Status page update within 5 minutes

P2: Significant subset of users impacted
    → Page on-call, 15-minute acknowledgement window
    → Status page update within 15 minutes

P3: Minor degradation, some users affected
    → Slack notification, fix during business hours

P4: No user impact, preventive action needed
    → Ticket in next sprint
```

### Blameless Postmortem Template
```markdown
# Postmortem: [Incident Title] — [Date]

## Impact
Duration: X minutes | Users affected: N | Severity: P1/P2

## Timeline (factual, no blame)
| Time  | Event |
|-------|-------|
| HH:MM | ...   |

## Root Cause(s)
System weaknesses, not human errors.

## Contributing Factors
What made detection or resolution harder than it needed to be?

## What Went Well
...

## Action Items
| Item | Owner | Due date |
|------|-------|----------|
| ...  | ...   | ...      |
```

---

## 5. Architecture Review Triggers

### When to run a formal Architecture Review
```
TRIGGER → ACTION
New service being created                              → ADR required
New external integration (3rd party API, vendor)       → ADR + STRIDE
Changing auth or authorisation mechanism               → ADR + STRIDE + ARB review
Data schema change affecting multiple services         → ADR + Contract test update
Introducing new infrastructure component               → ADR + IaC PR
Team restructuring or ownership change                 → Conway's Law review
Performance degrading below SLO                        → Fitness function audit
```

### Architecture Review Board (ARB) — Async Process
```
1. Submit ADR as PR to /docs/adr/
2. Reviewers comment within 48 hours
3. Decision recorded as PR comment: Approved / Approved with conditions / Rejected
4. Conditions must be resolved before merge
5. All decisions visible in Git history — no off-record approvals
```

---

## 6. Data Architecture Enforcement

### Zero-Downtime Migration Rules
```
ALLOWED in a single migration:
  ✓ ADD COLUMN with a DEFAULT (or nullable)
  ✓ CREATE INDEX CONCURRENTLY
  ✓ CREATE TABLE
  ✓ DROP INDEX CONCURRENTLY (Postgres)

NEVER in a single migration against a live table:
  ✗ ADD COLUMN NOT NULL without DEFAULT
  ✗ DROP COLUMN (use expand-contract: deprecate first, remove later)
  ✗ RENAME COLUMN (add new, migrate, drop old — three separate deployments)
  ✗ Data backfills inside a migration (use background job)
```

### Event Schema Compatibility Rules
```
Safe (backward compatible):
  ✓ Add optional field
  ✓ Add new event type

Requires migration window (both schema versions live simultaneously):
  ⚠ Remove field
  ⚠ Rename field
  ⚠ Change field type

NEVER:
  ✗ Remove field without deprecation period
  ✗ Change field semantics without versioning the event type
  ✗ Deploy consumer before producer is emitting new schema
```

---

## 7. Project-Specific Overlay Template

Create `PROJECT_CONSTRAINTS.md` in every repository using this structure:

```markdown
# PROJECT_CONSTRAINTS.md

## Base Reference
Applies all rules from: PRINCIPLES.md, PATTERNS.md, ENFORCEMENT.md

## Architecture Style
[e.g. Modular Monolith / Microservices / Layered]

## Confirmed ASRs
| ASR | Quality Attribute | Architectural implication |
|-----|------------------|--------------------------|
| ... | ...              | ...                       |

## Active ADRs
| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | ... | Accepted |

## State Ownership Boundaries
| State type | Owner | Tool |
|-----------|-------|------|
| Server state | TanStack Query | useQuery / useMutation |
| UI state | Pinia | useXxxStore |
| URL state | Vue Router | route.params / route.query |

## Fitness Functions Active
| Rule | Tool | Threshold | CI step |
|------|------|-----------|---------|
| Bundle size | size-limit | JS < 200KB | build |
| Import boundaries | import-linter | zero violations | lint |

## Team → Service Ownership
| Team | Owns | Communication mode |
|------|------|--------------------|
| ... | ... | ... |

## Current Technical Debt Register
| Item | Impact | Sprint targeted |
|------|--------|----------------|
| ... | ... | ... |
```
