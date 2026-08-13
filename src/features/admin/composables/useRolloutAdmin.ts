import { ref } from 'vue'
import { supabase } from '@/data/supabase/client'
import { ROLLOUT_FLAG_KEYS, type RolloutFlagKey } from '@/features/flags/flagRegistry'

export interface RolloutShopRow {
  shopId: string
  shopName: string
  flags: Record<RolloutFlagKey, boolean>
}

interface RolloutAdminRpcRow {
  shop_id: string
  shop_name: string
  dashboard_v2: boolean
  pos_brain: boolean
  insights: boolean
}

function pendingKey(shopId: string, flagKey: RolloutFlagKey): string {
  return `${shopId}:${flagKey}`
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
  const pending = ref<Record<string, boolean>>({})

  let latestRequestId = 0

  async function refresh(): Promise<void> {
    const requestId = ++latestRequestId
    loading.value = true
    const { data, error } = await supabase.rpc('list_shops_for_rollout_admin', { p_query: query.value })
    if (requestId !== latestRequestId) return // superseded by a newer request or mutation

    if (error) {
      // Don't clear existing data on a failed refresh -- just stop the
      // spinner and leave the last-known-good list on screen.
      loading.value = false
      return
    }

    loading.value = false
    capped.value = (data ?? []).length === 100
    shops.value = (data ?? []).map((r: RolloutAdminRpcRow) => ({
      shopId: r.shop_id,
      shopName: r.shop_name,
      flags: Object.fromEntries(ROLLOUT_FLAG_KEYS.map(k => [k, Boolean(r[k])])) as Record<RolloutFlagKey, boolean>,
    }))
  }

  function isPending(shopId: string, flagKey: RolloutFlagKey): boolean {
    return pendingKey(shopId, flagKey) in pending.value
  }

  /** Pending optimistic value if present, else the last-known server value. */
  function valueFor(shop: RolloutShopRow, flagKey: RolloutFlagKey): boolean {
    const key = pendingKey(shop.shopId, flagKey)
    return key in pending.value ? pending.value[key] : shop.flags[flagKey]
  }

  async function toggle(shopId: string, flagKey: RolloutFlagKey): Promise<void> {
    const key = pendingKey(shopId, flagKey)
    if (key in pending.value) return // already in flight -- no-op

    const shop = shops.value.find(s => s.shopId === shopId)
    if (!shop) return
    const newValue = !valueFor(shop, flagKey)
    pending.value = { ...pending.value, [key]: newValue }

    const { error } = await supabase.rpc('set_rollout_flag', {
      p_shop_id: shopId, p_flag_key: flagKey, p_enabled: newValue,
    })

    const { [key]: _discarded, ...rest } = pending.value
    pending.value = rest

    if (!error) {
      // Commit into local server-state BEFORE clearing pending (already done
      // above) -- without this, the cell would fall back to the stale
      // pre-mutation value the instant `pending` is cleared.
      shop.flags = { ...shop.flags, [flagKey]: newValue }
      // Any list response already in flight predates this mutation and must
      // not be allowed to overwrite it -- bump the shared request counter so
      // refresh()'s staleness check discards that in-flight response.
      latestRequestId++
    }
    // On error: pending is already cleared above; shop.flags was never
    // touched, so valueFor() naturally reverts to the last known server value.
  }

  return { shops, query, loading, capped, refresh, isPending, valueFor, toggle }
}
