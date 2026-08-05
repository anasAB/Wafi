// In-memory, per-process, not persisted or synced -- resets on app restart (WAFI-140 Sprint
// 3 design spec §4a). This is a cheap first line of defense against a runaway LOCAL loop,
// not a security boundary (a compromised or modified client can trivially bypass in-memory
// state). The real boundary is the SQL trigger in 076_events_rate_limit.sql -- this bucket
// exists purely to stop wasted local SQLite/serialization work before that trigger is even
// reached, not to be trusted as the actual limit.
const CAPACITY = 50
const REFILL_PER_SECOND = 10
let tokens = CAPACITY
let lastRefillMs: number | null = null

export function tryConsumeToken(): boolean {
  const now = Date.now()
  if (lastRefillMs === null) {
    lastRefillMs = now
  }
  const elapsedSeconds = (now - lastRefillMs) / 1000
  tokens = Math.min(CAPACITY, tokens + elapsedSeconds * REFILL_PER_SECOND)
  lastRefillMs = now
  if (tokens < 1) return false
  tokens -= 1
  return true
}
