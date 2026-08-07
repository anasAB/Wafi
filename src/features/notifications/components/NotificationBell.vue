<script setup lang="ts">
// WAFI-143: minimal notification badge + list for HomePage. Deliberately
// leaf-only — no filtering, categorization, per-type settings, or
// delivery-channel configuration. WAFI-145 (Owner Notification Center) is
// expected to replace or significantly extend this component; keep it small
// and easy to swap out.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

interface NotificationRow {
  id: string
  title: string
  message: string
  entity_type: string | null
  entity_id: string | null
  severity: string
  created_at: string
  read_at: string | null
}

const notifications = ref<NotificationRow[]>([])
const panelOpen = ref(false)
const unreadCount = ref(0)

function togglePanel() {
  panelOpen.value = !panelOpen.value
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') panelOpen.value = false
}

async function markRead(id: string) {
  await db.execute(`UPDATE notifications SET read_at = ? WHERE id = ?`, [new Date().toISOString(), id])
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SY', {
      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
    }).format(new Date(iso))
  } catch { return iso }
}

let controller: AbortController | null = null

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  const shopId = useDeviceStore().shopId
  controller = new AbortController()
  ;(async () => {
    const iterable = db.watch(
      `SELECT * FROM notifications WHERE shop_id = ? ORDER BY created_at DESC LIMIT 50`,
      [shopId],
      { signal: controller!.signal },
    )
    for await (const result of iterable) {
      const rows: NotificationRow[] = (result as any).rows?._array ?? []
      notifications.value = rows
      unreadCount.value = rows.filter((r) => !r.read_at).length
    }
  })().catch(() => {})
})

onBeforeUnmount(() => {
  controller?.abort()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="notification-bell">
    <button
      type="button"
      class="icon-btn nb-trigger"
      :class="{ 'has-alert': unreadCount > 0 }"
      :aria-label="`الإشعارات${unreadCount ? ` (${unreadCount} غير مقروء)` : ''}`"
      :aria-expanded="panelOpen"
      @click="togglePanel"
    >
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span v-if="unreadCount" class="notification-badge">{{ unreadCount }}</span>
    </button>

    <Transition name="nb-overlay-fade">
      <div v-if="panelOpen" class="nb-overlay" @click="panelOpen = false" />
    </Transition>

    <Transition name="nb-panel-pop">
      <div v-if="panelOpen" class="notification-panel" dir="rtl">
        <div class="nb-panel-head">
          <p class="nb-title">الإشعارات</p>
          <button type="button" class="nb-close-btn" aria-label="إغلاق" @click="panelOpen = false">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="nb-list">
          <div
            v-for="n in notifications"
            :key="n.id"
            class="notification-item"
            :class="{ unread: !n.read_at }"
            @click="markRead(n.id)"
          >
            <div class="notification-title">{{ n.title }}</div>
            <div class="notification-message">{{ n.message }}</div>
            <div class="notification-time" dir="ltr">{{ formatTime(n.created_at) }}</div>
          </div>
          <div v-if="!notifications.length" class="notification-empty">لا توجد إشعارات</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.notification-bell {
  position: relative;
  display: inline-flex;
}

.nb-trigger {
  position: relative;
}

.notification-badge {
  position: absolute;
  top: -4px;
  inset-inline-end: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #EF4444;
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  font-weight: 800;
  text-align: center;
}

.nb-overlay {
  position: fixed;
  inset: 0;
  z-index: 35;
  background: rgba(1, 5, 14, 0.45);
  backdrop-filter: blur(1.5px);
}

.notification-panel {
  position: fixed;
  top: 64px;
  bottom: 10px;
  inset-inline-start: 10px;
  inset-inline-end: 10px;
  z-index: 40;
  border-radius: 14px;
  border: 1px solid rgba(26, 86, 219, 0.28);
  background: linear-gradient(145deg, rgba(9, 16, 31, .97), rgba(6, 12, 24, .97));
  box-shadow: 0 16px 40px rgba(3, 8, 20, 0.7), inset 0 1px 0 rgba(255,255,255,.06);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 1024px) {
  .notification-panel {
    top: 74px;
    bottom: auto;
    inset-inline-start: auto;
    inset-inline-end: 18px;
    width: 360px;
    max-height: calc(100vh - 94px);
  }
}

.nb-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 8px;
}

.nb-title {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: #E8EDF5;
}

.nb-close-btn {
  width: 1.75rem;
  height: 1.75rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  color: #7E90AA;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.nb-close-btn:hover {
  color: #E8EDF5;
  background: rgba(255, 255, 255, 0.10);
}

.nb-list {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.notification-item {
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 8px 10px;
  cursor: pointer;
  transition: background .15s ease;
}

.notification-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.notification-item.unread {
  border-color: rgba(26, 86, 219, 0.4);
  background: rgba(26, 86, 219, 0.10);
}

.notification-title {
  font-size: 13px;
  font-weight: 700;
  color: #E8EDF5;
}

.notification-message {
  margin-top: 2px;
  font-size: 12px;
  color: #9AA8BE;
}

.notification-time {
  margin-top: 4px;
  font-size: 10px;
  color: #7E90AA;
  text-align: end;
}

.notification-empty {
  text-align: center;
  padding: 24px 0;
  font-size: 12px;
  color: #7E90AA;
}

.nb-overlay-fade-enter-active,
.nb-overlay-fade-leave-active {
  transition: opacity .2s ease;
}

.nb-overlay-fade-enter-from,
.nb-overlay-fade-leave-to {
  opacity: 0;
}

.nb-panel-pop-enter-active,
.nb-panel-pop-leave-active {
  transition: opacity .22s ease, transform .22s ease;
}

.nb-panel-pop-enter-from,
.nb-panel-pop-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(.985);
}
</style>
