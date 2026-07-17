import type { AbstractPowerSyncDatabase } from '@powersync/web'
import { UpdateType } from '@powersync/web'
import type { CrudEntry } from '@powersync/common'
import type { PostgrestError } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { runOp, isPermanentError } from './ops'

/** One upload op the server permanently rejected, held locally for recovery. */
export interface DeadLetterEntry {
  id:            string
  client_id:     number
  op_type:       UpdateType
  table_name:    string
  row_id:        string
  op_data:       string | null
  error_code:    string | null
  error_message: string
  failed_at:     string
}

/** Outcome of an owner-triggered retry of a held op. */
export type RetryResult =
  | { status: 'recovered' }                  // server accepted it; op removed
  | { status: 'still-blocked'; message: string } // permanently rejected again; still held
  | { status: 'transient'; message: string }      // offline / server hiccup; still held

/**
 * Move a poison op into the local holding so the queue can drain past it without
 * the write ever being lost. Idempotent on `client_id`: a batch that gets
 * re-processed before it completes (a later transient op forced a retry) must
 * not duplicate the row. uploadData is serialized, so the check-then-insert is
 * race-free.
 */
export async function quarantineOp(
  db: AbstractPowerSyncDatabase,
  op: CrudEntry,
  error: PostgrestError,
): Promise<void> {
  const existing = await db.getOptional<{ id: string }>(
    `SELECT id FROM sync_dead_letter WHERE client_id = ?`,
    [op.clientId],
  )
  if (existing) return

  await db.execute(
    `INSERT INTO sync_dead_letter
       (id, client_id, op_type, table_name, row_id, op_data, error_code, error_message, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      op.clientId,
      op.op,
      op.table,
      op.id,
      op.opData ? JSON.stringify(op.opData) : null,
      error.code ?? null,
      error.message,
      new Date().toISOString(),
    ],
  )
}

export async function countDeadLetter(db: AbstractPowerSyncDatabase): Promise<number> {
  const [row] = await db.getAll<{ n: number }>(`SELECT count(*) AS n FROM sync_dead_letter`)
  return row?.n ?? 0
}

export async function listDeadLetter(db: AbstractPowerSyncDatabase): Promise<DeadLetterEntry[]> {
  return db.getAll<DeadLetterEntry>(
    `SELECT id, client_id, op_type, table_name, row_id, op_data, error_code, error_message, failed_at
       FROM sync_dead_letter ORDER BY failed_at ASC`,
  )
}

/**
 * Replay a held op directly against the server. The local row already reflects
 * the change (only the upload failed), so we re-issue the op via runOp rather
 * than re-mutating local data — this works uniformly for PUT/PATCH/DELETE.
 * On success the op leaves the holding; otherwise it stays put (never dropped).
 */
export async function retryDeadLetterOp(
  db: AbstractPowerSyncDatabase,
  id: string,
): Promise<RetryResult> {
  const row = await db.getOptional<DeadLetterEntry>(
    `SELECT id, client_id, op_type, table_name, row_id, op_data, error_code, error_message, failed_at
       FROM sync_dead_letter WHERE id = ?`,
    [id],
  )
  if (!row) return { status: 'recovered' } // already gone — treat as recovered (idempotent)

  const opData = row.op_data ? (JSON.parse(row.op_data) as Record<string, unknown>) : undefined
  const error = await runOp(row.op_type, row.table_name, row.row_id, opData)

  if (!error) {
    await db.execute(`DELETE FROM sync_dead_letter WHERE id = ?`, [id])
    return { status: 'recovered' }
  }

  if (isPermanentError(error)) {
    // Same structural rejection — keep it held but refresh the recorded cause so
    // the owner sees the current reason, not a stale one.
    await db.execute(
      `UPDATE sync_dead_letter SET error_code = ?, error_message = ?, failed_at = ? WHERE id = ?`,
      [error.code ?? null, error.message, new Date().toISOString(), id],
    )
    return { status: 'still-blocked', message: error.message }
  }

  // Transient (offline / 5xx): leave it untouched; the owner can try again once
  // back online.
  return { status: 'transient', message: error.message }
}

/**
 * Discard a held op. If it's a `categories` insert, also discard any held
 * `subcategories` ops created under it: once the parent category's own write
 * is abandoned, those children reference a `category_id` that will never
 * exist server-side, so their foreign-key rejection can never clear on
 * retry — leaving them stuck forever unless we clean them up together.
 */
export async function discardDeadLetterOp(db: AbstractPowerSyncDatabase, id: string): Promise<void> {
  const row = await db.getOptional<DeadLetterEntry>(
    `SELECT id, client_id, op_type, table_name, row_id, op_data, error_code, error_message, failed_at
       FROM sync_dead_letter WHERE id = ?`,
    [id],
  )

  await db.execute(`DELETE FROM sync_dead_letter WHERE id = ?`, [id])

  if (row?.table_name === 'categories') {
    const orphaned = await db.getAll<DeadLetterEntry>(
      `SELECT id, client_id, op_type, table_name, row_id, op_data, error_code, error_message, failed_at
         FROM sync_dead_letter WHERE table_name = 'subcategories'`,
    )
    for (const orphan of orphaned) {
      const opData = orphan.op_data ? (JSON.parse(orphan.op_data) as Record<string, unknown>) : undefined
      if (opData?.category_id === row.row_id) {
        await db.execute(`DELETE FROM sync_dead_letter WHERE id = ?`, [orphan.id])
      }
    }
  }
}
