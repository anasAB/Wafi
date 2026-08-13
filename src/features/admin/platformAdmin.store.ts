import { ref } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '@/data/supabase/client'

/**
 * WAFI-155: platform-admin identity, orthogonal to any shop's staff/role
 * model (session.store.ts). Tied to auth.uid() directly -- a platform
 * admin need not have a `staff` row in any shop. Not persisted: cheap
 * enough to re-check once per session, and a security-relevant flag
 * shouldn't live in local storage.
 */
export const usePlatformAdminStore = defineStore('platformAdmin', () => {
  const checkedForUserId = ref<string | null>(null)
  const isAdmin = ref(false)
  // Keyed to the user it was issued for -- a bare `Promise | null` slot would
  // let a slow, now-stale query for a previous user overwrite a more recent
  // user's already-committed result once it finally resolves (found in
  // review: user A's in-flight check outliving a switch to user B).
  let pending: { userId: string; promise: Promise<boolean> } | null = null

  async function ensureChecked(): Promise<boolean> {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id ?? null

    // No current authenticated user (e.g. app boot before session restore
    // completes) -- not a real check, must not be cached as one.
    if (!userId) {
      isAdmin.value = false
      return false
    }

    if (checkedForUserId.value === userId) return isAdmin.value
    if (pending && pending.userId === userId) return pending.promise

    const promise: Promise<boolean> = (async () => {
      try {
        const { data: row } = await supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle()
        const result = Boolean(row)
        // Only commit if no newer request for a DIFFERENT user has
        // superseded this one -- prevents a slow, now-stale query for a
        // previous user from overwriting a more recent user's already-
        // committed result.
        if (pending?.userId === userId) {
          checkedForUserId.value = userId
          isAdmin.value = result
        }
        return result
      } catch {
        // Network/query error: remains retryable on the next call rather
        // than being permanently and incorrectly cached as "not admin."
        return false
      } finally {
        // Leave `pending` alone if a different user's request has already
        // taken over the slot -- otherwise this would clear a currently
        // in-flight different-user request out from under it.
        if (pending?.userId === userId) pending = null
      }
    })()

    pending = { userId, promise }
    return promise
  }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      checkedForUserId.value = null
      isAdmin.value = false
    }
  })

  return { isAdmin, ensureChecked }
})
