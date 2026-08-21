export function formatRate(
  numerator: number,
  denominator: number,
  kind: 'percentage' | 'per-device-day',
): { display: string; isNoData: boolean } {
  if (denominator === 0) {
    return { display: 'No data', isNoData: true }
  }

  if (kind === 'percentage') {
    const pct = (numerator / denominator) * 100
    return { display: `${numerator}/${denominator} · ${pct.toFixed(1)}%`, isNoData: false }
  }

  const perDay = numerator / denominator
  return {
    display: `${numerator} errors · ${perDay.toFixed(1)} per active device-day`,
    isNoData: false,
  }
}

export function formatCount(value: number): { display: string; isZeroHealthy: boolean } {
  return { display: String(value), isZeroHealthy: value === 0 }
}

export function formatGaugeFreshness(
  observedAt: string,
  freshnessWindowMs: number,
): { isStale: boolean; ageLabel: string } {
  const ageMs = Date.now() - new Date(observedAt).getTime()
  const ageHours = Math.round(ageMs / (60 * 60 * 1000))
  return {
    isStale: ageMs > freshnessWindowMs,
    ageLabel: ageHours < 1 ? 'less than an hour ago' : `${ageHours}h ago`,
  }
}
