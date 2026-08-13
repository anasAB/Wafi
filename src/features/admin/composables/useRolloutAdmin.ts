import { ref, computed } from 'vue'
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
  const capped = ref(false)
  const pending = ref<Record<string, boolean>>({})

  // `loading` tracks "is anything currently fetching", independent of which
  // request's data actually gets applied. A plain boolean set true/false
  // inside refresh() breaks when a mutation-caused bump to latestRequestId
  // (see toggle() below) makes a still-in-flight refresh() discard its own
  // response as "stale" -- that early return must not skip clearing loading,
  // so loading is derived from a request counter that is always decremented
  // in a `finally`, regardless of whether the response was applied.
  const inFlightCount = ref(0)
  const loading = computed(() => inFlightCount.value > 0)

  let latestRequestId = 0

  async function refresh(): Promise<void> {
    const requestId = ++latestRequestId
    inFlightCount.value++
    try {
      const { data, error } = await supabase.rpc('list_shops_for_rollout_admin', { p_query: query.value })
      if (requestId !== latestRequestId) return // superseded by a newer request or mutation -- data discarded
      if (error) return // don't clear existing data on a failed refresh

      capped.value = (data ?? []).length === 100
      shops.value = (data ?? []).map((r: RolloutAdminRpcRow) => ({
        shopId: r.shop_id,
        shopName: r.shop_name,
        flags: Object.fromEntries(ROLLOUT_FLAG_KEYS.map(k => [k, Boolean(r[k])])) as Record<RolloutFlagKey, boolean>,
      }))
    } finally {
      inFlightCount.value--
    }
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

    if (!error) {
      // Commit into local server-state BEFORE clearing pending below --
      // this ordering is the actual invariant: `valueFor()` must never see a
      // window (even a hypothetical future one, if an await were ever
      // inserted between these two steps) where `pending` has already been
      // cleared but `shop.flags` hasn't been committed yet, which would
      // cause the cell to flash back to the stale pre-mutation value.
      shop.flags = { ...shop.flags, [flagKey]: newValue }
      // Any list response already in flight predates this mutation and must
      // not be allowed to overwrite it -- bump the shared request counter so
      // refresh()'s staleness check discards that in-flight response.
      latestRequestId++
    }
    // On error: shop.flags is never touched, so valueFor() naturally reverts
    // to the last known server value once pending is cleared below.

    const { [key]: _discarded, ...rest } = pending.value
    pending.value = rest
  }

  return { shops, query, loading, capped, refresh, isPending, valueFor, toggle }
}
