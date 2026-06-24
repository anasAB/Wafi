#!/usr/bin/env node
// Last-resort owner password reset via the Supabase Admin API. Ops tooling only —
// NOT part of the app bundle. Requires the service-role key (never in source).
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//          node scripts/admin/reset-owner-password.mjs --phone "+963944123456"
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const phoneArg = process.argv.indexOf('--phone')
if (phoneArg === -1 || !process.argv[phoneArg + 1]) { console.error('Pass --phone "<E.164 phone>"'); process.exit(1) }
const phone = process.argv[phoneArg + 1]

// Mirror src/data/supabase/auth.ts phoneToEmail — the login email is synthetic.
const email = `${phone.replace(/\D+/g, '')}@wafi.app`
const tempPassword = 'Wafi-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

// Find the user by their synthetic email, then set a new password.
// Paginate to collect all users (listUsers returns ~1000 per page).
let users = []
let page = 1
while (true) {
  const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (listErr) { console.error('listUsers failed:', listErr.message); process.exit(1) }
  users = users.concat(data.users)
  if (data.users.length < 1000) break
  page++
}
const user = users.find((u) => u.email === email)
if (!user) { console.error('No account for', email); process.exit(1) }

const { error } = await admin.auth.admin.updateUserById(user.id, { password: tempPassword })
if (error) { console.error('reset failed:', error.message); process.exit(1) }

console.log('Temporary password for', email, '\n\n   ', tempPassword, '\n\nTell the owner to change it right after signing in.')
