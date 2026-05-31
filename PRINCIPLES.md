# PRINCIPLES.md — Architecture Decision Rules
> Load this file for: decision-making, code generation, ADR creation, ASR identification.

---

## 1. ASR → ADR Pipeline

### When to write an ADR
| Signal | Action |
|--------|--------|
| Reversing this decision costs > 1 sprint | Write ADR |
| Decision affects > 1 team or component | Write ADR |
| Future developer would ask "why was this chosen?" | Write ADR |
| Technology stack, storage, protocol, auth, boundary | Write ADR |
| Folder structure, naming convention, UI colour | Code comment only |

### ADR Template (use verbatim)
```markdown
# ADR-[NUMBER] — [Short decision title]

| Field      | Value                                               |
|------------|-----------------------------------------------------|
| Date       | YYYY-MM-DD                                          |
| Status     | Proposed | Accepted | Deprecated | Superseded      |
| Deciders   | [Names or roles]                                    |
| Supersedes | ADR-NNN or None                                     |

## Context
What situation or problem is forcing this decision?
What constraints apply (technical, business, regulatory)?
What Quality Attribute(s) or ASR(s) is this addressing?

## Decision
What exactly was decided? Be specific.
What is the scope — what does this apply to and what does it NOT apply to?

## Alternatives Considered
| Option | Why Rejected |
|--------|-------------|
| ...    | ...         |

## Consequences
**Positive:**
- ...

**Negative / trade-offs:**
- ...

## Architecture Guidelines
HOW should this decision be implemented?
Patterns, naming conventions, enforcement rules.

## Review Date
When and under what conditions should this be revisited?
```

### ASR Identification Rules
- A requirement is an ASR if it forces a specific architectural choice
- Must be measurable: NOT "fast" — YES "p99 latency < 300ms at 5,000 concurrent users"
- Sources: performance targets, compliance requirements, team constraints, scalability needs
- If you cannot name the architectural decision an ASR forces → it is not an ASR

---

## 2. Code Generation Rules (SOLID + DRY + SoC)

Apply these rules to every function, class, and component generated.

### SOLID Checklist
```
S — Single Responsibility
  ✓ This unit has exactly one reason to change
  ✗ AVOID: one class handles business logic + persistence + notifications

O — Open/Closed
  ✓ New behaviour added by new code, not by editing existing working code
  ✗ AVOID: if/switch chains that grow with every new type

L — Liskov Substitution
  ✓ Every subtype can replace its parent without breaking callers
  ✗ AVOID: overriding methods to throw NotImplementedException

I — Interface Segregation
  ✓ Interfaces are small and specific; no method a class doesn't need
  ✗ AVOID: one large IService with 15 methods where implementations use 3

D — Dependency Inversion
  ✓ Depend on interfaces/abstractions, not concrete implementations
  ✓ Dependencies injected via constructor, not created internally
  ✗ AVOID: new ConcreteRepository() inside a service class
```

### DRY / KISS / YAGNI Rules
```
DRY  — Extract shared logic only when 3+ concrete uses exist
       Do NOT create abstractions speculatively
KISS — Prefer the simplest solution that correctly solves the problem
       Complexity requires explicit justification
YAGNI— Do NOT build for hypothetical future requirements
       Build for the concrete requirement in front of you
```

### Separation of Concerns — Layer Rules
```
Component/Controller  → handles input/output only, no business logic
Service/Use Case      → business logic only, no HTTP/DB/framework code
Repository            → data access only, no business logic
Composable/Hook       → reusable behaviour, no rendering
Template/View         → rendering only, no data fetching or business logic

VIOLATION SIGNAL: a unit imports from a layer more than one step away
```

### MVC / MVVM Rules
```
Model      → data + domain rules, no UI knowledge
View       → rendering only, binds to ViewModel, no logic
ViewModel  → transforms Model data for display, no rendering
Controller → routes input to the right Model operation

Vue3 mapping:
  ViewModel = composable (useXxx)
  View      = <template>
  Model     = store / server state / domain class
```

---

## 3. Quality Attribute Constraints

### Measurable Targets Template
```
Performance:    p95 latency < [Xms] under [Y] concurrent users
Availability:   [X]% uptime = [Y hours] downtime/month allowed
Scalability:    handles [X]× peak load without architecture change
Maintainability: new developer productive within [X] days
Security:       OWASP Top 10 addressed; secrets never in source control
Bundle size:    JS < [X]KB gzipped; CSS < [Y]KB gzipped
```

### SLI → SLO → SLA Rules
```
SLI = what you measure      (e.g. API response time in ms)
SLO = your internal target  (e.g. p99 < 200ms)
SLA = external commitment   (e.g. 99.9% requests < 500ms, breach = credit)

Error budget = 100% − SLO
When error budget exhausted → block risky deployments until restored
SLO must be stricter than SLA to maintain a safety buffer
```

### Fitness Function Enforcement Rules
```
Every architectural rule must have a corresponding automated check.

RULE → FITNESS FUNCTION mapping:
  "No cross-module internal imports"  → eslint-plugin-boundaries / import-linter
  "Bundle size < X KB"                → size-limit in CI
  "Performance target met"            → k6 load test in CI
  "Lighthouse score > X"              → Lighthouse CI
  "No known vulnerabilities"          → Snyk / Trivy in CI
  "API spec stays in sync"            → Danger.js rule on CI

A rule without enforcement is documentation, not architecture.
```

---

## 4. Decision Framework

### Problem-First Rule
```
NEVER choose a pattern before stating the problem.
FORMAT: "We have [specific problem]. It affects [who]. 
         The architectural quality attribute at risk is [QA].
         The decision is between [Option A] and [Option B]."
```

### Complexity Budget
| Pattern | Complexity Cost | Minimum Justification |
|---------|----------------|----------------------|
| Feature-first folders | Very Low | > 1 business domain |
| Hexagonal Architecture | Low | Any production app |
| Feature Flags | Low-Medium | Any user-facing feature |
| CQRS | Medium-High | Read/write workloads differ fundamentally |
| DDD Tactical | Medium | Complex business rules with invariants |
| Microservices | Very High | Multiple teams + deployment coupling |
| Event Sourcing | High | Audit trail or temporal queries required |
| Micro-Frontends | Very High | 4+ frontend teams, deployment bottleneck |

### Reversibility Test
```
Cost to reverse < 1 sprint  → move fast, document in PR
Cost to reverse > 1 sprint  → write ADR, get review
Cost to reverse > 1 quarter → ATAM session before deciding
```

### Trade-off Matrix
| Decision | Choose A when | Choose B when |
|----------|--------------|--------------|
| Monolith vs Microservices | < 3 teams, early product | 3+ teams, deployment coupling exists |
| REST vs GraphQL | One client type, simple data | Multiple clients, diverse data shapes |
| REST vs gRPC | Public API, browser clients | Internal services, high throughput |
| SQL vs NoSQL | Complex queries, relations | Simple lookups, horizontal write scale |
| Sync vs Async | Immediate feedback required | Failure isolation, decoupling needed |
| Build vs Buy | Core differentiator | Commodity infrastructure |
| RBAC vs ABAC | Stable job-function roles | Context-dependent, fine-grained access |
