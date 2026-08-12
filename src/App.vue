<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/features/settings'
import { useThemePalette } from '@/composables/useThemePalette'
import { i18n } from '@/i18n'
import type { Theme } from '@/features/settings'
import AppSidebar   from '@/components/layout/AppSidebar.vue'
import AppBottomNav from '@/components/layout/AppBottomNav.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { usePwaLifecycle } from '@/composables/usePwaLifecycle'
import { useShiftStore } from '@/features/shifts/shift.store'
import { useShift }      from '@/features/shifts/composables/useShift'
import { useStaff }      from '@/features/staff/composables/useStaff'
import { useDeviceStore } from '@/store/device.store'
import LockScreen        from '@/features/shifts/components/LockScreen.vue'
import IdleLockOverlay   from '@/features/shifts/components/IdleLockOverlay.vue'
import { useIdleLock }   from '@/composables/useIdleLock'
import { db }            from '@/data/powersync/db'
import { useSaleStore }  from '@/store/sale.store'
import { startRetryQueueSweeper } from '@/services/events/eventPublishRetryQueue'
import { startDailyEventCountsProjection } from '@/services/events/dailyEventCountsProjection'
import { startEventTableCleanupSweeper } from '@/services/events/cleanupLocalEventTables'
import { startAuditSubscribers, handleAuditableEvent } from '@/services/events/auditSubscriber'
import { startProcessingRetrySweeper } from '@/services/events/eventProcessingRetryQueue'
import { startDashboardRevenueProjection } from '@/services/events/dashboardRevenueProjection'
import { startProfitCacheProjection } from '@/services/events/profitCacheProjection'
import { startNotificationSubscribers, handleDiscountEvent } from '@/services/events/notificationSubscriber'
import { startDeferredJobWorker } from '@/services/events/deferredJobWorker'
import { checkDeviceSyncStaleness } from '@/services/notifications/syncStalenessCheck'
import type { DomainEvent } from '@/services/events/domainEvent.types'

const { offlineReady, dismissOfflineReady, needRefresh, applyUpdate, dismissNeedRefresh } = usePwaLifecycle()

const route    = useRoute()
const router   = useRouter()
const settings = useSettingsStore()
useThemePalette()

const shiftStore   = useShiftStore()
const { loadActiveShift } = useShift()
const { hasAnyStaff }     = useStaff()
// WAFI-062: idle auto-lock. `locked` only flips while a shift is open (see
// useIdleLock), so the overlay never collides with the login gate.
const { locked: idleLocked, unlock: unlockIdle } = useIdleLock()
const appReady  = ref(false)
const hasStaff  = ref(false)

const PUBLIC_PATHS = ['/welcome', '/login', '/signup', '/forgot-password']

const isPublicRoute = computed(() => PUBLIC_PATHS.includes(route.path))

const showSidebar = computed(() => !isPublicRoute.value)

const showBottomNav = computed(() => {
  if (isPublicRoute.value)                              return false
  if (route.path === '/pos/confirmation')                  return false
  if (route.path === '/products/add')                      return false
  if (/^\/products\/[^/]+\/edit$/.test(route.path))       return false
  return true
})

// --- Theme ---
const mq = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'auto' && mq.matches)
  document.documentElement.classList.toggle('dark', dark)
}

watch(() => settings.theme, applyTheme, { immediate: true })

function onSystemThemeChange() { applyTheme(settings.theme) }
function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void checkDeviceSyncStaleness(useDeviceStore().shopId, useDeviceStore().deviceId)
  }
}

onMounted(async () => {
  mq.addEventListener('change', onSystemThemeChange)
  document.addEventListener('visibilitychange', onVisibilityChange)

  // A freshly-provisioned device starts with an empty local DB: the owner's
  // staff row arrives via the first sync. Decide "no owner → setup wizard" only
  // AFTER that sync has had a chance to land, or we'd wrongly send a provisioned
  // device into /setup-owner on its first launch. Bounded by a timeout so a bad
  // token / slow network never hangs startup; skipped offline (local is then the
  // source of truth) and resolves instantly on warm starts (sync already done).
  if (import.meta.env.VITE_POWERSYNC_URL && navigator.onLine) {
    await Promise.race([
      db.waitForFirstSync(),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ]).catch(() => { /* offline/error — fall back to local state */ })
  }

  // hasAnyStaff() below filters by device.shopId, which device.store.ts
  // resolves independently (off the SIGNED_IN auth event or a PowerSync
  // reconnect) from the local `shops` row -- NOT from the sync checkpoint
  // awaited above. On a cold start (full site-data clear + fresh login,
  // found live 2026-07-29) that resolution can still be mid-flight here even
  // though `shops`/`staff` have already synced locally, leaving
  // device.shopId at its empty fallback. hasAnyStaff() would then query
  // `WHERE shop_id = ''`, match nothing, and — since this check runs only
  // once and is never retried — permanently misreport hasStaff as false for
  // the whole session, skipping LockScreen and leaving every gated route to
  // bounce through the router's redirect chain instead. Awaiting it directly
  // here (it only reads the already-synced local `shops` table, no extra
  // network round trip) closes that race.
  await useDeviceStore().refreshShopId()

  // Durably seed the receipt counter from already-synced sales, so a cache clear
  // / PWA reinstall / new device can't re-issue a receipt number that already
  // exists (which would jam sync on uq_sale_number_per_shop).
  await useSaleStore().reconcileSequenceFromDb()

  const staffExist = await hasAnyStaff()
  hasStaff.value = staffExist
  if (!staffExist) {
    router.push('/setup-owner')
    appReady.value = true
    return
  }
  if (shiftStore.activeShiftId) {
    await loadActiveShift()  // validates and clears store if shift was closed
  }

  // WAFI-140 Sprint 2 final review fix: start the event-publish retry queue
  // sweeper once, at app startup, only after device/shop context is known
  // (staffExist true means refreshShopId() above has already resolved a real
  // shop_id) -- the same gating loadActiveShift() above relies on. Without
  // this call the sweeper (and retryPendingEventPublishes) never ran in
  // production; only its own unit tests exercised it.
  startRetryQueueSweeper()

  // WAFI-140 Sprint 3: startDailyEventCountsProjection (Sprint 1) had the identical
  // dormancy bug -- confirmed via codebase-wide grep for useEventSubscription( turning
  // up zero callers outside its own test file -- flagged in the Sprint 2 final-review
  // commit (a064079) for follow-up rather than fixed on the spot. Fixed here, gated
  // identically to the retry sweeper above.
  startDailyEventCountsProjection(useDeviceStore().shopId)

  // WAFI-140 Sprint 3: bounds local_event_processed_ledger/local_event_publish_retries
  // growth (design spec §8a) -- same gating and reconnect-listener mechanism as the
  // retry sweeper above.
  startEventTableCleanupSweeper()

  startDashboardRevenueProjection(useDeviceStore().shopId)
  startProfitCacheProjection(useDeviceStore().shopId)
  startNotificationSubscribers(useDeviceStore().shopId)

  // WAFI-145 Task 14: Sync Failure / stale-device check. State-derived, not event
  // driven -- this offline-first PWA has no periodic in-app timer, so it runs on
  // every app-foreground moment instead: once here on mount, and again on every
  // visibilitychange back to 'visible' (see the listener registered below).
  void checkDeviceSyncStaleness(useDeviceStore().shopId, useDeviceStore().deviceId)

  // WAFI-150: start the audit subscribers -- the first durable-subscriber consumer
  // -- at the same gate as the sweepers above (device/shop context resolved).
  startAuditSubscribers(useDeviceStore().shopId)

  // WAFI-150 review fix (Task 9, closing a gap surfaced by Task 4's review):
  // eventProcessingRetryQueue.ts's startProcessingRetrySweeper existed since Task 3/4
  // but nothing ever called it -- any event that failed durable-subscriber processing
  // got queued into local_event_processing_retries and then just sat there forever,
  // the exact same dormant-consumer bug already hit twice above (startRetryQueueSweeper,
  // startDailyEventCountsProjection). Wired here with the one handler that exists today.
  // Cast is safe: every event this sweeper re-delivers to the 'audit' subscriber
  // was serialized from a DurableEvent in the first place (enqueueForProcessingRetry
  // is only ever called from within runDurableSubscriber's failure path), so it
  // always has the eventId field handleAuditableEvent requires -- the two types
  // just aren't structurally assignable through the Map's invariant parameter type.
  startProcessingRetrySweeper(new Map([
    ['audit', handleAuditableEvent as (event: DomainEvent) => Promise<void>],
    // WAFI-143 final-review fix (C3): 'notifications' durable retries were enqueued under
    // this subscriber name (see notificationSubscriber.ts's runDurableSubscriber call) but
    // never registered here, so failed notification handlers sat in
    // local_event_processing_retries forever and never fired. Registered with the same
    // type-cast reasoning as 'audit' above.
    ['notifications', handleDiscountEvent as (event: DomainEvent) => Promise<void>],
  ]))

  // WAFI-154: deferred execution tier worker -- no real job types registered yet
  // (this ticket ships infrastructure only, see design spec's Out of Scope), but the
  // trigger wiring itself is real so the first future job type has nothing left to wire.
  startDeferredJobWorker(useDeviceStore().shopId)

  appReady.value = true
})
onBeforeUnmount(() => {
  mq.removeEventListener('change', onSystemThemeChange)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// --- Text size ---
watch(
  () => settings.textSize,
  size => { document.documentElement.dataset.textSize = size },
  { immediate: true },
)

// --- Language / i18n ---
watch(
  () => settings.language,
  lang => { i18n.global.locale.value = lang as 'ar' | 'en' },
  { immediate: true },
)
</script>

<template>
  <AppToast
    v-if="offlineReady"
    type="success"
    message="التطبيق جاهز للعمل بدون إنترنت"
    @dismiss="dismissOfflineReady"
  />
  <AppToast
    v-if="needRefresh"
    type="info"
    message="تحديث متاح"
    action-label="تحديث"
    :auto-dismiss="false"
    @action="applyUpdate"
    @dismiss="dismissNeedRefresh"
  />

  <!-- Branded loading splash (BUG-001) -->
  <div
    v-if="!appReady"
    class="fixed inset-0 bg-[#06090F] flex flex-col items-center justify-center gap-6"
    role="status"
    aria-live="polite"
    aria-label="جاري تحميل وافي"
  >
    <!-- App wordmark -->
    <h1
      class="text-5xl font-bold leading-none"
      style="font-family: var(--font-display-ar); color: var(--color-gold-primary)"
    >وافي</h1>
    <!-- Spinner (brand-colored arc) -->
    <div
      class="w-9 h-9 rounded-full border-2 border-white/10 animate-spin"
      style="border-top-color: var(--color-gold-primary)"
      aria-hidden="true"
    ></div>
    <span class="text-[#637285] text-sm">جاري التحميل...</span>
  </div>

  <template v-else>
    <!-- Single login gate: pick staff → PIN → opening cash opens the shift and
         establishes the session identity (audit + permissions) in one step. -->
    <LockScreen v-if="!isPublicRoute && hasStaff && !shiftStore.isShiftOpen" />

    <!-- Normal app shell -->
    <div
      v-else
      id="app"
      :dir="settings.language === 'ar' ? 'rtl' : 'ltr'"
      :lang="settings.language"
      class="h-dvh bg-bg-void text-text-primary flex overflow-hidden"
    >
      <!-- BUG-L02 (/history) fix: the sidebar used to come first in DOM order,
           forcing keyboard users through all 10+ nav links before ever reaching
           page content. Tab order follows DOM order (flex `order` below only
           affects visual position, not tab order), so the main content is now
           first in markup; `order: -1` on the sidebar keeps it visually where
           it always was. -->
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto">
          <RouterView />
        </div>
        <div class="bottomnav-wrap">
          <AppBottomNav v-if="showBottomNav" />
        </div>
      </div>
      <div class="sidebar-wrap">
        <AppSidebar v-if="showSidebar" />
      </div>

      <!-- Idle lock: dims the shell and requires PIN re-entry; the shift stays
           open underneath (WAFI-062). -->
      <IdleLockOverlay v-if="idleLocked" @unlock="unlockIdle" />
    </div>
  </template>
</template>

<style scoped>
/* Sidebar: hidden on mobile, flex on desktop */
.sidebar-wrap {
  display: none;
  order: -1;
}
@media (min-width: 1024px) {
  .sidebar-wrap {
    display: flex;
  }
}

/* Bottom nav: flex on mobile, hidden on desktop */
.bottomnav-wrap {
  display: flex;
  flex-direction: column;
}
@media (min-width: 1024px) {
  .bottomnav-wrap {
    display: none;
  }
}
</style>
