import { defineStore } from 'pinia'
import { ref } from 'vue'

// Crash-recovery anchor for the owner-bootstrap flow (see
// docs/superpowers/specs/2026-07-26-owner-bootstrap-rpc-design.md,
// "Client-side change" step 1). Deliberately holds NO pin field -- the PIN
// is only ever used in-memory for the RPC call itself, never persisted.
export interface PendingBootstrap {
  deviceId:     string
  staffId:      string
  createdAt:    string
  attemptCount: number
}

export const useBootstrapStore = defineStore('bootstrap', () => {
  const pending = ref<PendingBootstrap | null>(null)

  function start(deviceId: string, staffId: string): void {
    pending.value = { deviceId, staffId, createdAt: new Date().toISOString(), attemptCount: 0 }
  }

  function recordAttempt(): void {
    if (!pending.value) return
    pending.value = { ...pending.value, attemptCount: pending.value.attemptCount + 1 }
  }

  function clear(): void {
    pending.value = null
  }

  return { pending, start, recordAttempt, clear }
}, {
  persist: { pick: ['pending'] },
})
