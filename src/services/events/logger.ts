// src/services/events/logger.ts
/** Thin wrapper around console.error (WAFI-140 Sprint 2) -- introduced so a future real
 *  alerting/telemetry integration (Sprint 3) is a change to this one module, not a
 *  grep-and-replace across every call site this ticket adds. */
export const logger = {
  error: (...args: unknown[]) => console.error(...args),
}
