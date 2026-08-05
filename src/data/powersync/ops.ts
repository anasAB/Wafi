import { UpdateType } from '@powersync/web'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '@/data/supabase/client'

/** Apply one CRUD op to Supabase, returning the PostgrestError (or null on success).
 *  Exported for unit testing the append-only audit_log guard and for replaying a
 *  quarantined op from the dead-letter holding (see dead-letter.ts). */
export async function runOp(
  type: UpdateType,
  table: string,
  id: string,
  opData: Record<string, unknown> | undefined,
): Promise<PostgrestError | null> {
  // audit_log is append-only at the DB (migration 018): a BEFORE UPDATE/DELETE
  // trigger hard-rejects any modification. PowerSync emits inserts as PUT, which
  // we'd normally upsert (ON CONFLICT DO UPDATE) — but a retried batch can
  // re-send an already-synced audit row, and that conflicting UPDATE would trip
  // the trigger and JAM sync forever. So for audit_log: insert-only with
  // ON CONFLICT DO NOTHING (ignoreDuplicates), and never PATCH/DELETE.
  if (table === 'audit_log') {
    if (type !== UpdateType.PUT) return null
    return (await supabase.from(table).upsert({ id, ...opData }, { ignoreDuplicates: true })).error
  }

  switch (type) {
    case UpdateType.PUT:
      return (await supabase.from(table).upsert({ id, ...opData })).error
    case UpdateType.PATCH:
      return (await supabase.from(table).update(opData!).eq('id', id)).error
    case UpdateType.DELETE:
      return (await supabase.from(table).delete().eq('id', id)).error
    default:
      return null
  }
}

// SQLSTATE classes whose rejection is a property of the row itself — it will
// fail identically on every retry, so retrying forever just jams the queue:
//   22xxx — data exception (bad value, truncation, invalid representation)
//   23xxx — integrity constraint violation (unique / FK / check / not-null)
const PERMANENT_SQLSTATE_CLASS = /^(22|23)/
// insufficient_privilege — how a Row-Level-Security denial surfaces.
const RLS_DENIED = '42501'

/**
 * Distinguish a *permanent* server rejection (the write will never succeed as-is
 * — constraint violation, RLS denial, malformed row) from a *transient* one
 * (offline, 5xx, connection reset, statement timeout) which must keep retrying.
 *
 * Bias: only codes we're confident are permanent return true. Anything unknown —
 * including a missing code, which is what a fetch/network failure produces — is
 * treated as transient so a genuine sale is never quarantined over a blip.
 */
export function isPermanentError(error: PostgrestError): boolean {
  const code = error.code ?? ''
  if (PERMANENT_SQLSTATE_CLASS.test(code)) return true
  if (code === RLS_DENIED) return true
  // PostgREST emits its own PGRSTxxx codes for schema-cache / RLS / parse
  // rejections — all of which are deterministic given the same request.
  if (code.startsWith('PGRST')) return true
  // WAFI-140 Sprint 3 final review: a rate-limited events insert (076_events_rate_limit.sql
  // raises 'events_rate_limit_exceeded' with SQLSTATE P0001) must NOT block the shared upload
  // batch. Without this, it classifies as transient, and connector.ts re-queues the WHOLE
  // batch of up to 100 ops -- sales, payments, shift closes -- behind it indefinitely. An
  // event is best-effort telemetry (this ticket's posture throughout), so losing one to
  // quarantine is strictly better than stalling unrelated financial writes. Scoped to this
  // exact message rather than the whole P0001 SQLSTATE class: P0001 is used nowhere else in
  // this codebase's migrations today, but "all P0001 is permanent" is a broader claim than
  // the evidence for this finding supports.
  if (error.message?.includes('events_rate_limit_exceeded')) return true
  return false
}
