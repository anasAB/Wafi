import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@/features/settings'
import { useShiftStore } from '@/features/shifts/shift.store'

// Discrete user-activity events that reset the idle timer. Deliberately NOT
// 'mousemove' / 'scroll' — those fire constantly and would defeat the timer's
// purpose; a real interaction (tap, key, click) is what counts as "attended".
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'click'] as const

/**
 * Idle auto-lock (WAFI-062). After `settings.idleTimeout` minutes without a
 * discrete interaction, `locked` flips true so the UI can overlay a PIN re-entry
 * screen — WITHOUT closing the shift (the shift store is never touched here).
 *
 * - 'never' (or no open shift) → timer disabled.
 * - Resets on each interaction while unlocked.
 * - Survives PWA background/foreground: on returning to a visible tab we check how
 *   long we were away and lock immediately if the threshold was crossed (a
 *   background tab's setTimeout is throttled and can't be relied on).
 *
 * Mounted once (App.vue). Returns `locked` and `unlock()` (call after a correct
 * PIN) so the prior screen resumes intact.
 */
export function useIdleLock() {
  const settings = useSettingsStore()
  const shift    = useShiftStore()

  const locked   = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let hiddenAt: number | null = null

  // Active only when signed in (a shift is open) and a finite timeout is set.
  const timeoutMs = computed(() => {
    if (settings.idleTimeout === 'never') return null
    if (!shift.isShiftOpen) return null
    return settings.idleTimeout * 60_000
  })

  function clearTimer() {
    if (timer !== null) { clearTimeout(timer); timer = null }
  }

  function arm() {
    clearTimer()
    const ms = timeoutMs.value
    if (locked.value || ms === null) return
    timer = setTimeout(() => { locked.value = true }, ms)
  }

  function onActivity() {
    if (locked.value) return   // interactions on the lock overlay don't reset it
    arm()
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      clearTimer()
      return
    }
    // Became visible again — lock if we were away longer than the threshold.
    const ms = timeoutMs.value
    if (!locked.value && ms !== null && hiddenAt !== null && Date.now() - hiddenAt >= ms) {
      locked.value = true
    }
    hiddenAt = null
    if (!locked.value) arm()
  }

  /** Called after a correct PIN re-entry — resume where the user was. */
  function unlock() {
    locked.value = false
    arm()
  }

  // Re-arm when the timeout setting changes or a shift opens/closes.
  watch(timeoutMs, () => { if (!locked.value) arm() })

  onMounted(() => {
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    arm()
  })

  onBeforeUnmount(() => {
    for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity)
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimer()
  })

  return { locked, unlock }
}
