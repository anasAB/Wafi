# PATTERNS.md — Architecture Patterns Reference
> Load this file for: pattern selection, integration decisions, data layer design, frontend architecture.

---

## 1. Architecture Style Selection

### Style → Use-Case Mapping
| Style | Use When | Avoid When |
|-------|----------|------------|
| **Monolith** | < 3 teams, early product, simple deployment | Multiple teams blocked by each other |
| **Modular Monolith** | Growing team, need boundaries, not ready for services | True independent scaling required |
| **Microservices** | 3+ teams, independent deployment critical, services scale differently | Small team, immature DevOps, early product |
| **Event-Driven (EDA)** | Decoupled consumers, audit trail needed, async acceptable | Strong consistency required across systems |
| **SOA** | Enterprise integration across many legacy systems | Single-team product |
| **Hexagonal** | Any production app — testability and infrastructure swappability | Simple scripts / one-off tools |
| **Serverless** | Infrequent/variable workloads, background jobs, webhooks | Always-on, long-running, latency-critical |
| **Layered** | Web APIs, clear code organisation priority | Complex domain with many invariants |

### DDD — Apply When
```
USE DDD when:
  - Complex business rules that change frequently
  - Multiple teams with different models of the same domain
  - Regulated domain (finance, healthcare, insurance)
  - Domain experts available to collaborate with

AVOID DDD when:
  - Simple CRUD application
  - No access to domain experts
  - Shallow domain (forms in, records out)
```

### CQRS + Event Sourcing — Decision Rules
```
Use CQRS when:
  - Read and write workloads have fundamentally different scaling needs
  - Read model requires different shape than write model

Add Event Sourcing when:
  - Full immutable audit trail required
  - Temporal queries needed ("what was state at time T?")
  - Regulatory compliance demands it

NEVER add for: convenience, trend-following, or small teams without experience
```

---

## 2. Component & System Design

### Bounded Context Rules
```
- Each Bounded Context has its own Ubiquitous Language
- External objects reference only the Aggregate Root, never internal entities
- Contexts communicate via: API, Events, or Anti-Corruption Layer
- One team owns one context — context boundaries map to team boundaries
- Share only IDs across context boundaries, never entities
```

### Aggregate Root Rules
```
- All mutations to aggregate internals go through the Root
- One transaction modifies one aggregate only
- Use eventual consistency across aggregate boundaries
- Keep aggregates small — only include what must change together
- Root enforces all business invariants for the aggregate
```

### Resilience Patterns
| Pattern | Problem it solves | Trigger |
|---------|------------------|---------|
| **Circuit Breaker** | Cascading failure from slow downstream | Any outbound HTTP/service call |
| **Bulkhead** | Resource exhaustion spreading across services | Services with different criticality |
| **Saga** | Distributed transaction across services | Multi-step business process, no 2PC |
| **Retry with backoff** | Transient failures | Idempotent operations only |

### Strangler Fig — Migration Rules
```
1. Put a routing proxy (API Gateway / Nginx) in front of the legacy system
2. Implement the smallest isolated feature in the new system first
3. Route that feature's traffic to the new system
4. Test, verify metrics, then move to the next feature
5. Decommission legacy when all routes are migrated

NEVER: big-bang rewrite, no proxy, no incremental verification
```

---

## 3. Integration & Communication

### Protocol Selection Matrix
| Scenario | Protocol | Reason |
|----------|---------|--------|
| Public API, browser clients | REST | Universal support, cacheable |
| Multiple frontend clients, diverse data needs | GraphQL | Client-defined queries, reduces round trips |
| Internal service-to-service, high throughput | gRPC | Binary protocol, typed contracts, streaming |
| Async decoupled consumers | Message Queue | Temporal decoupling, retry, guaranteed delivery |
| Real-time bidirectional | WebSocket | Persistent connection, low latency |

### API Gateway vs BFF Rules
```
API Gateway: always, for any microservices system
  - Handles: auth, rate limiting, routing, SSL termination, logging

BFF (Backend for Frontend): add when
  - Multiple client types with different data shapes (mobile ≠ web)
  - Frontend team needs to own their API contract
  - API calls per screen exceed 3 (aggregation needed)
```

### Contract Testing Rules (Pact)
```
Consumer writes: the interaction (request + expected response) as a Pact test
Provider verifies: runs contract against its implementation — no consumer running needed
Pact Broker: stores contracts, answers "can I deploy?" before every release

USE when: multiple teams own services that call each other, independent deployment
SKIP when: monolith, same team owns both consumer and provider
```

---

## 4. Security Baselines

### Zero Trust Rules (apply to every system)
```
✓ Every request authenticated — no implicit trust from network location
✓ Every request authorised — verify permissions on every call
✓ Least privilege — grant minimum permissions required for the specific job
✓ Assume breach — design as if attacker is already inside
✓ Continuous verification — re-verify regularly, not just at login
```

### STRIDE Threat Modeling Checklist
Run on every new feature touching auth, payments, or external integrations:
```
S — Spoofing:            Can someone pretend to be another user or service?
T — Tampering:           Can data be modified in transit or at rest?
R — Repudiation:         Can someone deny performing an action?
I — Information Disclosure: Can sensitive data be exposed to unauthorised parties?
D — Denial of Service:   Can the endpoint be overwhelmed or made unavailable?
E — Elevation of Privilege: Can someone gain more access than intended?

For each threat found: assign severity (Critical/High/Medium/Low) + mitigation owner
```

### Secrets Management Rules
```
NEVER:
  ✗ Secrets in source code
  ✗ Secrets in .env files committed to Git
  ✗ Hardcoded credentials anywhere in the repository
  ✗ Secrets baked into Docker images

ALWAYS:
  ✓ Secrets fetched at runtime from secret store (Vault, AWS Secrets Manager, Azure Key Vault)
  ✓ Same Docker image runs in every environment — only injected secrets differ
  ✓ Short-lived credentials with automatic rotation where possible
  ✓ Every secret access logged with timestamp, service, and source IP
```

### IAM Decision Rules
```
Use RBAC when:  access rules are stable and defined by job function
Use ABAC when:  access depends on context (time, location, data classification, department)
Use OAuth 2.0:  any integration with third-party identity providers
Use OIDC:       when you need identity (who is the user) in addition to authorisation
Use SSO:        enterprise environments with multiple internal applications

NEVER roll your own authentication — use Auth0, Okta, AWS Cognito, Supabase Auth
```

---

## 5. Frontend Architecture Rules

### State Ownership Decision Tree
```
Q1: Should this state survive a page refresh / be shareable as a URL?
    YES → URL State (route params, query string)

Q2: Does this data come from the server and can it become stale?
    YES → Server State (TanStack Query / SWR)

Q3: Do 2+ unrelated components need this state?
    YES → Shared UI State (Pinia / Zustand / Vuex)

DEFAULT → Local Component State (ref / useState)

RULE: Lift state only as high as the highest component that genuinely needs it.
      Never put server state in a global client store.
```

### Component Architecture Rules
```
Feature-first structure for applications (not component libraries):
  /features/[feature]/
    index.ts          — public API only
    [feature].vue     — entry component
    use[Feature].ts   — composable (ViewModel)
    [feature].types.ts
    [feature].api.ts

Shared UI components only in /components/ui/
  Rule: if it has domain knowledge → belongs in /features/
  Rule: if it is purely presentational, domain-agnostic → belongs in /components/ui/

Fitness function: no cross-feature internal imports
  import from features/checkout/index.ts ✓
  import from features/checkout/internal/helper.ts ✗
```

### Build & Bundle Rules
```
Minimum (apply from day one):
  - Route-based code splitting via dynamic imports on every route
  - Bundle size fitness function: JS < 200KB gzipped, CSS < 30KB gzipped

Apply when Lighthouse score < 85 or bundle > threshold:
  - Feature-based splitting: heavy features loaded on navigation
  - defineAsyncComponent() for components > 20KB

Tree-shaking prerequisites:
  - Mark modules as sideEffect-free in package.json
  - Use named exports, not default exports for utilities
```

### Design System Token Rules
```
Token hierarchy (never skip levels):
  Global tokens  → --color-blue-500
  Semantic tokens → --color-brand-primary
  Component tokens → --button-background

Components ALWAYS reference semantic tokens, never global tokens directly.
Themes override semantic tokens only.
```

---

## 6. Data Architecture Rules

### Database Architecture Decision Rules
```
Add read replica when:     primary CPU > 60% at peak, reads dominate
Shard when:                single primary cannot handle write throughput after vertical scaling
Multi-region Active-Active: only when write availability during regional outage is contractual
Multi-region Active-Passive: disaster recovery + read latency for distant users

Zero-downtime migration pattern (always):
  1. Expand  — add new column/table (backward compatible, old code still works)
  2. Migrate — backfill data in background batches, never in the migration itself
  3. Deploy  — release code using new column
  4. Contract — remove old column in a later migration

NEVER: ALTER TABLE ADD COLUMN NOT NULL without DEFAULT on a live table with data
```

### Data Architecture Rules
```
Event schema = service contract:
  - Additive changes (new optional fields) → backward compatible, safe
  - Removing or renaming fields → breaking change, requires migration period
  - Use schema registry to enforce compatibility level explicitly

OLTP vs OLAP:
  - OLTP database (Postgres, MySQL): operational reads/writes only
  - Never run analytical queries on OLTP database in production
  - Analytical workloads → dedicated OLAP store (BigQuery, Snowflake, ClickHouse)

Data ownership:
  - Every piece of data has exactly one system of record
  - Other systems cache/copy but treat their copy as non-authoritative
  - When copies drift, the system of record wins

Data classification (apply from first PII collected):
  Public | Internal | Confidential | Restricted (PII/PHI/PCI)
  Classification drives: encryption, access control, retention, audit requirements
```

---

## 7. Cloud & Delivery Rules

### CI/CD Pipeline Rules
```
Every commit must pass:
  ✓ Unit tests
  ✓ Fitness functions (bundle size, import boundaries, lint)
  ✓ Security scan (Snyk / Trivy)
  ✓ Contract tests (if inter-service changes)

Deployment gates:
  Staging  → automated tests pass
  Production → staging verified + error budget not exhausted
```

### Feature Flag Rules
```
Types:
  Release flag   — hide unfinished work in production
  Experiment flag — A/B test, percentage rollout
  Kill switch    — instant disable without deployment
  Permission flag — premium feature access

Lifecycle rules:
  ✓ Every flag has: owner, purpose, removal condition, max-age
  ✗ No flag survives > 3 months without documented extension
  ✗ Flags are not a substitute for branching strategy
```

### Environment Parity Rules
```
Staging must match production in:
  ✓ Same Docker images (not just same code)
  ✓ Same configuration key names (different values)
  ✓ Same external service versions
  ✓ Same Kubernetes configuration

NEVER:
  ✗ Config key exists in production but not staging
  ✗ Staging data volume differs by > 100× from production without documented reason
```

### GitOps Rules
```
✓ All infrastructure state declared in Git
✓ All changes via pull request — no manual infrastructure changes
✓ GitOps agent (ArgoCD / Flux) continuously reconciles live state to Git state
✗ Secrets never in Git — use External Secrets Operator or Vault sidecar
```

---

## 8. Team & Architecture Alignment

### Conway's Law Rules
```
RULE: Your system architecture will mirror your team communication structure.
      Design team structure to produce the architecture you want — not the reverse.

Inverse Conway Manoeuvre:
  WANT microservices? → Create teams with end-to-end service ownership first
  WANT modular monolith? → Create feature-aligned teams with clear ownership

WARNING SIGNAL: Multiple teams own one service → expect tight coupling
WARNING SIGNAL: One team owns multiple services → expect chatty inter-service calls
```

### Team Topologies Rules
```
Stream-Aligned Team:  owns a user-facing value stream end-to-end
                      has all skills to ship without waiting for other teams

Platform Team:        provides self-service internal capabilities
                      measured by: do stream teams unblock themselves?
                      FAILURE MODE: platform team with a slow ticket queue

Enabling Team:        temporary specialists who teach, then leave
                      NEVER a permanent dependency or approval gate

Complicated Subsystem: only for genuinely rare expertise (ML, crypto, real-time engine)
```
