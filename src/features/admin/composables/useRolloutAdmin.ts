import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { ROLLOUT_FLAG_KEYS, type RolloutFlagKey } from '@/features/flags/flagRegistry'

export interface RolloutShopRow {
  shopId: string
  shopName: string
  flags: Record<RolloutFlagKey, boolean>
}

/**
 * WAFI-155: drives the internal-only /admin/rollouts screen. `latestRequestId`
 * is bumped both by a new list request AND by a successful mutation commit
 * (Task 9) -- the single mechanism that keeps a stale list response from
 * clobbering either a newer search result or a just-committed toggle.
 */
export function useRolloutAdmin() {
  const shops = ref<RolloutShopRow[]>([])
  const query = ref('')
  const loading = ref(false)
  const capped = ref(false)

  let latestRequestId = 0

  async function refresh(): Promise<void> {
    const requestId = ++latestRequestId
    loading.value = true
    const { data } = await supabase.rpc('list_shops_for_rollout_admin', { p_query: query.value })
    if (requestId !== latestRequestId) return // superseded by a newer request or mutation
    loading.value = false
    capped.value = (data ?? []).length === 100
    shops.value = (data ?? []).map((r: any) => ({
      shopId: r.shop_id,
      shopName: r.shop_name,
      flags: Object.fromEntries(ROLLOUT_FLAG_KEYS.map(k => [k, Boolean(r[k])])) as Record<RolloutFlagKey, boolean>,
    }))
  }

  return { shops, query, loading, capped, refresh, __bumpRequestId: () => ++latestRequestId }
}
