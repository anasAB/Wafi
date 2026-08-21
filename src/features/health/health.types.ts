export type HealthMetricKey =
  | 'sync_failure_terminal'
  | 'sync_terminal_total'
  | 'offline_duration_seconds'
  | 'deferred_job_failure_terminal'
  | 'deferred_job_terminal_total'
  | 'app_error_count'
  | 'active_device_day'
  | 'telemetry_periods_dropped' // diagnostic-only: never contributes to health status,
                                 // never shown to the owner -- team dashboard only
  | 'drawer_mismatch_count'
  | 'never_closed_shift_count'

export type HealthGaugeKey = 'dead_letter_count'

export interface HealthCounterReport {
  metric_key: HealthMetricKey
  period_start: string
  value: number
}

export interface HealthGaugeReport {
  gauge_key: HealthGaugeKey
  value: number
  observed_at: string
}
