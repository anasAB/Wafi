# WAFI Product Constitution

## Purpose and scope

This document states the non-negotiable domain invariants of WAFI — the
things that must always be true regardless of which feature, screen, or
engineer touches the system next. These are not implementation choices,
technology preferences, or coding conventions; they are the rules a shop
owner is implicitly trusting the moment they let WAFI record their money,
their stock, and their staff's actions.

A law belongs here only if violating it can make WAFI financially
incorrect, break a fundamental product guarantee, or produce inconsistent
behavior across the system. "Use Vue composables for business logic" is an
implementation convention and can legitimately change. "A completed sale is
never silently rewritten" cannot — no future architecture makes that
acceptable.

This document currently holds **eight laws**. That number was not chosen in
advance; it is what a full evidence-based audit of the existing codebase
supported, followed by an adversarial review that found two of an earlier
nine-law draft were artificially separated and merged them. A law is added,
merged, or split here only when the same rigor — real evidence, not
aspiration or a round number — justifies it.

Each law is independently testable: for any given code change, it must be
possible to say whether that specific law was violated without the answer
depending entirely on another law's evidence. Where two candidate laws
could only ever be violated together, they are one law, not two.

## Relationship to other documents

- **This document** states *what must always be true*.
- **Architecture documents** (`docs/architecture/ARCHITECTURE.md`,
  `DATA_MODEL.md`, `API_CONTRACTS.md`, etc.) describe *how the system
  currently realizes these laws* — the specific tables, RLS policies,
  columns, and code paths. Those mechanisms may be replaced or improved
  over time without changing the law itself.
- **`docs/architecture/PRODUCT_CONSTITUTION_COMPLIANCE.md`** tracks
  *whether the current codebase actually satisfies each law today*,
  including known gaps. This document never claims current compliance —
  that is the compliance matrix's job, and it is expected to change far
  more often than this one.
- **Feature specs** must comply with both this document and the
  architecture docs describing current mechanisms.
- **`AI_PRINCIPAL_ENGINEER_REVIEW.md`** is the enforcement mechanism: its
  mandatory Constitution Check requires every design and every final
  review to state which laws a feature touches and how the design
  preserves them.

A law's own wording never references a specific table name, RPC, or
mechanism as part of the rule itself — those appear only under "Examples,"
so that replacing a mechanism later never obsoletes the law that mechanism
was serving.

---

## Law 1 — Recorded facts are immutable; corrections create new facts

**Statement:** Once a fact is recorded as part of WAFI's durable history —
a sale, a payment, a ledger entry, an audit record, a product change, a
device event, a staff action, or any other event WAFI treats as having
happened — it is not silently rewritten or deleted. This applies whether
the fact is financial or not: the same guarantee protects a completed sale
and a product-catalog change alike. A correction, reversal, or supersession
is always represented as its own new fact, never as an edit to the
original.

**Why:** The moment a shop owner — or an engineer debugging a dispute —
discovers that a past record quietly changed, every record WAFI has ever
kept becomes suspect. This is true whether the changed record was a sale
total or a staff action log; a history that can be silently rewritten
after the fact is not a history, it's a current snapshot pretending to be
one.

**Forbidden:**
- Updating a historical record to change what it originally recorded.
- Deleting a record to erase or conceal a prior fact.
- Mutating a ledger row in place instead of recording the correcting event
  as a new row.
- Rewriting an audit or event record to reflect a later state rather than
  the state at the time it was recorded.

**Allowed:**
- Appending a correcting, reversing, superseding, or settlement event that
  references the record it corrects.
- Persisting an immutable snapshot of a moment (e.g. a shift close) so
  later reads never depend on anything that could change afterward.
- Maintaining a separate, explicitly mutable *current-state* view (e.g. an
  outstanding balance) alongside the immutable history it's derived from —
  as long as the history itself is never the thing being mutated.
- Rebuilding a derived projection from that immutable history (see Law 3).

**What this law does NOT cover:** whether a past record's *meaning* can
shift because something *else* — a timezone, an exchange rate, a price —
changed after the fact. A record can be perfectly unmutated and still be
misinterpreted if its meaning is recomputed from current settings instead
of what was true when it was recorded. That failure mode is Law 2's, not
this one — this law is about whether the record itself changed, not about
how it's later interpreted.

**Examples:** sale, payment, and return tables with insert-only write
policies, closing an exploit that previously let a session mutate a
completed sale's total; an append-only activity/audit log enforced by both
dropped write policies and a hard-failing trigger; a domain-event stream
with no update/delete path at all, covering financial and non-financial
facts alike (a product change, a device registration, and a sale are all
"events" under the same guarantee); a shift-close snapshot read back
verbatim on every later view rather than recomputed; a return recorded as
its own new fact linked to the original sale, never an edit to it.

---

## Law 2 — Historical meaning is fixed at write time

**Statement:** A past result is determined by the state of the world at the
moment it occurred, captured and stored then — never recomputed later from
whatever configuration currently happens to be in effect. This applies to
dates, exchange rates, prices, permissions, and any other value that can
change over the shop's lifetime.

**Why:** A shop's timezone, exchange rate, or a product's price are all
things an owner might legitimately change tomorrow. If a past report's
meaning is silently reinterpreted through today's version of that
configuration, the report is no longer describing what actually happened —
it's describing what *would have* happened if today's settings had always
been true, which is a different, false claim being presented as history.
This is distinct from Law 1: the underlying record can be perfectly
unmutated and this failure can still occur, purely because something it
depends on for interpretation was allowed to be read live instead of
captured once.

**Forbidden:**
- Deriving which calendar day a past event belongs to from the *current*
  timezone setting, rather than the setting in effect when the event
  occurred.
- Re-pricing a stored historical revenue/cost figure using today's exchange
  rate rather than the rate captured at the time.
- Any rebuild or replay of historical data that can produce a different
  answer today than it would have produced the day the event happened,
  purely because some unrelated setting changed in between.

**Allowed:**
- Deriving an *ongoing, not-yet-settled* value (e.g. a customer's current
  outstanding balance) using the current rate or setting — because that
  value describes the present, not a fixed past moment.
- Storing the write-time value once, immutably, and reading it back
  verbatim for all historical purposes thereafter.

**Examples:** an immutable, write-time "which day did this happen in
shop-local time" column, set once by a trigger and never re-derived at
replay; a sale row storing the exchange rate that applied to it, rather
than looking one up later.

---

## Law 3 — Projections are derived state and must be rebuildable

**Statement:** Any read-optimized, cached, or denormalized view of data —
a projection — must be fully reconstructable from its authoritative source
at any time, producing the same result, without altering business truth in
the process.

**Why:** Projections exist for speed and offline availability, not as a
second copy of the truth. If a projection can drift and there's no way to
prove or restore its correctness from the source it's supposed to reflect,
it silently becomes an unverifiable second source of truth — the opposite
of what a projection is for.

**Forbidden:**
- Shipping a projection with no corresponding rebuild path.
- A rebuild that silently guesses or assumes coverage when it cannot
  actually verify it has seen every relevant source fact.
- Treating a projection's own stored value as authoritative when it
  disagrees with its source.

**Allowed:**
- A rebuild that explicitly refuses to run, and says so, when it cannot
  establish it has complete, coverage-verified access to the source data —
  rather than producing a plausible-looking but unverified number.
- Best-effort incremental maintenance of a projection between rebuilds, as
  long as a full rebuild remains available as the correctness backstop.
- A projection's authoritative computation requiring connectivity, as long
  as the projection remains rebuildable and the client's local copy
  degrades gracefully (stale-but-present) rather than breaking, when
  offline (see Law 5's boundary — this is the general escape valve for any
  "online-only because it computes over data the client already has,"
  not Law 5's).

**Examples:** a revenue projection with a coverage-checked rebuild function
that compares its local event count against an authoritative count before
trusting itself to proceed, refusing rather than guessing when they
disagree.

---

## Law 4 — A business fact has one canonical definition, calculation, and representation

**Statement:** Every business concept — revenue, profit, an outstanding
balance, a converted amount — is defined, calculated, and represented in
exactly one canonical place. Every other consumer reads or projects that
one definition; none may independently redefine what the concept means or
how it is computed.

**Why:** The moment two screens compute "revenue" via two different
formulas, they will eventually disagree — not because either is
implemented incorrectly, but because two independent definitions of the
same concept are, by construction, not guaranteed to produce the same
answer under all conditions. That disagreement reads to an owner as "the
app doesn't know its own numbers," which is worse than either number being
wrong on its own.

**Forbidden:**
- A second, independent calculation of a concept that already has a
  canonical definition, even if today it produces the same answer.
- Rounding, precision, or unit-representation choices that vary by call
  site for the same underlying concept (e.g. one place rounding a currency
  conversion one way, another rounding it differently).
- Solving "I need this number in a different shape" by recomputing it from
  scratch instead of transforming the canonical value.

**Allowed:**
- A projection or cache that stores the canonical calculation's *result*
  for performance or offline access — duplicating the *data* is fine;
  duplicating the *meaning or method* is not.
- One shared, centralized conversion/calculation utility used by every
  consumer that needs the concept, rather than each consumer reimplementing
  it.

**Examples:** a profit/revenue projection computed once, server-side, that
every dashboard tile and report reads or sums from — never a second
independent SQL formula for the same concept living in a specific screen's
own code.

---

## Law 5 — Offline-first protects core workflows

**Statement:** The core operations a shop depends on minute-to-minute —
selling, recording stock changes, taking payments — must continue to work
through a loss of connectivity. An online-only requirement is permitted
only when the operation has no meaningful local source of truth to fall
back on — establishing or verifying identity, registering a device,
administering across tenants, or similarly inherently server-mediated acts
where there is nothing local to be authoritative about. It is never
permitted merely because a computation happens to be easier or more
authoritative to run on the server, when the client already holds the data
that computation needs.

**Why:** This product exists for shops in places where connectivity is not
reliable. If checkout depends on the internet, the product has failed at
its most basic promise, no matter how good everything else is. The
exemption for genuinely server-only acts exists because those operations
have no local truth to defer to — but that is a narrow, specific carve-out,
not a general license. A business calculation over data the client already
has locally is a rebuildable-projection problem (Law 3), not a reason to
require connectivity for something a shop needs to keep operating.

**Forbidden:**
- Any core selling, stock, or payment-recording workflow that requires a
  live connection to complete.
- An online-only requirement that exists because nobody thought about it,
  rather than because the operation genuinely has no local source of
  truth.
- Justifying an online-only requirement for a computation over data the
  client already has locally by calling it "server-mediated" — if the
  client holds the source data, the connectivity requirement must be
  justified under Law 3's rebuildable-projection framework instead (with a
  graceful, stale-but-present local fallback), not excused here.

**Allowed:**
- Identity bootstrap, device registration, cross-tenant administration, and
  similarly acts with no local source of truth at all being online-only, as
  long as that boundary is explicit and doesn't block core shop operation.
- A feature degrading gracefully offline (e.g. showing "will sync later")
  rather than requiring full local functionality for every feature without
  exception.

**Examples:** the point-of-sale write path operating entirely against a
local database that syncs when connectivity returns; owner/device
identity setup being one of the deliberately-online-only exceptions to that
rule, because there is no local notion of "who this device is" to fall
back on before the server has said so.

---

## Law 6 — Authority is explicit and enforced at the correct boundary

**Statement:** For any decision that matters — who can see what, who can
change what, whether a financial calculation is trusted — the system must
make clear which actor (server or client) is authoritative, and that
authority must be enforced where the decision actually matters, not merely
implied by what the user interface happens to show.

**Why:** A client-side check is a convenience for the honest user and no
obstacle at all to anyone willing to open developer tools or call an API
directly. Treating a UI-level restriction as if it were a security or
financial-integrity boundary is not a smaller version of real enforcement —
it is the absence of enforcement, dressed up to look like a boundary.

**Forbidden:**
- Relying on client-side logic as the *only* protection for a
  security-sensitive or financially-consequential decision.
- Leaving an authority boundary implicit or undocumented, such that it's
  unclear whether the server or the client is supposed to be the source of
  truth for a given decision.
- Treating a code comment or design note as sufficient acknowledgment of a
  known enforcement gap. An acknowledged gap with no tracked ticket, no
  named owner, and no defined point at which it's revisited is
  indistinguishable in practice from an undocumented one — the gap simply
  persists indefinitely either way.

**Allowed:**
- Client-side checks as a first line of UX (hiding a button a user
  shouldn't see) as long as the real enforcement exists server-side too.
- A temporary, explicit gap between intended and current enforcement, while
  a fix is pending — but only when it is tracked as an open, owned ticket
  with a defined point at which it is revisited, not merely noted in a
  comment. A gap without that tracking is a violation of this law, not an
  exception to it.

**Examples:** a role-permission check re-verified inside a server-side
function rather than trusted from a client-supplied value; a
tenant-scoping check enforced by row-level security rather than only by
what the interface chooses to display.

---

## Law 7 — Retry and replay safety matches the consequences of the operation

**Statement:** There is no single, universal idempotency rule. The safety
mechanism protecting an operation from being duplicated by retry, replay,
or at-least-once delivery must match the actual consequences of that
operation — disposable projections, ordinary business state, and
irreversible financial records each demand a different bar.

**Why:** Treating every operation as equally safe to retry is not a
simplification — it is a false equivalence that will eventually apply a
weak safety mechanism to something that couldn't tolerate it. A
best-effort, single-device duplicate guard is entirely appropriate for a
disposable read-model marker and entirely inappropriate for a financial
write, because the cost of getting it wrong is completely different in
each case.

**Forbidden:**
- Applying a lightweight, best-effort duplicate-detection mechanism to a
  financial write on the assumption that "it's basically the same problem"
  as protecting a disposable projection.
- Claiming a mechanism guarantees safety under conditions (e.g. concurrent
  writers, cross-device races) it was never actually designed to handle.

**Allowed:**
- A lightweight, explicitly-scoped duplicate-guard for low-consequence,
  disposable state, clearly documented as not appropriate for anything
  more consequential.
- A stronger, ledger-backed, exactly-once mechanism reserved specifically
  for operations where duplication would be a real business-data
  correctness problem.

**Examples:** a single-device, at-most-once local marker used for
maintaining a disposable revenue projection, explicitly documented as
forbidden for any actual financial write; a durable, ledger-checked
apply-once mechanism used specifically where a financial or otherwise
consequential record is being written.

---

## Law 8 — Tenant isolation is enforced below the UI

**Statement:** One shop's data is inaccessible to another shop's users at
the data-access layer itself — the database and the sync layer — not only
because the interface never shows a path to it.

**Why:** A UI that simply never renders a link to another tenant's data
provides zero protection against a request crafted by hand, a bug in
routing, or a compromised client. Multi-tenant data isolation has to be a
property of the data layer or it isn't a property of the system at all —
it's a property of the current screen, which is a much weaker and far more
fragile claim.

**Forbidden:**
- Any endpoint, table, or sync rule whose *only* protection against
  cross-tenant access is that the interface doesn't provide a way to
  trigger it.
- Assuming a permission-scoped sync or query mechanism is safe without
  having verified it actually fails closed under the conditions it will
  run in.
- Treating a code comment or design note as sufficient acknowledgment of a
  mechanism flagged as unverified. A mechanism flagged as unverified with
  no tracked ticket, no named owner, and no defined point at which it is
  revisited or verified is indistinguishable in practice from an
  undocumented gap — the same unbounded condition Law 6 forbids for
  authority boundaries, applied here to isolation.

**Allowed:**
- A UI-level restriction as an additional, secondary layer, on top of
  real data-layer enforcement — defense in depth is good; defense-in-depth
  used to mean "the only depth" is not.
- A newly-added sync or access mechanism being explicitly marked
  unverified/high-risk while its real-world behavior is being confirmed —
  but only when it is tracked as an open, owned ticket with a defined
  point at which it is verified, not merely noted in a comment. A flag
  without that tracking is a violation of this law, not an exception to
  it.

**Examples:** row-level security scoping every tenant-owned table by the
authenticated owner's identity, independently mirrored by the same scoping
in the sync layer's own rules — two independent enforcement points for the
same boundary, neither of which is "does the screen show it."
