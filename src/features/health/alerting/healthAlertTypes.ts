// WAFI-148A: canonical `notifications.type` / `notification_settings.type`
// string constants for all 8 health_alert_* types defined by the design
// spec. Other tasks (e.g. the Settings UI task) should import from here
// instead of re-typing these string literals.
//
// #1/#2/#5/#6 are Shape A (health_alert_state_a, claim_health_alert_period,
// evaluated by this feature's foreground RPC, migration 122).
// #3/#7/#8 are Shape B (health_alert_state_b, claim_health_alert_transition /
// resolve_health_alert_transition, evaluated by pg_cron / triggers,
// migrations 119/120).
// #4 is Shape A but event-derived (passes its own p_source_event_id),
// evaluated by a trigger, not this foreground RPC.

export const HEALTH_ALERT_SYNC_FAILURES = 'health_alert_sync_failures' // #1
export const HEALTH_ALERT_OFFLINE_DURATION = 'health_alert_offline_duration' // #2
export const HEALTH_ALERT_DEAD_LETTER_COUNT = 'health_alert_dead_letter_count' // #3
export const HEALTH_ALERT_DRAWER_MISMATCHES = 'health_alert_drawer_mismatches' // #4
export const HEALTH_ALERT_DEFERRED_JOB_FAILURES = 'health_alert_deferred_job_failures' // #5
export const HEALTH_ALERT_APP_ERRORS = 'health_alert_app_errors' // #6
export const HEALTH_ALERT_STALE_DEVICE = 'health_alert_stale_device' // #7
export const HEALTH_ALERT_OVERDUE_SHIFT = 'health_alert_overdue_shift' // #8

export type HealthAlertType =
  | typeof HEALTH_ALERT_SYNC_FAILURES
  | typeof HEALTH_ALERT_OFFLINE_DURATION
  | typeof HEALTH_ALERT_DEAD_LETTER_COUNT
  | typeof HEALTH_ALERT_DRAWER_MISMATCHES
  | typeof HEALTH_ALERT_DEFERRED_JOB_FAILURES
  | typeof HEALTH_ALERT_APP_ERRORS
  | typeof HEALTH_ALERT_STALE_DEVICE
  | typeof HEALTH_ALERT_OVERDUE_SHIFT

// The 4 metrics evaluated by this feature's client-side foreground RPC
// (evaluate_health_alerts_foreground, migration 122) -- exported for tests
// that want to enumerate them without hardcoding the list again.
export const FOREGROUND_HEALTH_ALERT_TYPES: readonly HealthAlertType[] = [
  HEALTH_ALERT_SYNC_FAILURES,
  HEALTH_ALERT_OFFLINE_DURATION,
  HEALTH_ALERT_DEFERRED_JOB_FAILURES,
  HEALTH_ALERT_APP_ERRORS,
]
