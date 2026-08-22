// WAFI-148A Task 10: client-side foreground evaluator for metrics #1/#2/#5/#6
// (sync failures, offline duration, deferred-job failures, app errors).
//
// Registered the same way checkDeviceSyncStaleness (WAFI-145) is registered
// in App.vue: called once on mount, and again on every document
// visibilitychange -> 'visible'. This offline-first PWA has no periodic
// in-app timer, so "app foreground" is the only trigger point.
//
// Deliberately independent of report_health_metrics / useHealthReporting.ts
// -- these are two separate triggers per the design spec's clarification.
// report_health_metrics only writes health_metrics rows; it never evaluates
// alert thresholds itself.
//
// No shop_id parameter, by design: the server-side RPC
// (evaluate_health_alerts_foreground, migration 122) derives the caller's
// own shop via auth_shop_id() and evaluates all 4 metrics for it in one
// call. Passing a shop id here would be misleading (it would be ignored)
// and would reintroduce the "trust a caller-supplied shop_id" mistake the
// server side explicitly avoids.
//
// Fire-and-forget-safe: an RPC error here must never throw/crash the caller
// (same resilience contract as checkDeviceSyncStaleness) -- there is always
// a next foreground event to retry on.

import { supabase } from '@/data/supabase/client'

export async function checkHealthAlerts(): Promise<void> {
  try {
    const { error } = await supabase.rpc('evaluate_health_alerts_foreground')
    if (error) {
      console.warn('checkHealthAlerts: evaluate_health_alerts_foreground failed', error)
    }
  } catch (err) {
    console.warn('checkHealthAlerts: unexpected failure', err)
  }
}
