#!/usr/bin/env node
// WAFI-156: proves execute_rule_action()'s atomic conditional claim actually
// serializes two truly-concurrent callers instead of both winning (the exact
// bug this RPC's design (spec §2.3) exists to prevent -- see
// supabase/tests/wafi156_execute_rule_action_concurrent.test.sql for the
// full scenario writeup and why no artificial pg_sleep hook is used).
//
// Two real Postgres connections, each authenticated as the same shop owner,
// both call execute_rule_action for the SAME (event_id, rule_id) pair, fired
// back-to-back with no `await` between them so both requests are in flight
// against Postgres at (as close as JS can get to) the same instant. Whichever
// arrives first takes the row lock inside the RPC's `INSERT ... ON CONFLICT
// DO UPDATE`; the other blocks on that lock and then correctly finds nothing
// left to claim.
//
// Usage: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
//          node scripts/testing/wafi156-concurrent-rpc-test.mjs
//
// Requires the `pg` package (added to devDependencies for this script; not
// used anywhere else in the app bundle -- the app itself only ever talks to
// Postgres through supabase-js/PowerSync, never a raw driver).
// Requires a local Supabase stack already running (`npx supabase start`)
// with migrations applied (`npx supabase db reset`), so business_rules,
// rule_action_log and this ticket's execute_rule_action() function exist.

import pg from 'pg'

const { Client } = pg

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres'

// Fixture IDs -- deliberately distinct from the pgTAP suite's fixture IDs
// (wafi156_execute_rule_action.test.sql) so this script can be run against
// the same database without colliding, and re-run without manual cleanup
// (every INSERT below is preceded by a DELETE of any prior row with the same id).
const OWNER_ID = 'f0000000-0000-0000-0000-000000000041'
const SHOP_ID = 'f0000000-0000-0000-0000-000000000040'
const RULE_ID = 'f0000000-0000-0000-0000-000000000042'
const EVENT_ID = 'f0000000-0000-0000-0000-000000000043'

async function setup(admin) {
  await admin.query(
    `INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
     VALUES ('00000000-0000-0000-0000-000000000000', $1, 'owner-wafi156-concurrent@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_ID],
  )

  await admin.query(`DELETE FROM public.rule_action_log WHERE event_id = $1`, [EVENT_ID])
  await admin.query(`DELETE FROM public.notifications WHERE source_event_id = $1`, [EVENT_ID])
  await admin.query(`DELETE FROM public.events WHERE id = $1`, [EVENT_ID])
  await admin.query(`DELETE FROM public.business_rules WHERE id = $1`, [RULE_ID])
  await admin.query(`DELETE FROM public.shops WHERE id = $1`, [SHOP_ID])

  await admin.query(
    `INSERT INTO public.shops (id, name, owner_user_id) VALUES ($1, 'WAFI-156 Concurrent Test Shop', $2)`,
    [SHOP_ID, OWNER_ID],
  )
  await admin.query(
    `INSERT INTO public.business_rules (id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled)
     VALUES ($1, $2, 'large_return', 'إرجاع كبير', 'sale.returned', 'refundAmountUsd', 'none', 'gt', 100, 'notify_owner', true)`,
    [RULE_ID, SHOP_ID],
  )
  await admin.query(
    `INSERT INTO public.events (id, type, entity_id, payload, staff_id, shop_id, occurred_at)
     VALUES ($1, 'sale.returned', 'return-concurrent-1', $2, $3, $4, now())`,
    [
      EVENT_ID,
      JSON.stringify({
        returnId: 'return-concurrent-1',
        saleId: 'sale-concurrent-1',
        refundAmountUsd: 250,
        restockedItemCount: 1,
        cogsReversalUsd: 100,
        isFullReturn: true,
        saleWasCostless: false,
        originalSaleProjectionDay: '2026-08-14',
      }),
      OWNER_ID,
      SHOP_ID,
    ],
  )
}

async function authenticatedClient() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  // Mirrors the pgTAP fixture idiom (wafi156_execute_rule_action.test.sql):
  // set the JWT claims GUC session-wide (3rd arg `false`, not transaction-local)
  // so it survives across this client's separate statements, then switch role
  // so the EXECUTE grant applies.
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: OWNER_ID, active_role: 'owner' }),
  ])
  await client.query('SET ROLE authenticated')
  return client
}

async function main() {
  const admin = new Client({ connectionString: DATABASE_URL })
  await admin.connect()
  await setup(admin)

  const clientA = await authenticatedClient()
  const clientB = await authenticatedClient()

  const sql = 'SELECT public.execute_rule_action($1, $2) AS result'
  // Deliberately NOT awaited before the second call: both requests are
  // dispatched to the network/database queue essentially simultaneously,
  // which is what makes this a real overlap test rather than a race decided
  // by JS event-loop ordering.
  const callA = clientA.query(sql, [EVENT_ID, RULE_ID])
  const callB = clientB.query(sql, [EVENT_ID, RULE_ID])

  const [settledA, settledB] = await Promise.allSettled([callA, callB])

  const outcomeOf = (settled) =>
    settled.status === 'fulfilled' ? settled.value.rows[0].result : `ERROR: ${settled.reason.message}`

  const outcomeA = outcomeOf(settledA)
  const outcomeB = outcomeOf(settledB)
  console.log('Connection A result:', outcomeA)
  console.log('Connection B result:', outcomeB)

  await clientA.query('RESET ROLE').catch(() => {})
  await clientB.query('RESET ROLE').catch(() => {})
  await clientA.end()
  await clientB.end()

  const outcomes = [outcomeA, outcomeB].sort()
  const okOutcomes = JSON.stringify(outcomes) === JSON.stringify(['already_executed', 'executed'])

  const { rows: notifRows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.notifications WHERE source_event_id = $1`,
    [EVENT_ID],
  )
  const notificationCount = notifRows[0].n

  const { rows: logRows } = await admin.query(
    `SELECT attempts, executed_at FROM public.rule_action_log WHERE event_id = $1 AND rule_id = $2`,
    [EVENT_ID, RULE_ID],
  )

  await admin.end()

  let failed = false
  if (!okOutcomes) {
    console.error('FAIL: expected exactly one "executed" and one "already_executed", got', outcomes)
    failed = true
  }
  if (notificationCount !== 1) {
    console.error('FAIL: expected exactly 1 notification row, got', notificationCount)
    failed = true
  }
  if (logRows.length !== 1 || logRows[0].executed_at === null) {
    console.error('FAIL: expected exactly 1 rule_action_log row with executed_at set, got', logRows)
    failed = true
  } else if (Number(logRows[0].attempts) !== 2) {
    console.error('FAIL: expected rule_action_log.attempts = 2 (both calls hit the same row), got', logRows[0].attempts)
    failed = true
  }

  if (failed) {
    console.error('\nConcurrent claim test FAILED -- see failures above.')
    process.exit(1)
  }

  console.log('\nConcurrent claim test PASSED: exactly one executed, one already_executed, one notification, one log row.')
}

main().catch((err) => {
  console.error('Concurrent claim test errored:', err)
  process.exit(1)
})
