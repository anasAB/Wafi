#!/usr/bin/env node
// WAFI-148A: proves claim_health_alert_period() and claim_health_alert_transition()'s
// atomic conditional claims actually serialize two truly-concurrent callers
// instead of both winning -- the exact bug the claim/notify contract (see
// supabase/migrations/118_wafi148a_claim_functions.sql and
// supabase/tests/wafi148a_claim_functions_concurrent.test.sql) exists to
// prevent. Mirrors scripts/testing/wafi156-concurrent-rpc-test.mjs exactly.
//
// Two real Postgres connections race the SAME key for each function. Neither
// claim_health_alert_period nor claim_health_alert_transition is
// EXECUTE-granted to `authenticated` (they are internal building blocks with
// no public entry point yet -- see migration 118's REVOKE statements), so
// both connections here call as the plain admin/superuser role from
// DATABASE_URL rather than switching to `authenticated` the way the WAFI-156
// script does.
//
// Usage: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
//          node scripts/testing/wafi148a-concurrent-claim-test.mjs
//
// Requires the `pg` package (already a devDependency from WAFI-156's script).
// Requires a local Supabase stack already running (`npx supabase start`)
// with migrations applied (`npx supabase db reset`), so health_alert_state_a,
// health_alert_state_b, notifications, and this ticket's three claim
// functions exist.

import pg from 'pg'

const { Client } = pg

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres'

// Fixture IDs -- deliberately distinct from the pgTAP suite's fixture IDs
// (wafi148a_claim_functions.test.sql / wafi148a_authorization.test.sql) so
// this script can be run against the same database without colliding, and
// re-run without manual cleanup (every INSERT below is preceded by a DELETE
// of any prior row with the same id).
const OWNER_ID = 'c0000000-0000-0000-0000-000000000001'
const SHOP_ID = 'c0000000-0000-0000-0000-000000000010'
const STALE_DEVICE_ENTITY_ID = 'c0000000-0000-0000-0000-000000000020'

async function setup(admin) {
  await admin.query(
    `INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
     VALUES ('00000000-0000-0000-0000-000000000000', $1, 'owner-wafi148a-concurrent@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_ID],
  )

  await admin.query(`DELETE FROM public.notifications WHERE shop_id = $1`, [SHOP_ID])
  await admin.query(`DELETE FROM public.health_alert_state_a WHERE shop_id = $1`, [SHOP_ID])
  await admin.query(`DELETE FROM public.health_alert_state_b WHERE shop_id = $1`, [SHOP_ID])
  await admin.query(`DELETE FROM public.shops WHERE id = $1`, [SHOP_ID])

  await admin.query(
    `INSERT INTO public.shops (id, name, owner_user_id) VALUES ($1, 'WAFI-148A Concurrent Test Shop', $2)`,
    [SHOP_ID, OWNER_ID],
  )
}

async function plainClient() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  return client
}

async function raceTwoConnections(sql, params) {
  const clientA = await plainClient()
  const clientB = await plainClient()

  // Deliberately NOT awaited before the second call: both requests are
  // dispatched essentially simultaneously, which is what makes this a real
  // overlap test rather than a race decided by JS event-loop ordering.
  const callA = clientA.query(sql, params)
  const callB = clientB.query(sql, params)

  const [settledA, settledB] = await Promise.allSettled([callA, callB])

  await clientA.end().catch(() => {})
  await clientB.end().catch(() => {})

  const outcomeOf = (settled) =>
    settled.status === 'fulfilled' ? settled.value.rows[0].result : `ERROR: ${settled.reason.message}`

  return [outcomeOf(settledA), outcomeOf(settledB)]
}

function checkExactlyOneTrueOneFalse(outcomes, label) {
  const sorted = [...outcomes].sort()
  const ok = JSON.stringify(sorted) === JSON.stringify([false, true])
  if (!ok) {
    console.error(`FAIL (${label}): expected exactly one true and one false, got`, outcomes)
  }
  return ok
}

async function scenarioPeriod(admin) {
  const sql = `SELECT public.claim_health_alert_period($1, $2, $3, $4, $5, $6, $7) AS result`
  const params = [SHOP_ID, 'sync_failures', '2026-08-20', 5, 'sync_failures', 'title', 'message']

  const outcomes = await raceTwoConnections(sql, params)
  console.log('Scenario 1 (claim_health_alert_period) results:', outcomes)

  let failed = !checkExactlyOneTrueOneFalse(outcomes, 'claim_health_alert_period')

  const { rows: notifRows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.notifications WHERE shop_id = $1 AND type = 'sync_failures'`,
    [SHOP_ID],
  )
  if (notifRows[0].n !== 1) {
    console.error('FAIL (claim_health_alert_period): expected exactly 1 notification row, got', notifRows[0].n)
    failed = true
  }

  const { rows: stateRows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.health_alert_state_a WHERE shop_id = $1 AND metric_key = 'sync_failures' AND period_start = '2026-08-20'`,
    [SHOP_ID],
  )
  if (stateRows[0].n !== 1) {
    console.error('FAIL (claim_health_alert_period): expected exactly 1 health_alert_state_a row, got', stateRows[0].n)
    failed = true
  }

  return !failed
}

async function scenarioTransition(admin) {
  const sql = `SELECT public.claim_health_alert_transition($1, $2, $3, $4, $5, $6) AS result`
  const params = [SHOP_ID, 'stale_device', STALE_DEVICE_ENTITY_ID, 'stale_device', 'title', 'message']

  const outcomes = await raceTwoConnections(sql, params)
  console.log('Scenario 2 (claim_health_alert_transition) results:', outcomes)

  let failed = !checkExactlyOneTrueOneFalse(outcomes, 'claim_health_alert_transition')

  const { rows: notifRows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.notifications WHERE shop_id = $1 AND type = 'stale_device'`,
    [SHOP_ID],
  )
  if (notifRows[0].n !== 1) {
    console.error('FAIL (claim_health_alert_transition): expected exactly 1 notification row, got', notifRows[0].n)
    failed = true
  }

  const { rows: stateRows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.health_alert_state_b WHERE shop_id = $1 AND alert_key = 'stale_device' AND entity_id = $2 AND state = 'ALERTING'`,
    [SHOP_ID, STALE_DEVICE_ENTITY_ID],
  )
  if (stateRows[0].n !== 1) {
    console.error('FAIL (claim_health_alert_transition): expected exactly 1 ALERTING health_alert_state_b row, got', stateRows[0].n)
    failed = true
  }

  return !failed
}

async function main() {
  const admin = new Client({ connectionString: DATABASE_URL })
  await admin.connect()
  await setup(admin)

  const scenario1Ok = await scenarioPeriod(admin)
  const scenario2Ok = await scenarioTransition(admin)

  await admin.end()

  if (!scenario1Ok || !scenario2Ok) {
    console.error('\nConcurrent claim test FAILED -- see failures above.')
    process.exit(1)
  }

  console.log('\nConcurrent claim test PASSED: both claim_health_alert_period and claim_health_alert_transition serialized correctly under real connection overlap.')
}

main().catch((err) => {
  console.error('Concurrent claim test errored:', err)
  process.exit(1)
})
