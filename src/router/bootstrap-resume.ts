import { useOwnerBootstrap, type ResumeOutcome } from '@/features/staff/composables/useOwnerBootstrap'

/**
 * Called once at app boot (see wiring in index.ts below). If a bootstrap
 * attempt was left incomplete (client crashed, tab closed, or the RPC
 * succeeded but local hydration never finished -- design doc's Lifecycle
 * section, cases 2 and 3), this resumes it automatically with no PIN
 * re-entry, since PendingBootstrap already carries the ids needed and the
 * RPC's idempotency means re-calling it is always safe.
 */
export async function resumeBootstrapIfPending(): Promise<ResumeOutcome> {
  return useOwnerBootstrap().resumePendingBootstrap()
}
