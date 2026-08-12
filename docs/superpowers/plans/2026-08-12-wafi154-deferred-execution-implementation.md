# WAFI-154 Deferred Execution Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deferred execution tier per `docs/superpowers/specs/2026-08-12-wafi154-deferred-execution-design.md` — a `local_deferred_jobs` table, the `registerJobHandler`/`defineDeferredSubscriber` registration split, the atomic `enqueueDeferredJob` transaction, and the `drainDeferredJobs` worker (lease reclaim, priority/FIFO ordering, capacity/eviction, retention, Sentry failure reporting) — proven end-to-end with synthetic `test.*` job types only. No real production job type is migrated in this ticket.

**Architecture:** A third execution tier alongside Immediate and Durable (WAFI-150): a deferred subscriber persists a row and returns immediately, never running its handler inline. `enqueueDeferredJob` is a single SQLite transaction (insert → capacity-check → evict-if-needed) so dedup, capacity, and eviction can never race each other. `drainDeferredJobs` is a single-flight, macrotask-yielding sequential loop triggered by app-foreground and PowerSync-reconnect, claiming rows via a lease (crash recovery) and reusing WAFI-150's `isTransientEventFailure` classifier and `[1,5,30,120]`-minute backoff for retry scheduling. A `dead` transition reports through the existing Sentry integration, best-effort, never blocking on delivery.

**Tech Stack:** PowerSync client-side SQLite (`src/data/powersync/db.ts`), Vue 3 Composition API, Vitest, Node's built-in `node:sqlite` (`DatabaseSync`) for a **real-SQLite test harness** — see Task 1's rationale; this repo's existing client-side tests mock `db` entirely (`src/__tests__/__mocks__/db.ts`), which cannot validate real constraint/transaction behavior, so this ticket introduces the first real-SQLite-backed test double for client code, scoped only to this suite.

## Global Constraints

- `DEFERRED_JOB_LEASE_MINUTES = 5`, `MAX_ATTEMPTS = 5`, default `maxQueuedJobs = 200` per type, global ceiling `= 1000` queued rows, retention `= 7` days for `completed`/`dead`/`evicted` — all named constants in code, never magic numbers, all documented in the spec as v1 defaults subject to change.
- `local_deferred_jobs` is `{ localOnly: true }` in `src/data/powersync/schema.ts` — never synced, no Postgres migration number needed.
- Every dollar/JSON field in `payload` is a caller concern (payload size guidance is documented, not enforced at runtime in v1) — this plan does not add a byte-limit check.
- `evictable` is never a stored field or a `registerJobHandler` parameter — always derived as `priority !== 'critical'`.
- The dedup-conflict distinction (constraint violation vs. genuine `INSERT` failure) must use structured SQLite error information, never string-matching — verified directly in Task 1's spike before any later task relies on it.
- The drain loop yields via a macrotask boundary (`await new Promise(resolve => setTimeout(resolve, 0))`), never a microtask-only yield, between every job execution.
- `drainDeferredJobs(shopId)` is single-flight per shop and filters every query by `shop_id = ?`.
- No production job type is registered by this plan — `test.*` types exist only inside test files.
- Never commit with `--no-verify` or skip hooks.

---

### Task 1: Real-SQLite test harness, schema, and unique-index/error-code spike

**Why this task exists, read before starting:** the design spec's entire dedup-atomicity guarantee (a `CREATE UNIQUE INDEX ... WHERE ...` partial unique index, rejected via a structured SQLite constraint-violation code) is **unverified against this codebase's actual PowerSync client**. Two real facts discovered while researching this plan make that verification mandatory, not optional:
1. `src/services/events/processProjectionAtMostOnce.ts`'s own docstring states: *"PowerSync's `Table`/`Index` schema DSL has no way to declare a UNIQUE constraint (only plain, non-unique indexes)"* — the reason that helper uses check-then-insert instead of insert-then-catch. This plan's design requires bypassing that DSL entirely and running raw `CREATE UNIQUE INDEX` SQL via `db.execute` directly against the underlying SQLite file. Nothing in this codebase has done that before.
2. Every existing client-side test in this repo (`src/__tests__/__mocks__/db.ts`) mocks `db` completely — there is no existing "real SQLite" test harness to validate real constraint/transaction/error-code behavior against. Testing this design against the existing mock would be tautological (the mock returns whatever the test tells it to, proving nothing about real SQLite).

This task builds a **real SQLite test double** (using Node's built-in `node:sqlite`, zero new dependencies — this repo runs on Node 26 via Vitest, and `node:sqlite`'s `DatabaseSync` has been stable since Node 22) implementing the same interface shape as `db` (`execute`, `getAll`, `getOptional`, `writeTransaction`), then uses it to prove the unique-index/error-code mechanism actually works before any later task is built on top of it.

**Files:**
- Create: `src/__tests__/helpers/realSqliteDb.ts`
- Modify: `src/data/powersync/schema.ts` (add `local_deferred_jobs` table + export)
- Create: `src/services/events/deferredJob.constants.ts`
- Create: `src/services/events/deferredJobsSchema.ts`
- Test: `src/services/events/__tests__/deferredJobsSchema.spike.test.ts`

**Interfaces:**
- Produces: `createRealSqliteDb(): RealSqliteDb` (a `db`-shaped object backed by a real on-disk-or-memory SQLite database); `initLocalDeferredJobsSchema(db: DbLike): Promise<void>` (creates the two indexes); `DEFERRED_JOB_LEASE_MINUTES`, `MAX_ATTEMPTS`, `DEFAULT_MAX_QUEUED_JOBS_PER_TYPE`, `GLOBAL_QUEUE_CEILING`, `RETENTION_DAYS` constants.

- [ ] **Step 1: Add `local_deferred_jobs` to the PowerSync schema**

In `src/data/powersync/schema.ts`, add near the other local-only tables (e.g. after `local_subscriber_processed_events`):

```ts
// WAFI-154 -- device-local deferred job queue. Never synced (localOnly: true);
// see design spec's "Same SQLite database, no new storage layer" section.
const local_deferred_jobs = new Table({
  job_type:          column.text,
  shop_id:           column.text,
  payload:           column.text,     // JSON.stringify'd
  priority:          column.text,     // 'critical' | 'normal' | 'low' -- stamped at enqueue time
  requires_network:  column.integer,  // 0 | 1
  dedupe_key:        column.text,     // nullable
  status:            column.text,     // 'queued' | 'running' | 'completed' | 'dead' | 'evicted'
  attempts:          column.integer,
  last_error:        column.text,     // nullable, serialized string
  next_retry_at:     column.text,     // ISO string, nullable
  worker_id:         column.text,     // nullable
  started_at:        column.text,     // ISO string, nullable -- lease start
  lease_expires_at:  column.text,     // ISO string, nullable
  enqueued_at:       column.text,     // ISO string
  finished_at:       column.text,     // ISO string, nullable
}, { localOnly: true })
```

Add `local_deferred_jobs,` to the schema export object alongside the other local-only tables.

- [ ] **Step 2: Write the constants file**

```ts
// src/services/events/deferredJob.constants.ts
export const DEFERRED_JOB_LEASE_MINUTES = 5
export const MAX_ATTEMPTS = 5
export const DEFAULT_MAX_QUEUED_JOBS_PER_TYPE = 200
export const GLOBAL_QUEUE_CEILING = 1000
export const RETENTION_DAYS = 7
export const BACKOFF_MINUTES = [1, 5, 30, 120] as const // must match eventProcessingRetryQueue.ts's BACKOFF_MINUTES exactly
```

- [ ] **Step 3: Write the index-creation module**

```ts
// src/services/events/deferredJobsSchema.ts
import type { db as DbType } from '@/data/powersync/db'

type DbLike = Pick<typeof DbType, 'execute'>

/** Raw DDL, deliberately bypassing PowerSync's Table/Index schema DSL -- see Task 1's
 *  rationale in the WAFI-154 implementation plan: the DSL cannot declare a UNIQUE
 *  constraint at all, but local_deferred_jobs is localOnly (never synced), so nothing
 *  prevents running real SQLite DDL directly against it via db.execute. */
export async function initLocalDeferredJobsSchema(database: DbLike): Promise<void> {
  await database.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS local_deferred_jobs_dedupe
       ON local_deferred_jobs (job_type, dedupe_key)
       WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running')`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS local_deferred_jobs_selection
       ON local_deferred_jobs (shop_id, status, priority, enqueued_at)`,
  )
}
```

- [ ] **Step 4: Write the real-SQLite test harness**

```ts
// src/__tests__/helpers/realSqliteDb.ts
import { DatabaseSync } from 'node:sqlite'

/** A `db`-shaped object backed by a REAL SQLite database (Node's built-in node:sqlite),
 *  not a mock. Existing client-side tests mock `db` entirely (see
 *  src/__tests__/__mocks__/db.ts) -- that cannot validate real UNIQUE-constraint
 *  enforcement, real transaction atomicity, or real structured SQLite error codes, all
 *  of which WAFI-154's design depends on. `path` defaults to in-memory; pass a real
 *  file path to simulate a process restart against the same on-disk file (see the
 *  "offline job survives restart" test). */
export function createRealSqliteDb(path = ':memory:') {
  const conn = new DatabaseSync(path)
  conn.exec(`
    CREATE TABLE IF NOT EXISTS local_deferred_jobs (
      id TEXT PRIMARY KEY, job_type TEXT, shop_id TEXT, payload TEXT, priority TEXT,
      requires_network INTEGER, dedupe_key TEXT, status TEXT, attempts INTEGER,
      last_error TEXT, next_retry_at TEXT, worker_id TEXT, started_at TEXT,
      lease_expires_at TEXT, enqueued_at TEXT, finished_at TEXT
    )
  `)

  return {
    execute: async (sql: string, params: unknown[] = []) => {
      const stmt = conn.prepare(sql)
      const isSelect = /^\s*select/i.test(sql)
      if (isSelect) return { rows: { _array: stmt.all(...(params as any[])) } }
      stmt.run(...(params as any[]))
      return { rows: { _array: [] } }
    },
    getAll: async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
      conn.prepare(sql).all(...(params as any[])) as T[],
    getOptional: async <T>(sql: string, params: unknown[] = []): Promise<T | null> =>
      (conn.prepare(sql).get(...(params as any[])) as T) ?? null,
    writeTransaction: async <T>(fn: (tx: { execute: (sql: string, params?: unknown[]) => Promise<any> }) => Promise<T>): Promise<T> => {
      conn.exec('BEGIN')
      try {
        const result = await fn({
          execute: async (sql: string, params: unknown[] = []) => {
            const stmt = conn.prepare(sql)
            const isSelect = /^\s*select/i.test(sql)
            if (isSelect) return { rows: { _array: stmt.all(...(params as any[])) } }
            stmt.run(...(params as any[]))
            return { rows: { _array: [] } }
          },
        })
        conn.exec('COMMIT')
        return result
      } catch (err) {
        conn.exec('ROLLBACK')
        throw err
      }
    },
    close: () => conn.close(),
    _raw: conn,
  }
}
```

- [ ] **Step 5: Write the spike test proving the unique-index/error-code mechanism works**

```ts
// src/services/events/__tests__/deferredJobsSchema.spike.test.ts
import { describe, it, expect } from 'vitest'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'

describe('WAFI-154 spike: local_deferred_jobs unique index + structured error code', () => {
  it('rejects a second queued row with the same (job_type, dedupe_key) via a structured constraint code', async () => {
    const database = createRealSqliteDb()
    await initLocalDeferredJobsSchema(database)
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, dedupe_key, status, attempts, enqueued_at)
       VALUES ('row1', 'test.sleep', 'dedupe-1', 'queued', 0, '2026-08-12T00:00:00.000Z')`,
    )

    let caught: any
    try {
      await database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, dedupe_key, status, attempts, enqueued_at)
         VALUES ('row2', 'test.sleep', 'dedupe-1', 'queued', 0, '2026-08-12T00:00:01.000Z')`,
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeDefined()
    // node:sqlite (like every SQLite binding) exposes a structured error code on the
    // thrown error, not just a message string -- this assertion is what proves the
    // "never string-match" implementation constraint from the design spec is actually
    // satisfiable against this project's real SQLite layer.
    expect(caught.code).toBe('ERR_SQLITE_ERROR')
    expect(caught.errcode).toBeDefined() // the underlying sqlite3 result code (SQLITE_CONSTRAINT family)
    database.close()
  })

  it('allows the same (job_type, dedupe_key) once the first row is no longer queued/running', async () => {
    const database = createRealSqliteDb()
    await initLocalDeferredJobsSchema(database)
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, dedupe_key, status, attempts, enqueued_at, finished_at)
       VALUES ('row1', 'test.sleep', 'dedupe-1', 'completed', 1, '2026-08-12T00:00:00.000Z', '2026-08-12T00:01:00.000Z')`,
    )
    await expect(
      database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, dedupe_key, status, attempts, enqueued_at)
         VALUES ('row2', 'test.sleep', 'dedupe-1', 'queued', 0, '2026-08-12T00:02:00.000Z')`,
      ),
    ).resolves.toBeDefined()
    database.close()
  })
})
```

- [ ] **Step 6: Run the spike test**

Run: `npx vitest run src/services/events/__tests__/deferredJobsSchema.spike.test.ts`
Expected: PASS. **If either test fails** (e.g. `node:sqlite` throws a plain `Error` with no `.code`/`.errcode`, or the unique index silently fails to attach), **stop and escalate before continuing to Task 2** — the design spec's core atomicity mechanism (Capacity & Eviction, Dedup/Coalescing sections) depends on this working exactly as tested here; a failure here means the spec needs a revision (e.g. falling back to an application-level check-then-insert guard, accepting the weaker race-safety `processProjectionAtMostOnce` already documents), not a workaround improvised mid-implementation.

**Outstanding manual step, not closeable by this task:** this spike validates the mechanism against Node's real SQLite (`node:sqlite`), used here purely as a stand-in because no real-SQLite test harness existed in this repo before. It does **not** confirm the actual PowerSync client wrapper running in the browser/PWA exposes the same structured error shape — that must be confirmed on a real device/browser build before this ticket is treated as production-verified, mirroring the "no Docker in this sandbox" pattern already accepted for WAFI-150/151/153's server-side migrations.

- [ ] **Step 7: Commit**

```bash
git add src/data/powersync/schema.ts src/services/events/deferredJob.constants.ts src/services/events/deferredJobsSchema.ts src/__tests__/helpers/realSqliteDb.ts src/services/events/__tests__/deferredJobsSchema.spike.test.ts
git commit -m "feat(WAFI-154): add local_deferred_jobs schema, constants, and unique-index/error-code spike"
```

---

### Task 2: `enqueueDeferredJob` — atomic insert-then-capacity-check transaction

**Files:**
- Create: `src/services/events/enqueueDeferredJob.ts`
- Create: `src/services/events/jobTypeRegistry.ts`
- Test: `src/services/events/__tests__/enqueueDeferredJob.test.ts`

**Interfaces:**
- Consumes: `createRealSqliteDb`/`initLocalDeferredJobsSchema` (Task 1), `DEFAULT_MAX_QUEUED_JOBS_PER_TYPE`/`GLOBAL_QUEUE_CEILING` (Task 1).
- Produces: `registerJobHandler(opts): void`, `getJobTypePolicy(jobType): JobTypePolicy | undefined` (both in `jobTypeRegistry.ts`); `enqueueDeferredJob(opts: { jobType, shopId, payload, dedupeKey? }, database?: DbLike): Promise<{ deduped: boolean }>` (defaults `database` to the real app `db`, parameterized here so tests inject the real-SQLite harness).

- [ ] **Step 1: Write the registry**

```ts
// src/services/events/jobTypeRegistry.ts
export interface JobTypePolicy {
  jobType: string
  handler: (job: { id: string; payload: unknown }) => Promise<void>
  priority: 'critical' | 'normal' | 'low'
  requiresNetwork: boolean
  maxQueuedJobs: number
  evictable: boolean
}

const registry = new Map<string, JobTypePolicy>()

/** Job-type-side registration: owns every operational policy decision for a job type,
 *  exactly once, regardless of how many deferred subscribers eventually enqueue it.
 *  evictable is never a parameter -- always derived from priority (see design spec's
 *  Capacity & Eviction section: `evictable = priority !== 'critical'` structurally,
 *  so the two properties can never disagree). */
export function registerJobHandler(opts: {
  jobType: string
  handler: (job: { id: string; payload: unknown }) => Promise<void>
  priority: 'critical' | 'normal' | 'low'
  requiresNetwork: boolean
  maxQueuedJobs: number
}): void {
  registry.set(opts.jobType, { ...opts, evictable: opts.priority !== 'critical' })
}

export function getJobTypePolicy(jobType: string): JobTypePolicy | undefined {
  return registry.get(jobType)
}

export function getRegisteredJobTypes(): string[] {
  return Array.from(registry.keys())
}

/** Test-only: clears the registry between test files/cases so one test's
 *  registerJobHandler calls never leak into another. */
export function resetJobTypeRegistry(): void {
  registry.clear()
}
```

- [ ] **Step 2: Write the failing tests for the enqueue algorithm**

```ts
// src/services/events/__tests__/enqueueDeferredJob.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'
import { enqueueDeferredJob } from '@/services/events/enqueueDeferredJob'
import { registerJobHandler, resetJobTypeRegistry } from '@/services/events/jobTypeRegistry'

async function freshDb() {
  const database = createRealSqliteDb()
  await initLocalDeferredJobsSchema(database)
  return database
}

describe('enqueueDeferredJob', () => {
  beforeEach(() => resetJobTypeRegistry())

  it('stamps priority/requires_network from the registered job type policy, not from the caller', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'critical', requiresNetwork: true, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { x: 1 } }, database)
    const row = await database.getOptional<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.priority).toBe('critical')
    expect(row.requires_network).toBe(1)
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(0)
  })

  it('dedupe: a colliding dedupeKey resolves successfully as a no-op, no second row created', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'k1' }, database)
    await expect(
      enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'k1' }, database),
    ).resolves.toEqual({ deduped: true })
    const rows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(rows.length).toBe(1)
  })

  it('dedupe race: two concurrent enqueues with the same key both resolve without throwing, exactly one row exists, and no unrelated row is evicted', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 1 })
    // Fill the type's quota (maxQueuedJobs=1) with one legitimate, unrelated row first.
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'unrelated' }, database)
    const before = await database.getAll<any>(`SELECT id FROM local_deferred_jobs WHERE job_type = 'test.a'`)

    const [r1, r2] = await Promise.all([
      enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'racing' }, database),
      enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: {}, dedupeKey: 'racing' }, database),
    ])
    expect([r1.deduped, r2.deduped].sort()).toEqual([false, true])

    const racingRows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE dedupe_key = 'racing'`)
    expect(racingRows.length).toBe(1)
    // The unrelated pre-existing row must still be there, queued, never evicted --
    // proving the duplicate was rejected at the INSERT-constraint step, before any
    // capacity/eviction logic ran (design spec: "a duplicate enqueue must never
    // cause an eviction").
    const unrelatedStillQueued = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE id = ?`, [before[0].id])
    expect(unrelatedStillQueued.status).toBe('queued')
  })

  it('per-type quota: exceeding maxQueuedJobs evicts the oldest evictable row of THAT type only', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 2 })
    registerJobHandler({ jobType: 'test.b', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.b', shopId: 'shop1', payload: {} }, database) // unrelated type, must survive
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 1 } }, database)
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 2 } }, database)
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 3 } }, database)

    const aRows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a' ORDER BY enqueued_at`)
    const queuedA = aRows.filter((r) => r.status === 'queued')
    expect(queuedA.length).toBe(2)
    expect(JSON.parse(queuedA[0].payload).n).toBe(2) // n=1 evicted (oldest)
    expect(JSON.parse(queuedA[1].payload).n).toBe(3)
    const evictedA = aRows.find((r) => r.status === 'evicted')
    expect(evictedA).toBeDefined()
    expect(JSON.parse(evictedA.payload).n).toBe(1)

    const bRow = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.b'`)
    expect(bRow.status).toBe('queued') // unrelated type untouched
  })

  it('global ceiling enforced independently of per-type quotas', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'low', requiresNetwork: false, maxQueuedJobs: 200 })
    registerJobHandler({ jobType: 'test.b', handler: async () => {}, priority: 'low', requiresNetwork: false, maxQueuedJobs: 200 })
    // Manually seed the queue right up to the global ceiling (1000) split across two
    // types, each well under its own 200 quota, so only the global check should fire.
    for (let i = 0; i < 500; i++) {
      await database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
         VALUES (?, 'test.a', 'shop1', '{}', 'low', 0, 'queued', 0, ?)`,
        [`a${i}`, `2026-08-12T00:00:${String(i % 60).padStart(2, '0')}.000Z`],
      )
    }
    for (let i = 0; i < 500; i++) {
      await database.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
         VALUES (?, 'test.b', 'shop1', '{}', 'low', 0, 'queued', 0, ?)`,
        [`b${i}`, `2026-08-12T00:01:${String(i % 60).padStart(2, '0')}.000Z`],
      )
    }
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { marker: 'over-ceiling' } }, database)
    const evictedCount = await database.getOptional<{ c: number }>(`SELECT COUNT(*) AS c FROM local_deferred_jobs WHERE status = 'evicted'`)
    expect(evictedCount!.c).toBeGreaterThanOrEqual(1)
  })

  it('eviction picks lowest priority first, then oldest within that priority', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 2 })
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
       VALUES ('low1', 'test.a', 'shop1', '{}', 'low', 0, 'queued', 0, '2026-08-12T00:00:00.000Z')`,
    )
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
       VALUES ('normal1', 'test.a', 'shop1', '{}', 'normal', 0, 'queued', 0, '2026-08-12T00:00:01.000Z')`,
    )
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { marker: 'newest' } }, database)
    const low1 = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE id = 'low1'`)
    const normal1 = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE id = 'normal1'`)
    expect(low1.status).toBe('evicted') // lowest priority evicted first, even though normal1 is older
    expect(normal1.status).toBe('queued')
  })

  it('critical jobs are never evicted: enqueue throws when no evictable candidate exists', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'critical', requiresNetwork: false, maxQueuedJobs: 1 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 1 } }, database)
    await expect(enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 2 } }, database)).rejects.toThrow()
    const rows = await database.getAll<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(rows.every((r) => r.status === 'queued')).toBe(true) // the failed enqueue's own insert was rolled back too
    expect(rows.length).toBe(1)
  })

  it('a dedupeKey is reusable once the prior row is no longer queued/running', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 1 }, dedupeKey: 'daily-summary:2026-08-12' }, database)
    const firstRow = await database.getOptional<any>(`SELECT id FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
      new Date().toISOString(), firstRow.id,
    ])
    const result = await enqueueDeferredJob({ jobType: 'test.a', shopId: 'shop1', payload: { n: 2 }, dedupeKey: 'daily-summary:2026-08-12' }, database)
    expect(result.deduped).toBe(false) // a genuinely new row, not deduped against the completed one
    const rows = await database.getAll<any>(`SELECT * FROM local_deferred_jobs WHERE job_type = 'test.a' AND dedupe_key = 'daily-summary:2026-08-12'`)
    expect(rows.length).toBe(2) // the old completed row plus the new queued one both exist
    expect(rows.filter((r) => r.status === 'queued').length).toBe(1)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/enqueueDeferredJob.test.ts`
Expected: FAIL — `enqueueDeferredJob` module doesn't exist yet.

- [ ] **Step 4: Write `enqueueDeferredJob`**

**Critical implementation rule, worth stating before the code:** every read inside the transaction — the per-type count, the global count, and `evictOne`'s candidate lookup — **must go through `tx.execute`, never the outer `database` handle.** A real SQLite transaction's own uncommitted writes (the row just inserted in this same transaction) are invisible to a separate connection/handle reading outside that transaction; reading via `database.getOptional` instead of `tx` would silently see stale pre-transaction state and miscount every capacity check.

```ts
// src/services/events/enqueueDeferredJob.ts
import { db as appDb } from '@/data/powersync/db'
import { getJobTypePolicy } from '@/services/events/jobTypeRegistry'
import { DEFAULT_MAX_QUEUED_JOBS_PER_TYPE, GLOBAL_QUEUE_CEILING } from '@/services/events/deferredJob.constants'

type DbLike = Pick<typeof appDb, 'execute' | 'getAll' | 'getOptional' | 'writeTransaction'>

interface Tx {
  execute: (sql: string, params?: unknown[]) => Promise<any>
}

/** Structured-error check per the design spec's implementation constraint: never
 *  string-match. node:sqlite (and every real SQLite binding this app could ship with)
 *  sets `.code = 'ERR_SQLITE_ERROR'` with the underlying result code on `.errcode` --
 *  verified directly in Task 1's spike. `errcode` for a UNIQUE violation is in the
 *  SQLITE_CONSTRAINT family (raw code 19, or 2067 for the UNIQUE-specific extended code). */
function isUniqueConstraintViolation(err: unknown): boolean {
  const e = err as { code?: string; errcode?: number }
  if (e?.code !== 'ERR_SQLITE_ERROR') return false
  return e.errcode === 19 || e.errcode === 2067
}

async function evictOne(tx: Tx, where: string, params: unknown[]): Promise<boolean> {
  const result = await tx.execute(
    `SELECT id FROM local_deferred_jobs WHERE ${where}
       AND priority != 'critical'
     ORDER BY CASE priority WHEN 'normal' THEN 0 ELSE 1 END ASC, enqueued_at ASC
     LIMIT 1`,
    params,
  )
  const candidate = result.rows._array[0]
  if (!candidate) return false
  await tx.execute(`UPDATE local_deferred_jobs SET status = 'evicted', finished_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    candidate.id,
  ])
  return true
}

export async function enqueueDeferredJob(
  opts: { jobType: string; shopId: string; payload: unknown; dedupeKey?: string },
  database: DbLike = appDb,
): Promise<{ deduped: boolean }> {
  const policy = getJobTypePolicy(opts.jobType)
  if (!policy) throw new Error(`enqueueDeferredJob: no registerJobHandler policy for job type "${opts.jobType}"`)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  try {
    await database.writeTransaction(async (tx: Tx) => {
      await tx.execute(
        `INSERT INTO local_deferred_jobs
           (id, job_type, shop_id, payload, priority, requires_network, dedupe_key, status, attempts, enqueued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
        [id, opts.jobType, opts.shopId, JSON.stringify(opts.payload), policy.priority, policy.requiresNetwork ? 1 : 0, opts.dedupeKey ?? null, now],
      )

      const maxForType = policy.maxQueuedJobs ?? DEFAULT_MAX_QUEUED_JOBS_PER_TYPE
      const typeCountResult = await tx.execute(
        `SELECT COUNT(*) AS c FROM local_deferred_jobs WHERE job_type = ? AND status = 'queued'`,
        [opts.jobType],
      )
      const typeCount = typeCountResult.rows._array[0]?.c ?? 0
      if (typeCount > maxForType) {
        const evicted = await evictOne(tx, `job_type = ? AND status = 'queued' AND id != ?`, [opts.jobType, id])
        if (!evicted) throw new Error(`enqueueDeferredJob: per-type quota exhausted for "${opts.jobType}" with no evictable candidate`)
      }

      const globalCountResult = await tx.execute(`SELECT COUNT(*) AS c FROM local_deferred_jobs WHERE status = 'queued'`)
      const globalCount = globalCountResult.rows._array[0]?.c ?? 0
      if (globalCount > GLOBAL_QUEUE_CEILING) {
        const evicted = await evictOne(tx, `status = 'queued' AND id != ?`, [id])
        if (!evicted) throw new Error('enqueueDeferredJob: global queue ceiling exhausted with no evictable candidate')
      }
    })
    return { deduped: false }
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { deduped: true }
    throw err
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/enqueueDeferredJob.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/events/enqueueDeferredJob.ts src/services/events/jobTypeRegistry.ts src/services/events/__tests__/enqueueDeferredJob.test.ts
git commit -m "feat(WAFI-154): add enqueueDeferredJob atomic insert-then-capacity-check transaction and job type registry"
```

---

### Task 3: `defineDeferredSubscriber` — producer-side registration, retry-queue glue, at-least-once redelivery dedup

**Files:**
- Create: `src/services/events/deferredSubscriber.ts`
- Test: `src/services/events/__tests__/deferredSubscriber.test.ts`

**Interfaces:**
- Consumes: `enqueueDeferredJob` (Task 2), `useEventSubscription` (existing), `enqueueForProcessingRetry`/`isTransientEventFailure` (existing, WAFI-150).
- Produces: `defineDeferredSubscriber<T>(opts): { stop: () => void }`.

**Design decision beyond the spec's illustrative sketch, and why it's necessary:** the spec's `defineDeferredSubscriber` sketch calls `enqueueDeferredJob` directly with no failure handling and no redelivery guard. Two real correctness gaps that must be closed:

1. `useEventSubscription`'s own docstring states it is at-least-once and *"a restart re-processes from scratch"* (its in-memory watermark resets on every app restart). Without a persisted per-subscriber ledger, every app restart would re-enqueue every deferred job type's **entire historical event set** again. `defineDeferredSubscriber` therefore reuses the exact same `local_subscriber_processed_events` ledger table `runDurableSubscriber` already uses (check-before, insert-after-success) — this is a *generalized* WAFI-150 primitive, not the durable execution path itself, consistent with the spec's stated dependency framing.
2. If `enqueueDeferredJob` throws (e.g. a non-evictable job type at capacity), that throw must not propagate back into `useEventSubscription`'s `for await` loop uncaught — doing so would permanently kill that subscription's entire watch loop, not just this one event (confirmed by reading `useEventSubscription.ts`: an uncaught throw from a per-row handler crashes the whole outer async IIFE). `defineDeferredSubscriber` therefore mirrors `runDurableSubscriber`'s own try/catch shape: on failure, route to `enqueueForProcessingRetry` (test 21's requirement — "reaches the same failure path a durable subscriber's handler throw would") and never rethrow.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/deferredSubscriber.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { defineDeferredSubscriber } from '@/services/events/deferredSubscriber'
import { registerJobHandler, resetJobTypeRegistry } from '@/services/events/jobTypeRegistry'

let capturedHandler: ((row: any) => Promise<void>) | undefined
vi.mock('@/services/events/useEventSubscription', () => ({
  useEventSubscription: vi.fn((_type: string, handler: any) => {
    capturedHandler = handler
    return { stop: vi.fn() }
  }),
}))

const row = {
  id: 'event1', type: 'sale.completed', entity_id: 'sale1', payload: { saleId: 'sale1' },
  payload_version: 2, staff_id: 's1', shop_id: 'shop1',
  occurred_at: '2026-08-12T00:00:00.000Z', created_at: '2026-08-12T00:00:00.000Z',
}

describe('defineDeferredSubscriber', () => {
  beforeEach(() => { vi.clearAllMocks(); capturedHandler = undefined; resetJobTypeRegistry() })

  it('enqueues before returning, and the event flow never executes the job handler directly', async () => {
    registerJobHandler({ jobType: 'test.receipt', handler: vi.fn(), priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    vi.mocked(db.getOptional).mockResolvedValueOnce(null) // not yet in local_subscriber_processed_events
    defineDeferredSubscriber({
      subscriberName: 'testReceiptSubscriber',
      eventType: 'sale.completed' as any,
      shopId: 'shop1',
      jobType: 'test.receipt',
      toJobPayload: (e: any) => ({ saleId: e.payload.saleId }),
    })
    await capturedHandler!(row)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('INSERT INTO local_deferred_jobs'))
    expect(insertCall).toBeDefined()
    const ledgerInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_subscriber_processed_events'))
    expect(ledgerInsert).toBeDefined() // marks processed on success, same as runDurableSubscriber
  })

  it('skips a row already recorded in local_subscriber_processed_events for this subscriber (redelivery/restart dedup)', async () => {
    registerJobHandler({ jobType: 'test.receipt', handler: vi.fn(), priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    vi.mocked(db.getOptional).mockResolvedValueOnce({ event_id: row.id })
    defineDeferredSubscriber({
      subscriberName: 'testReceiptSubscriber',
      eventType: 'sale.completed' as any,
      shopId: 'shop1',
      jobType: 'test.receipt',
      toJobPayload: (e: any) => ({ saleId: e.payload.saleId }),
    })
    await capturedHandler!(row)
    const insertCall = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('INSERT INTO local_deferred_jobs'))
    expect(insertCall).toBeUndefined() // never re-enqueued
  })

  it('on enqueue failure, routes to enqueueForProcessingRetry and does NOT rethrow into the watch loop', async () => {
    registerJobHandler({ jobType: 'test.receipt', handler: vi.fn(), priority: 'critical', requiresNetwork: false, maxQueuedJobs: 200 })
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    // Simulate enqueueDeferredJob's underlying writeTransaction throwing (e.g. capacity
    // exhausted with no evictable candidate) by making the mocked db.execute reject on
    // the INSERT statement specifically.
    vi.mocked(db.execute).mockImplementation(((sql: string) => {
      if (sql.includes('INSERT INTO local_deferred_jobs')) return Promise.reject(new Error('capacity exhausted'))
      return Promise.resolve({ rows: { _array: [] } })
    }) as any)

    defineDeferredSubscriber({
      subscriberName: 'testReceiptSubscriber',
      eventType: 'sale.completed' as any,
      shopId: 'shop1',
      jobType: 'test.receipt',
      toJobPayload: (e: any) => ({ saleId: e.payload.saleId }),
    })
    await expect(capturedHandler!(row)).resolves.not.toThrow()
    const retryInsert = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processing_retries'))
    expect(retryInsert).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/deferredSubscriber.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `defineDeferredSubscriber`**

```ts
// src/services/events/deferredSubscriber.ts
import { db } from '@/data/powersync/db'
import { logger } from './logger'
import { useEventSubscription, type EventRow } from './useEventSubscription'
import { enqueueForProcessingRetry } from './eventProcessingRetryQueue'
import { enqueueDeferredJob } from './enqueueDeferredJob'
import type { DomainEvent, DomainEventType } from './domainEvent.types'

function toDomainEvent<T>(row: EventRow<T>): DomainEvent<T> {
  return {
    type: row.type,
    entityId: row.entity_id,
    payload: row.payload,
    payloadVersion: row.payload_version,
    staffId: row.staff_id,
    shopId: row.shop_id,
    occurredAt: row.occurred_at,
  }
}

/**
 * Producer-side registration for the deferred execution tier (WAFI-154 design spec).
 * Mirrors runDurableSubscriber's try/catch/ledger shape exactly -- reusing the SAME
 * local_subscriber_processed_events ledger and the SAME local_event_processing_retries
 * retry queue -- but the "handler" this wraps is always enqueueDeferredJob, never an
 * arbitrary business action. This is deliberate: WAFI-154 reuses WAFI-150's
 * generalized retry/ledger primitives, not its inline execution path (see design
 * spec's "Precise dependency on WAFI-150" note).
 */
export function defineDeferredSubscriber<T>(opts: {
  subscriberName: string
  eventType: DomainEventType
  shopId: string
  jobType: string
  toJobPayload: (event: DomainEvent<T>) => unknown
  dedupeKey?: (event: DomainEvent<T>) => string | undefined
}): { stop: () => void } {
  return useEventSubscription<T>(
    opts.eventType,
    async (row: EventRow<T>) => {
      const event = toDomainEvent(row)
      let enqueueSucceeded = false
      try {
        const already = await db.getOptional<{ event_id: string }>(
          `select event_id from local_subscriber_processed_events where subscriber_name = ? and event_id = ?`,
          [opts.subscriberName, row.id],
        )
        if (already) return

        await enqueueDeferredJob({
          jobType: opts.jobType,
          shopId: opts.shopId,
          payload: opts.toJobPayload(event),
          dedupeKey: opts.dedupeKey?.(event),
        })
        enqueueSucceeded = true
        await db.execute(
          `insert into local_subscriber_processed_events (id, subscriber_name, event_id, processed_at) values (?, ?, ?, ?)`,
          [crypto.randomUUID(), opts.subscriberName, row.id, new Date().toISOString()],
        )
      } catch (err) {
        if (enqueueSucceeded) {
          logger.error(
            '[defineDeferredSubscriber] enqueue succeeded but ledger write failed, event will be redelivered',
            opts.subscriberName, row.id, err,
          )
        } else {
          logger.error('[defineDeferredSubscriber] enqueue failed, queuing for retry', opts.subscriberName, row.id, err)
        }
        await enqueueForProcessingRetry(opts.subscriberName, event, err instanceof Error ? err.message : String(err)).catch(() => {})
        // Deliberately does NOT rethrow -- useEventSubscription's watch loop must keep
        // running for later events (mirrors runDurableSubscriber's invariant 3).
      }
    },
    { shopId: opts.shopId },
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/deferredSubscriber.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/events/deferredSubscriber.ts src/services/events/__tests__/deferredSubscriber.test.ts
git commit -m "feat(WAFI-154): add defineDeferredSubscriber with redelivery dedup ledger and retry-queue glue"
```

---

### Task 4: `drainDeferredJobs` core — claim query, priority/FIFO, connectivity filter, unregistered-type filter

**Files:**
- Create: `src/services/events/drainDeferredJobs.ts`
- Test: `src/services/events/__tests__/drainDeferredJobs.test.ts`

**Interfaces:**
- Consumes: `getRegisteredJobTypes`/`getJobTypePolicy` (Task 2), `isTransientEventFailure` (existing), `BACKOFF_MINUTES`/`MAX_ATTEMPTS`/`DEFERRED_JOB_LEASE_MINUTES` (Task 1).
- Produces: `drainDeferredJobs(shopId: string, opts?: { isConnected?: () => boolean; isForegrounded?: () => boolean; workerId?: string }): Promise<void>` (options exist so tests can control connectivity/foreground state deterministically; production callers omit them and get real defaults — wired in Task 8).

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/drainDeferredJobs.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'
import { drainDeferredJobs } from '@/services/events/drainDeferredJobs'
import { registerJobHandler, resetJobTypeRegistry } from '@/services/events/jobTypeRegistry'

async function freshDb() {
  const database = createRealSqliteDb()
  await initLocalDeferredJobsSchema(database)
  return database
}
async function seed(database: any, row: Partial<Record<string, unknown>>) {
  const defaults = {
    id: crypto.randomUUID(), job_type: 'test.a', shop_id: 'shop1', payload: '{}',
    priority: 'normal', requires_network: 0, status: 'queued', attempts: 0,
    enqueued_at: new Date().toISOString(),
  }
  const merged = { ...defaults, ...row }
  const cols = Object.keys(merged)
  await database.execute(
    `INSERT INTO local_deferred_jobs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    Object.values(merged),
  )
  return merged
}

describe('drainDeferredJobs', () => {
  beforeEach(() => resetJobTypeRegistry())

  it('claims and completes an offline-capable job while offline', async () => {
    const database = createRealSqliteDb() // note: drainDeferredJobs is written against the real `db` import in Task 7; this task's tests exercise the pure query/ordering logic via an injectable db param added alongside opts (see Step 3's `database` param)
    await initLocalDeferredJobsSchema(database)
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, { requires_network: 0 })
    await drainDeferredJobs('shop1', { isConnected: () => false, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
    const row = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('completed')
  })

  it('does not select a requires_network job while offline', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.net', handler, priority: 'normal', requiresNetwork: true, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.net', requires_network: 1 })
    await drainDeferredJobs('shop1', { isConnected: () => false, isForegrounded: () => true }, database)
    expect(handler).not.toHaveBeenCalled()
    const row = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.net'`)
    expect(row.status).toBe('queued')
  })

  it('selects a requires_network job once connected', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.net', handler, priority: 'normal', requiresNetwork: true, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.net', requires_network: 1 })
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('processes critical before normal, FIFO within the same priority across different job types', async () => {
    const database = await freshDb()
    const order: string[] = []
    registerJobHandler({ jobType: 'test.a', handler: async (j) => { order.push(`a:${(j.payload as any).n}`) }, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    registerJobHandler({ jobType: 'test.b', handler: async (j) => { order.push(`b:${(j.payload as any).n}`) }, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    registerJobHandler({ jobType: 'test.crit', handler: async () => { order.push('crit') }, priority: 'critical', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.a', payload: '{"n":1}', enqueued_at: '2026-08-12T00:00:00.000Z' })
    await seed(database, { job_type: 'test.b', payload: '{"n":1}', enqueued_at: '2026-08-12T00:00:01.000Z' })
    await seed(database, { job_type: 'test.a', payload: '{"n":2}', enqueued_at: '2026-08-12T00:00:02.000Z' })
    await seed(database, { job_type: 'test.crit', priority: 'critical', enqueued_at: '2026-08-12T00:00:03.000Z' })
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(order).toEqual(['crit', 'a:1', 'b:1', 'a:2']) // critical first, then strict FIFO across a/b regardless of type
  })

  it('never selects a row whose job type has no registered handler, and does not block other rows', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.known', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, { job_type: 'test.unknown', enqueued_at: '2026-08-12T00:00:00.000Z' })
    await seed(database, { job_type: 'test.known', enqueued_at: '2026-08-12T00:00:01.000Z' })
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
    const unknownRow = await database.getOptional<any>(`SELECT status FROM local_deferred_jobs WHERE job_type = 'test.unknown'`)
    expect(unknownRow.status).toBe('queued') // untouched, never claimed
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the core claim/execute loop (lease, backoff, and yield/single-flight come in Tasks 5-6; this step covers selection, ordering, execution, and completion only)**

```ts
// src/services/events/drainDeferredJobs.ts
import { db as appDb } from '@/data/powersync/db'
import { getJobTypePolicy, getRegisteredJobTypes } from '@/services/events/jobTypeRegistry'

type DbLike = Pick<typeof appDb, 'execute' | 'getAll' | 'getOptional' | 'writeTransaction'>

export interface DrainOptions {
  isConnected?: () => boolean
  isForegrounded?: () => boolean
  workerId?: string
}

async function claimNext(database: DbLike, shopId: string, connected: boolean): Promise<any | null> {
  const registeredTypes = getRegisteredJobTypes()
  if (registeredTypes.length === 0) return null
  const placeholders = registeredTypes.map(() => '?').join(',')
  const rows = await database.getAll<any>(
    `SELECT * FROM local_deferred_jobs
     WHERE shop_id = ?
       AND status = 'queued'
       AND job_type IN (${placeholders})
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
       AND (requires_network = 0 OR ? = 1)
     ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC, enqueued_at ASC
     LIMIT 1`,
    [shopId, ...registeredTypes, new Date().toISOString(), connected ? 1 : 0],
  )
  return rows[0] ?? null
}

export async function drainDeferredJobs(shopId: string, opts: DrainOptions = {}, database: DbLike = appDb): Promise<void> {
  const isConnected = opts.isConnected ?? (() => true)
  const isForegrounded = opts.isForegrounded ?? (() => true)

  while (true) {
    const row = await claimNext(database, shopId, isConnected())
    if (!row) return

    const policy = getJobTypePolicy(row.job_type)
    if (!policy) continue // structurally shouldn't happen (claimNext already filters), defensive only

    await database.execute(`UPDATE local_deferred_jobs SET status = 'running' WHERE id = ?`, [row.id])
    try {
      await policy.handler({ id: row.id, payload: JSON.parse(row.payload) })
      await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
        new Date().toISOString(), row.id,
      ])
    } catch {
      // Retry/lease/attempts-count semantics land in Task 5 -- this step only proves
      // selection/ordering/execution work; a bare failure here is refined next.
      await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
        new Date().toISOString(), row.id,
      ])
    }

    if (!isForegrounded()) return
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts`
Expected: PASS, all 5 tests. (The catch-block's placeholder "mark completed on failure" is intentionally wrong and gets replaced in Task 5 — none of this task's tests exercise a failing handler, so this doesn't cause a false pass; Task 5 adds the tests that would catch it.)

- [ ] **Step 5: Commit**

```bash
git add src/services/events/drainDeferredJobs.ts src/services/events/__tests__/drainDeferredJobs.test.ts
git commit -m "feat(WAFI-154): add drainDeferredJobs claim/select/execute core with priority+FIFO ordering and connectivity/registration filtering"
```

---

### Task 5: Lease-based stale-`running` reclaim, `attempts`/`MAX_ATTEMPTS`, retry backoff reuse

**Files:**
- Modify: `src/services/events/drainDeferredJobs.ts`
- Modify: `src/services/events/__tests__/drainDeferredJobs.test.ts`

**Interfaces:**
- Consumes: `isTransientEventFailure` (existing, `src/services/events/isTransientEventFailure.ts`), `BACKOFF_MINUTES`/`MAX_ATTEMPTS`/`DEFERRED_JOB_LEASE_MINUTES` (Task 1).

- [ ] **Step 1: Write the failing tests**

Add to `drainDeferredJobs.test.ts`:

```ts
  it('reclaims a stale running row (expired lease) before claiming new work', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockResolvedValue(undefined)
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    const staleId = crypto.randomUUID()
    await database.execute(
      `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, worker_id, started_at, lease_expires_at, enqueued_at)
       VALUES (?, 'test.a', 'shop1', '{}', 'normal', 0, 'running', 1, 'old-worker', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:01.000Z', '2026-08-12T00:00:00.000Z')`,
      [staleId],
    )
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    expect(handler).toHaveBeenCalledTimes(1)
    const row = await database.getOptional<any>(`SELECT status, worker_id FROM local_deferred_jobs WHERE id = ?`, [staleId])
    expect(row.status).toBe('completed') // reclaimed to queued, then claimed and run to completion
  })

  it('a transient failure returns the row to queued with next_retry_at on the shared backoff schedule', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockRejectedValue(new Error('database is locked'))
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, {})
    const before = new Date()
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    const row = await database.getOptional<any>(`SELECT status, attempts, next_retry_at FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(1)
    const retryAt = new Date(row.next_retry_at)
    expect(retryAt.getTime()).toBeGreaterThan(before.getTime()) // roughly ~1 minute out per BACKOFF_MINUTES[0], jittered
  })

  it('a permanent failure moves straight to dead after the current (already-counted) attempt', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockRejectedValue(new Error('malformed payload'))
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, {})
    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    const row = await database.getOptional<any>(`SELECT status, attempts, next_retry_at FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('dead')
    expect(row.attempts).toBe(1)
    expect(row.next_retry_at).toBeNull()
  })

  it('a job that fails MAX_ATTEMPTS times transiently ends up dead, not retried a 6th time', async () => {
    const database = await freshDb()
    const handler = vi.fn().mockRejectedValue(new Error('database is locked'))
    registerJobHandler({ jobType: 'test.a', handler, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    await seed(database, {})
    for (let i = 0; i < 5; i++) {
      // Force next_retry_at into the past between rounds so claimNext picks the row up again immediately.
      await database.execute(`UPDATE local_deferred_jobs SET next_retry_at = '2020-01-01T00:00:00.000Z' WHERE job_type = 'test.a'`)
      await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    }
    expect(handler).toHaveBeenCalledTimes(5) // exactly MAX_ATTEMPTS real executions, the 5th claim still ran the handler
    const row = await database.getOptional<any>(`SELECT status, attempts FROM local_deferred_jobs WHERE job_type = 'test.a'`)
    expect(row.status).toBe('dead')
    expect(row.attempts).toBe(5)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts`
Expected: FAIL on the 4 new tests (lease reclaim not implemented; failure path always marks `completed`).

- [ ] **Step 3: Rewrite `drainDeferredJobs.ts` with lease reclaim, attempts, and backoff**

```ts
// src/services/events/drainDeferredJobs.ts
import { db as appDb } from '@/data/powersync/db'
import { getJobTypePolicy, getRegisteredJobTypes } from '@/services/events/jobTypeRegistry'
import { isTransientEventFailure } from '@/services/events/isTransientEventFailure'
import { DEFERRED_JOB_LEASE_MINUTES, MAX_ATTEMPTS, BACKOFF_MINUTES } from '@/services/events/deferredJob.constants'
import { reportDeferredJobDead } from '@/services/events/reportDeferredJobDead'

type DbLike = Pick<typeof appDb, 'execute' | 'getAll' | 'getOptional' | 'writeTransaction'>

export interface DrainOptions {
  isConnected?: () => boolean
  isForegrounded?: () => boolean
  workerId?: string
}

function nextRetryAt(attempts: number): string {
  const baseMinutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]
  const jitter = 0.8 + Math.random() * 0.4
  return new Date(Date.now() + baseMinutes * 60_000 * jitter).toISOString()
}

async function reclaimStaleLeases(database: DbLike, shopId: string): Promise<void> {
  await database.execute(
    `UPDATE local_deferred_jobs
       SET status = 'queued', worker_id = NULL, started_at = NULL, lease_expires_at = NULL
     WHERE shop_id = ? AND status = 'running' AND lease_expires_at <= ?`,
    [shopId, new Date().toISOString()],
  )
}

async function claimNext(database: DbLike, shopId: string, connected: boolean, workerId: string): Promise<any | null> {
  const registeredTypes = getRegisteredJobTypes()
  if (registeredTypes.length === 0) return null
  const placeholders = registeredTypes.map(() => '?').join(',')
  const rows = await database.getAll<any>(
    `SELECT * FROM local_deferred_jobs
     WHERE shop_id = ?
       AND status = 'queued'
       AND job_type IN (${placeholders})
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
       AND (requires_network = 0 OR ? = 1)
     ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC, enqueued_at ASC
     LIMIT 1`,
    [shopId, ...registeredTypes, new Date().toISOString(), connected ? 1 : 0],
  )
  const row = rows[0]
  if (!row) return null

  const now = new Date()
  const leaseExpires = new Date(now.getTime() + DEFERRED_JOB_LEASE_MINUTES * 60_000)
  await database.execute(
    `UPDATE local_deferred_jobs
       SET status = 'running', attempts = attempts + 1, worker_id = ?, started_at = ?, lease_expires_at = ?
     WHERE id = ?`,
    [workerId, now.toISOString(), leaseExpires.toISOString(), row.id],
  )
  return { ...row, attempts: row.attempts + 1 }
}

export async function drainDeferredJobs(shopId: string, opts: DrainOptions = {}, database: DbLike = appDb): Promise<void> {
  const isConnected = opts.isConnected ?? (() => true)
  const isForegrounded = opts.isForegrounded ?? (() => true)
  const workerId = opts.workerId ?? crypto.randomUUID()

  await reclaimStaleLeases(database, shopId)

  while (true) {
    const row = await claimNext(database, shopId, isConnected(), workerId)
    if (!row) return

    const policy = getJobTypePolicy(row.job_type)
    if (!policy) continue // defensive only; claimNext already filters to registered types

    try {
      await policy.handler({ id: row.id, payload: JSON.parse(row.payload) })
      await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
        new Date().toISOString(), row.id,
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const transient = isTransientEventFailure(err)
      if (transient && row.attempts < MAX_ATTEMPTS) {
        await database.execute(
          `UPDATE local_deferred_jobs
             SET status = 'queued', last_error = ?, next_retry_at = ?, worker_id = NULL, started_at = NULL, lease_expires_at = NULL
           WHERE id = ?`,
          [message, nextRetryAt(row.attempts), row.id],
        )
      } else {
        await database.execute(
          `UPDATE local_deferred_jobs SET status = 'dead', last_error = ?, finished_at = ? WHERE id = ?`,
          [message, new Date().toISOString(), row.id],
        )
        await reportDeferredJobDead({ ...row, last_error: message }, err instanceof Error ? err : undefined)
      }
    }

    if (!isForegrounded()) return
  }
}
```

Note: Task 6 adds the macrotask yield and single-flight guard around this same loop; Task 7 fills in `reportDeferredJobDead` (imported here as a forward reference — write it as a no-op stub for now so this task's tests pass, then replace in Task 7).

- [ ] **Step 3b: Add the temporary `reportDeferredJobDead` stub**

```ts
// src/services/events/reportDeferredJobDead.ts (temporary stub -- replaced in Task 7)
export async function reportDeferredJobDead(_row: unknown, _error?: Error): Promise<void> {
  // no-op until Task 7
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts`
Expected: PASS, all 9 tests (5 from Task 4 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/services/events/drainDeferredJobs.ts src/services/events/reportDeferredJobDead.ts src/services/events/__tests__/drainDeferredJobs.test.ts
git commit -m "feat(WAFI-154): add lease-based stale-running reclaim, claim-time attempts counting, and shared backoff/dead-transition logic"
```

---

### Task 6: Macrotask-yielding drain loop and single-flight guard

**Files:**
- Modify: `src/services/events/drainDeferredJobs.ts`
- Modify: `src/services/events/__tests__/drainDeferredJobs.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  it('yields via a macrotask between jobs and stops immediately once backgrounded', async () => {
    const database = await freshDb()
    const executionOrder: number[] = []
    let backgroundedAfter = 0
    registerJobHandler({
      jobType: 'test.a',
      handler: async (j) => { executionOrder.push((j.payload as any).n) },
      priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200,
    })
    await seed(database, { payload: '{"n":1}', enqueued_at: '2026-08-12T00:00:00.000Z' })
    await seed(database, { payload: '{"n":2}', enqueued_at: '2026-08-12T00:00:01.000Z' })
    await seed(database, { payload: '{"n":3}', enqueued_at: '2026-08-12T00:00:02.000Z' })

    let calls = 0
    await drainDeferredJobs('shop1', {
      isConnected: () => true,
      isForegrounded: () => { calls += 1; return calls <= 1 }, // foregrounded for job 1's post-check only
    }, database)

    expect(executionOrder).toEqual([1]) // stopped after the first job, never reached 2 or 3
    const remaining = await database.getAll<any>(`SELECT status FROM local_deferred_jobs WHERE status = 'queued'`)
    expect(remaining.length).toBe(2)
  })

  it('single-flight: a second concurrent drain call reuses the first in-flight drain rather than claiming independently', async () => {
    const database = await freshDb()
    let resolveFirst: () => void
    const gate = new Promise<void>((resolve) => { resolveFirst = resolve })
    let handlerCalls = 0
    registerJobHandler({
      jobType: 'test.a',
      handler: async () => { handlerCalls += 1; await gate },
      priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200,
    })
    await seed(database, {})

    const first = drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    const second = drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)
    resolveFirst!()
    await Promise.all([first, second])

    expect(handlerCalls).toBe(1) // only ever claimed and ran once, not twice
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts`
Expected: FAIL — no yield point exists yet (the "stop after job 1" test would actually process all 3, since nothing yields control back for `isForegrounded` timing to matter the way the test expects... in practice this test's `calls <= 1` trick still passes without a yield since it's a synchronous check-count regardless — **the yield itself is not observable through job *ordering*, only through real wall-clock/task-queue interleaving with other browser work**, so the meaningful failing test here is the single-flight one). Confirm the single-flight test fails (both drains claim the row, or the second claim finds nothing but `handlerCalls` still shows contention/errors depending on implementation — the concrete failure mode to expect is `handlerCalls === 2` or a thrown "row not found" from a race, since nothing currently prevents `second`'s claim from running while `first` awaits the gated handler).

- [ ] **Step 3: Add the macrotask yield and single-flight guard**

```ts
// Add near the top of drainDeferredJobs.ts, alongside the other module-level state:
const inFlightDrains = new Map<string, Promise<void>>()

function yieldToMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Rename the existing exported function's body into an internal `runDrain`, and make
// the exported `drainDeferredJobs` the single-flight wrapper:
async function runDrain(shopId: string, opts: DrainOptions, database: DbLike): Promise<void> {
  const isConnected = opts.isConnected ?? (() => true)
  const isForegrounded = opts.isForegrounded ?? (() => true)
  const workerId = opts.workerId ?? crypto.randomUUID()

  await reclaimStaleLeases(database, shopId)

  while (true) {
    const row = await claimNext(database, shopId, isConnected(), workerId)
    if (!row) return

    const policy = getJobTypePolicy(row.job_type)
    if (!policy) continue

    try {
      await policy.handler({ id: row.id, payload: JSON.parse(row.payload) })
      await database.execute(`UPDATE local_deferred_jobs SET status = 'completed', finished_at = ? WHERE id = ?`, [
        new Date().toISOString(), row.id,
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const transient = isTransientEventFailure(err)
      if (transient && row.attempts < MAX_ATTEMPTS) {
        await database.execute(
          `UPDATE local_deferred_jobs
             SET status = 'queued', last_error = ?, next_retry_at = ?, worker_id = NULL, started_at = NULL, lease_expires_at = NULL
           WHERE id = ?`,
          [message, nextRetryAt(row.attempts), row.id],
        )
      } else {
        await database.execute(
          `UPDATE local_deferred_jobs SET status = 'dead', last_error = ?, finished_at = ? WHERE id = ?`,
          [message, new Date().toISOString(), row.id],
        )
        await reportDeferredJobDead({ ...row, last_error: message }, err instanceof Error ? err : undefined)
      }
    }

    // Macrotask yield -- NOT a microtask -- so the browser gets a real opportunity to
    // dispatch visibilitychange between jobs (design spec's Concurrency section:
    // `await Promise.resolve()` would not be sufficient here).
    await yieldToMacrotask()
    if (!isForegrounded()) return
  }
}

export async function drainDeferredJobs(shopId: string, opts: DrainOptions = {}, database: DbLike = appDb): Promise<void> {
  const existing = inFlightDrains.get(shopId)
  if (existing) return existing

  const promise = runDrain(shopId, opts, database).finally(() => {
    inFlightDrains.delete(shopId)
  })
  inFlightDrains.set(shopId, promise)
  return promise
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/events/drainDeferredJobs.ts src/services/events/__tests__/drainDeferredJobs.test.ts
git commit -m "feat(WAFI-154): add macrotask-yielding drain loop and single-flight guard on drainDeferredJobs"
```

---

### Task 7: `reportDeferredJobDead` — Sentry failure observability

**Files:**
- Modify: `src/services/events/reportDeferredJobDead.ts`
- Test: `src/services/events/__tests__/reportDeferredJobDead.test.ts`

**Interfaces:**
- Consumes: `Sentry` (`@sentry/vue`, already installed per WAFI-023's `src/sentry.ts`).
- Produces: `reportDeferredJobDead(row: { job_type: string; shop_id: string; attempts: number; last_error: string | null }, error?: Error): Promise<void>` (replaces Task 5's stub).

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/events/__tests__/reportDeferredJobDead.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureException = vi.fn()
const captureMessage = vi.fn()
vi.mock('@sentry/vue', () => ({ captureException, captureMessage }))

import { reportDeferredJobDead } from '@/services/events/reportDeferredJobDead'

const row = { job_type: 'test.a', shop_id: 'shop1', attempts: 5, last_error: 'boom', payload: '{"secret":"nope"}' }

describe('reportDeferredJobDead', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses captureException with structured context when a live Error is passed', async () => {
    const err = new Error('boom')
    await reportDeferredJobDead(row, err)
    expect(captureException).toHaveBeenCalledWith(err, expect.objectContaining({
      extra: { job_type: 'test.a', shop_id: 'shop1', attempts: 5 },
    }))
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('falls back to captureMessage with row.last_error when no live Error is available', async () => {
    await reportDeferredJobDead(row)
    expect(captureMessage).toHaveBeenCalledWith('boom', expect.objectContaining({
      extra: { job_type: 'test.a', shop_id: 'shop1', attempts: 5 },
    }))
    expect(captureException).not.toHaveBeenCalled()
  })

  it('never includes payload in either call', async () => {
    await reportDeferredJobDead(row, new Error('boom'))
    const call = captureException.mock.calls[0]
    expect(JSON.stringify(call)).not.toContain('secret')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/events/__tests__/reportDeferredJobDead.test.ts`
Expected: FAIL — current stub does nothing.

- [ ] **Step 3: Implement `reportDeferredJobDead`**

```ts
// src/services/events/reportDeferredJobDead.ts
import * as Sentry from '@sentry/vue'

interface DeadJobRow {
  job_type: string
  shop_id: string
  attempts: number
  last_error: string | null
}

/**
 * WAFI-154 Failure Observability: reuses the existing Sentry integration (WAFI-023),
 * best-effort, never part of the queue's own durability guarantee (that ends at the
 * SQLite state transition -- see design spec). Explicitly never includes `payload` --
 * only job_type/shop_id/attempts, consistent with WAFI-023's PII-scrubbing posture.
 */
export async function reportDeferredJobDead(row: DeadJobRow, error?: Error): Promise<void> {
  const extra = { job_type: row.job_type, shop_id: row.shop_id, attempts: row.attempts }
  if (error) {
    Sentry.captureException(error, { extra })
  } else {
    Sentry.captureMessage(row.last_error ?? 'deferred job reached dead with no error message', { extra })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/events/__tests__/reportDeferredJobDead.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/events/reportDeferredJobDead.ts src/services/events/__tests__/reportDeferredJobDead.test.ts
git commit -m "feat(WAFI-154): implement reportDeferredJobDead via existing Sentry integration"
```

---

### Task 8: Retention purge for `completed`/`dead`/`evicted` rows

**Files:**
- Modify: `src/services/events/drainDeferredJobs.ts`
- Modify: `src/services/events/__tests__/drainDeferredJobs.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  it('purges completed/dead/evicted rows past the retention window at the end of a drain pass', async () => {
    const database = await freshDb()
    registerJobHandler({ jobType: 'test.a', handler: async () => {}, priority: 'normal', requiresNetwork: false, maxQueuedJobs: 200 })
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 days ago
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    await seed(database, { id: 'old-completed', status: 'completed', finished_at: old })
    await seed(database, { id: 'old-dead', status: 'dead', finished_at: old })
    await seed(database, { id: 'old-evicted', status: 'evicted', finished_at: old })
    await seed(database, { id: 'recent-completed', status: 'completed', finished_at: recent })

    await drainDeferredJobs('shop1', { isConnected: () => true, isForegrounded: () => true }, database)

    const remainingIds = (await database.getAll<any>(`SELECT id FROM local_deferred_jobs`)).map((r: any) => r.id)
    expect(remainingIds).not.toContain('old-completed')
    expect(remainingIds).not.toContain('old-dead')
    expect(remainingIds).not.toContain('old-evicted')
    expect(remainingIds).toContain('recent-completed')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts -t "purges completed"`
Expected: FAIL — no purge exists yet.

- [ ] **Step 3: Add the purge to `runDrain`**

In `drainDeferredJobs.ts`, import `RETENTION_DAYS` from the constants file, and add a purge call at the start of `runDrain` (after `reclaimStaleLeases`, before the claim loop — purging first means a drain pass that finds nothing new to claim still cleans up):

```ts
async function purgeExpiredRows(database: DbLike, shopId: string): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await database.execute(
    `DELETE FROM local_deferred_jobs
     WHERE shop_id = ? AND status IN ('completed', 'dead', 'evicted') AND finished_at <= ?`,
    [shopId, cutoff],
  )
}
```

And in `runDrain`, right after `await reclaimStaleLeases(database, shopId)`:

```ts
  await reclaimStaleLeases(database, shopId)
  await purgeExpiredRows(database, shopId)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/events/__tests__/drainDeferredJobs.test.ts`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/events/drainDeferredJobs.ts src/services/events/__tests__/drainDeferredJobs.test.ts
git commit -m "feat(WAFI-154): purge completed/dead/evicted rows past the 7-day retention window on each drain pass"
```

---

### Task 9: Offline-restart persistence test and index-creation app-init wiring

**Files:**
- Test: `src/services/events/__tests__/deferredJobsRestart.test.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `initLocalDeferredJobsSchema` (Task 1), `drainDeferredJobs` (Tasks 4-8), `db.registerListener` (existing, same pattern `startProcessingRetrySweeper` uses).
- Produces: `startDeferredJobWorker(shopId: string): { stop: () => void }` in a new `src/services/events/deferredJobWorker.ts`.

- [ ] **Step 1: Write the restart-durability test against a real on-disk file**

```ts
// src/services/events/__tests__/deferredJobsRestart.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRealSqliteDb } from '@/__tests__/helpers/realSqliteDb'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'

describe('local_deferred_jobs survives a real connection close/reopen', () => {
  it('a queued row is intact after closing and reopening the same on-disk database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wafi154-'))
    const path = join(dir, 'test.sqlite')
    try {
      const first = createRealSqliteDb(path)
      await initLocalDeferredJobsSchema(first)
      await first.execute(
        `INSERT INTO local_deferred_jobs (id, job_type, shop_id, payload, priority, requires_network, status, attempts, enqueued_at)
         VALUES ('row1', 'test.a', 'shop1', '{"n":1}', 'normal', 0, 'queued', 0, '2026-08-12T00:00:00.000Z')`,
      )
      first.close() // genuinely closes this connection -- not a second in-process handle sharing state

      const second = createRealSqliteDb(path) // reopens the SAME on-disk file
      const row = await second.getOptional<any>(`SELECT * FROM local_deferred_jobs WHERE id = 'row1'`)
      expect(row).toBeDefined()
      expect(row.status).toBe('queued')
      expect(JSON.parse(row.payload).n).toBe(1)
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it passes** (this test should pass immediately — it validates the harness itself, not new application code)

Run: `npx vitest run src/services/events/__tests__/deferredJobsRestart.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `startDeferredJobWorker`**

```ts
// src/services/events/deferredJobWorker.ts
import { db } from '@/data/powersync/db'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'
import { drainDeferredJobs } from '@/services/events/drainDeferredJobs'

/**
 * WAFI-154 worker triggers: app foreground/visibility and PowerSync reconnect, no
 * polling timer (design spec's Worker Triggers section). Zero real job types are
 * registered by this ticket, so in production this currently drains an always-empty
 * queue until a future ticket calls registerJobHandler for a real job type -- that is
 * expected, not a bug (see design spec's Out of Scope).
 */
export function startDeferredJobWorker(shopId: string): { stop: () => void } {
  void initLocalDeferredJobsSchema(db)

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void drainDeferredJobs(shopId)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  void drainDeferredJobs(shopId) // also attempt once at startup, matching startNotificationSubscribers/startAuditSubscribers's mount-time pattern

  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void drainDeferredJobs(shopId)
    },
  })

  return {
    stop: () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribe?.()
    },
  }
}
```

- [ ] **Step 4: Wire into `App.vue`**

In `src/App.vue`, alongside the other `start*` calls in the same mounted block as `startAuditSubscribers`/`startNotificationSubscribers` (see the existing block around line 146-157):

```ts
  // WAFI-154: deferred execution tier worker -- no real job types registered yet
  // (this ticket ships infrastructure only, see design spec's Out of Scope), but the
  // trigger wiring itself is real so the first future job type has nothing left to wire.
  startDeferredJobWorker(useDeviceStore().shopId)
```

Add the import at the top of `App.vue` alongside the other `services/events` imports:

```ts
import { startDeferredJobWorker } from '@/services/events/deferredJobWorker'
```

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: all pre-existing tests still pass; no `App.vue`-related snapshot/mount test breaks (check `App.test.ts` if one exists — search first: `Get-ChildItem src -Filter App.test.ts -Recurse`).

- [ ] **Step 6: Commit**

```bash
git add src/services/events/deferredJobWorker.ts src/services/events/__tests__/deferredJobsRestart.test.ts src/App.vue
git commit -m "feat(WAFI-154): wire deferred job worker triggers (foreground + reconnect) into App.vue"
```

---

## Outstanding manual steps, not closeable by this plan

- **Browser/PWA verification of the structured SQLite error code** (Task 1's spike used `node:sqlite`, not the actual PowerSync client runtime) — confirm on a real device/browser build that the same `(job_type, dedupe_key)` unique-constraint violation surfaces the same distinguishable error shape before treating this as production-verified.
- **No real production job type exists yet** — this ticket is infrastructure-ahead-of-need by design. The first real consumer (most likely PDF receipts) is a separate future ticket that calls `registerJobHandler`/`defineDeferredSubscriber` following the Call-Site Convention already documented in the design spec.
