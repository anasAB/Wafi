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
  let pendingPromise: Promise<boolean> | null = null

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
    if (pendingPromise) return pendingPromise

    pendingPromise = (async () => {
      try {
        const { data: row } = await supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle()
        checkedForUserId.value = userId
        isAdmin.value = Boolean(row)
        return isAdmin.value
      } catch {
        // Network/query error: remains retryable on the next call rather
        // than being permanently and incorrectly cached as "not admin."
        isAdmin.value = false
        return false
      } finally {
        pendingPromise = null
      }
    })()

    return pendingPromise
  }

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      checkedForUserId.value = null
      isAdmin.value = false
    }
  })

  return { isAdmin, ensureChecked }
})
