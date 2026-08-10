<!-- src/features/notifications/screens/NotificationCenterScreen.vue -->
<!--
  WAFI-145: full Notification Center — filters, mark-all-read, per-row
  acknowledge for CRITICAL rows, and deep-link routing via
  resolveNotificationRoute(). Loads a single 30-day window with db.watch
  (same reactive-subscription idiom as NotificationBell.vue) and filters the
  four tabs client-side over that window rather than issuing four separate
  SQL queries — the brief keeps this screen simple on purpose.
-->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { resolveNotificationRoute } from '@/features/notifications/notificationRouting'

interface NotificationRow {
  id: string
  type: string
  title: string
  message: string
  entity_type: string | null
  entity_id: string | null
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  created_at: string
  read_at: string | null
  acknowledged_at: string | null
}

type FilterKey = 'all' | 'unread' | 'critical' | 'today'

const router = useRouter()
const filter = ref<FilterKey>('all')
const items = ref<NotificationRow[]>([])

const filtered = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return items.value.filter((n) => {
    if (filter.value === 'unread') return !n.read_at
    if (filter.value === 'critical') return n.severity === 'CRITICAL'
    if (filter.value === 'today') return n.created_at.slice(0, 10) === today
    return true
  })
})

async function markAllRead() {
  const shopId = useDeviceStore().shopId
  await db.execute(
    `UPDATE notifications SET read_at = ? WHERE shop_id = ? AND read_at IS NULL`,
    [new Date().toISOString(), shopId],
  )
}

async function acknowledge(n: NotificationRow) {
  // Acknowledging implies having read it, but reading never implies
  // acknowledging — read_at is only backfilled here if it wasn't already set.
  const now = new Date().toISOString()
  await db.execute(
    `UPDATE notifications SET acknowledged_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?`,
    [now, now, n.id],
  )
}

function open(n: NotificationRow) {
  // Clicking ANY notification marks it read -- whether or not it resolves to a
  // route -- not just the no-resolvable-route fallback case.
  if (!n.read_at) {
    void db.execute(`UPDATE notifications SET read_at = ? WHERE id = ?`, [new Date().toISOString(), n.id])
  }
  if (n.entity_type && n.entity_id) {
    const route = resolveNotificationRoute(n.entity_type, n.entity_id)
    if (route) {
      router.push(route)
    }
  }
}

function severityClass(severity: string): string {
  switch (severity) {
    case 'CRITICAL': return 'severity-critical'
    case 'WARNING': return 'severity-warning'
    default: return 'severity-info'
  }
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SY', {
      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

let controller: AbortController | null = null

onMounted(() => {
  const shopId = useDeviceStore().shopId
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  controller = new AbortController()
  ;(async () => {
    const iterable = db.watch(
      `SELECT id, type, title, message, entity_type, entity_id, severity, created_at, read_at, acknowledged_at
       FROM notifications WHERE shop_id = ? AND created_at >= ? ORDER BY created_at DESC`,
      [shopId, since],
      { signal: controller!.signal },
    )
    for await (const result of iterable) {
      items.value = (result as any).rows?._array ?? []
    }
  })().catch(() => {})
})

onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <div class="notification-center" dir="rtl">
    <div class="nc-header">
      <h1 class="nc-title">الإشعارات</h1>
      <button type="button" class="nc-mark-all-btn" @click="markAllRead">تعليم الكل كمقروء</button>
    </div>

    <div class="nc-filters" role="tablist">
      <button
        type="button"
        class="nc-filter-btn"
        :class="{ active: filter === 'all' }"
        role="tab"
        :aria-selected="filter === 'all'"
        @click="filter = 'all'"
      >
        الكل
      </button>
      <button
        type="button"
        class="nc-filter-btn"
        :class="{ active: filter === 'unread' }"
        role="tab"
        :aria-selected="filter === 'unread'"
        @click="filter = 'unread'"
      >
        غير مقروء
      </button>
      <button
        type="button"
        class="nc-filter-btn"
        :class="{ active: filter === 'critical' }"
        role="tab"
        :aria-selected="filter === 'critical'"
        @click="filter = 'critical'"
      >
        حرج
      </button>
      <button
        type="button"
        class="nc-filter-btn"
        :class="{ active: filter === 'today' }"
        role="tab"
        :aria-selected="filter === 'today'"
        @click="filter = 'today'"
      >
        اليوم
      </button>
    </div>

    <ul class="nc-list">
      <li
        v-for="n in filtered"
        :key="n.id"
        class="nc-item"
        :class="[severityClass(n.severity), { unread: !n.read_at }]"
        @click="open(n)"
      >
        <div class="nc-item-row">
          <strong class="nc-item-title">{{ n.title }}</strong>
          <span class="nc-item-time" dir="ltr">{{ formatTime(n.created_at) }}</span>
        </div>
        <p class="nc-item-message">{{ n.message }}</p>
        <button
          v-if="n.severity === 'CRITICAL' && !n.acknowledged_at"
          type="button"
          data-testid="acknowledge-button"
          class="nc-ack-btn"
          @click.stop="acknowledge(n)"
        >
          تأكيد الاطلاع
        </button>
      </li>
      <li v-if="!filtered.length" class="nc-empty">لا توجد إشعارات</li>
    </ul>
  </div>
</template>

<style scoped>
.notification-center {
  padding: 16px;
  max-width: 720px;
  margin: 0 auto;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.nc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.nc-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: #E8EDF5;
}

.nc-mark-all-btn {
  border: 1px solid rgba(26, 86, 219, 0.4);
  background: rgba(26, 86, 219, 0.12);
  color: #1A56DB;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.nc-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.nc-filter-btn {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #9AA8BE;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.nc-filter-btn.active {
  border-color: rgba(26, 86, 219, 0.5);
  background: rgba(26, 86, 219, 0.18);
  color: #E8EDF5;
}

.nc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nc-item {
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 12px;
  cursor: pointer;
}

.nc-item.unread {
  border-color: rgba(26, 86, 219, 0.4);
  background: rgba(26, 86, 219, 0.10);
}

.nc-item.severity-critical {
  border-inline-start: 3px solid #EF4444;
}

.nc-item.severity-warning {
  border-inline-start: 3px solid #F59E0B;
}

.nc-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nc-item-title {
  font-size: 13px;
  color: #E8EDF5;
}

.nc-item-time {
  font-size: 10px;
  color: #7E90AA;
}

.nc-item-message {
  margin: 4px 0 0;
  font-size: 12px;
  color: #9AA8BE;
}

.nc-ack-btn {
  margin-top: 8px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.12);
  color: #EF4444;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.nc-empty {
  text-align: center;
  padding: 24px 0;
  font-size: 12px;
  color: #7E90AA;
}
</style>
