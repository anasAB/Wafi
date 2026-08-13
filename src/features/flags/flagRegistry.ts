/**
 * WAFI-131: the single registry of per-shop feature flags and their Option C
 * pack mapping. Every gated surface reads keys from HERE — never string
 * literals scattered through the code.
 *
 * Semantics (mirrored in migration 041):
 *   features == null         → all packs ON (legacy/grandfathered shop row)
 *   key missing from object  → OFF (new features default closed)
 *   key true/false           → as stated
 *
 * Flags are owner-invisible: WE set them server-side per the pack a shop pays
 * for. Turning a pack off hides UI — data keeps syncing, nothing is deleted.
 * Client-side gating is UX, not security; revenue-critical enforcement rides
 * WAFI-122's server-side model.
 */
export const FLAG_KEYS = ['staff_pack', 'customer_pack', 'reporting_pack', 'electronics_pro'] as const
export type FlagKey = typeof FLAG_KEYS[number]

/** Arabic pack names for the feature-locked teaser. */
export const FLAG_LABELS: Record<FlagKey, string> = {
  staff_pack:      'باقة الموظفين',
  customer_pack:   'باقة العملاء',
  reporting_pack:  'باقة التقارير',
  electronics_pro: 'باقة الإلكترونيات برو',
}

/** Pack → shipped features it covers (documentation + future gating points). */
export const PACK_CONTENTS: Record<FlagKey, string[]> = {
  staff_pack:      ['cashier shifts + Z-report', 'staff & permissions', 'audit log', 'cash movements'],
  customer_pack:   ['customer credit ledger', 'payments & statements', 'installments', 'collections worklist'],
  reporting_pack:  ['profit report (/reports)', 'advanced dashboard charts'],
  electronics_pro: ['IMEI tools', 'repair tickets', 'warranty tracking'],
}

/** Resolve one key against a shop's parsed features blob. */
export function resolveFlag(features: Record<string, unknown> | null, key: FlagKey): boolean {
  if (features === null) return true          // grandfathered: all on
  const v = features[key]
  return v === true                            // missing/false/garbage → off
}

/**
 * WAFI-155: engineering rollout flags -- "should this implementation
 * currently run for this shop?", independent of WAFI-131's pack
 * entitlements above ("does the shop's subscription include this?").
 * Deliberately a separate type/resolver, never merged into FlagKey/
 * resolveFlag: that would risk WAFI-131's null-blob "grandfathered -> all
 * on" pack semantics leaking into rollout-flag semantics, which must
 * always default closed for safety.
 */
export const ROLLOUT_FLAG_KEYS = ['dashboard_v2', 'pos_brain', 'insights'] as const
export type RolloutFlagKey = typeof ROLLOUT_FLAG_KEYS[number]

/** Fail-closed: missing/absent/malformed rollout config -> false. Only the
 *  literal boolean `true` ever enables a rollout. */
export function resolveRollout(
  features: Record<string, unknown> | null,
  key: RolloutFlagKey,
): boolean {
  const rollout = features?.rollout
  if (typeof rollout !== 'object' || rollout === null) return false
  return (rollout as Record<string, unknown>)[key] === true
}
