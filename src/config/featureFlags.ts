/**
 * Build-time feature flags.
 *
 * A flag stays `false` until the feature it gates actually has code behind it,
 * so we never advertise (or expose) capabilities that don't exist yet. Flip the
 * flag to `true` — or set the matching `VITE_FF_*` env var — in the same change
 * that ships the feature.
 *
 * This is the cheapest rung of the feature-flag discipline in CLAUDE.md: a
 * build-time gate for pre-auth surfaces (e.g. the marketing landing page) where
 * there is no customer to flag against. Per-customer flags are a separate,
 * later concern.
 */
export interface FeatureFlags {
  /**
   * Electronics Pro pack — IMEI tools, repair tickets, warranty tracking,
   * repair-profitability report. Planned for v1 but not yet built, so it must
   * not be advertised. Defaults to `false`.
   */
  electronicsPro: boolean
}

/** Parse a `VITE_FF_*` env string into a boolean, falling back when unset. */
function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return value === 'true' || value === '1'
}

export const featureFlags: FeatureFlags = {
  electronicsPro: envFlag(
    import.meta.env.VITE_FF_ELECTRONICS_PRO as string | undefined,
    false,
  ),
}
