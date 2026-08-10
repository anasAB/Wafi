<!-- src/features/settings/screens/NotificationSettingsScreen.vue -->
<!--
  WAFI-145 Task 18: owner-facing settings for the 10 shop-level notification
  types (inventory.low_stock is deliberately excluded -- its threshold lives on
  products.low_stock_threshold per product, per the design spec) plus the
  shop's business-hours configuration used by the after-hours checks.
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import {
  DEFAULT_SETTINGS, getNotificationSettings,
  type SettingsBearingType, type NotificationTypeSettings,
} from '@/services/notifications/notificationSettings'

// 10 settings-bearing types, NOT 11 -- inventory.low_stock is deliberately
// absent (its threshold is products.low_stock_threshold, per product, per the
// design spec). Read from DEFAULT_SETTINGS's own keys so this list can never
// drift from the real SettingsBearingType union.
const TYPES = Object.keys(DEFAULT_SETTINGS) as SettingsBearingType[]

const TYPE_LABELS: Record<SettingsBearingType, string> = {
  'discount.large_applied':  'خصم كبير على فاتورة',
  'drawer.variance':         'فرق في تسوية الصندوق',
  'customer.debt_threshold': 'تجاوز سقف الدين اليومي للزبون',
  'shift.late_close':        'تأخر إغلاق الوردية',
  'expense.after_hours':     'مصروف خارج ساعات العمل',
  'sale.large_return':       'إرجاع مبلغ كبير',
  'staff.pin_locked_out':    'قفل حساب موظف بعد محاولات خاطئة',
  'device.sync_stale':       'تأخر مزامنة جهاز',
  'device.registered':       'تسجيل جهاز جديد',
  'settlement.paid':         'تسوية رصيد موظف',
}

// Per-type numeric threshold field name -- four types are enable-only toggles
// with no threshold (expense.after_hours, staff.pin_locked_out,
// device.registered, settlement.paid) and are rendered without a number input.
const THRESHOLD_FIELD: Partial<Record<SettingsBearingType, string>> = {
  'discount.large_applied':  'discountPercentCap',
  'drawer.variance':         'varianceUsdCap',
  'customer.debt_threshold': 'dailyDebtUsdCap',
  'shift.late_close':        'graceMinutes',
  'sale.large_return':       'refundUsdCap',
  'device.sync_stale':       'staleHours',
}

interface Row {
  type: SettingsBearingType
  enabled: boolean
  settings: NotificationTypeSettings
  thresholdField: string | undefined
}

const router = useRouter()
const rows = ref<Row[]>([])
const openTime = ref<string>('')
const closeTime = ref<string>('')
const is24x7 = ref(false)
const hoursError = ref('')
const hoursSaved = ref(false)

async function loadRows() {
  const shopId = useDeviceStore().shopId
  rows.value = await Promise.all(TYPES.map(async (type) => {
    const s = await getNotificationSettings(shopId, type)
    const { enabled, ...settings } = s
    return { type, enabled, settings: settings as NotificationTypeSettings, thresholdField: THRESHOLD_FIELD[type] }
  }))
}

async function loadShopHours() {
  const shop = await db.getOptional<{ open_time: string | null; close_time: string | null; is_24_7: number }>(
    `select open_time, close_time, is_24_7 from shops where id = ?`, [useDeviceStore().shopId],
  )
  openTime.value = shop?.open_time ?? ''
  closeTime.value = shop?.close_time ?? ''
  is24x7.value = !!shop?.is_24_7
}

async function upsertSettings(row: Row) {
  const shopId = useDeviceStore().shopId
  const now = new Date().toISOString()
  // Read-then-insert-or-update, NOT an upsert/ON CONFLICT -- same reason as
  // dashboardRevenueProjection.ts and dailyEventCountsProjection.ts: PowerSync
  // client tables are SQLite views over CRUD-queue triggers, and SQLite
  // rejects ON CONFLICT against a view.
  const existing = await db.getOptional<{ id: string }>(
    `select id from notification_settings where shop_id = ? and type = ?`,
    [shopId, row.type],
  )
  if (existing) {
    await db.execute(
      `update notification_settings set enabled = ?, threshold_json = ?, updated_at = ? where id = ?`,
      [row.enabled ? 1 : 0, JSON.stringify(row.settings), now, existing.id],
    )
  } else {
    await db.execute(
      `insert into notification_settings (id, shop_id, type, enabled, threshold_json, updated_at) values (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), shopId, row.type, row.enabled ? 1 : 0, JSON.stringify(row.settings), now],
    )
  }
}

async function toggleEnabled(row: Row) {
  row.enabled = !row.enabled
  await upsertSettings(row)
}

async function updateThreshold(row: Row, value: string) {
  if (!row.thresholdField) return
  const num = Number(value)
  // Reject NaN AND negative values here -- not just via the input's min="0",
  // which can be bypassed by anything other than the literal HTML control
  // (e.g. programmatic dispatch). A negative varianceUsdCap/discountPercentCap
  // etc. would make every shift close / discount fire, defeating the whole
  // point of a threshold.
  if (Number.isNaN(num) || num < 0) return
  ;(row.settings as Record<string, unknown>)[row.thresholdField] = num
  await upsertSettings(row)
}

async function saveHours() {
  hoursError.value = ''
  hoursSaved.value = false
  // Only open_time === close_time is invalid -- open > close (overnight) is
  // accepted, matching the DB CHECK constraint exactly (design spec: the UI
  // must not impose a stricter rule than the database allows).
  if (!is24x7.value && openTime.value && closeTime.value && openTime.value === closeTime.value) {
    hoursError.value = 'وقت الفتح والإغلاق لا يمكن أن يكونا متطابقين'
    return
  }
  const shopId = useDeviceStore().shopId
  // The 24/7 toggle is one concept, not two independently tracked booleans and
  // times -- enabling it clears open_time/close_time to NULL so the
  // after-hours check treats the shop as always open (isWithinBusinessHours
  // short-circuits on is_24_7 before ever looking at the times).
  const [open, close] = is24x7.value ? [null, null] : [openTime.value || null, closeTime.value || null]
  await db.execute(
    `update shops set open_time = ?, close_time = ?, is_24_7 = ? where id = ?`,
    [open, close, is24x7.value ? 1 : 0, shopId],
  )
  hoursSaved.value = true
}

onMounted(async () => {
  await loadRows()
  await loadShopHours()
})
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="إعدادات الإشعارات" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <section class="settings-card settings-card--pad business-hours">
      <p class="section-label">ساعات العمل</p>
      <label class="hours-24-7">
        <input v-model="is24x7" type="checkbox" data-testid="is-24-7-checkbox" @change="hoursSaved = false" />
        مفتوح على مدار الساعة (٢٤/٧)
      </label>

      <div v-if="!is24x7" class="hours-row">
        <label class="hours-field">
          <span>وقت الفتح</span>
          <input
            v-model="openTime"
            type="time"
            class="field-input"
            data-testid="open-time-input"
            @input="hoursSaved = false"
          />
        </label>
        <label class="hours-field">
          <span>وقت الإغلاق</span>
          <input
            v-model="closeTime"
            type="time"
            class="field-input"
            data-testid="close-time-input"
            @input="hoursSaved = false"
          />
        </label>
      </div>

      <button type="button" class="btn-primary" data-testid="save-hours-button" @click="saveHours">
        حفظ ساعات العمل
      </button>
      <p v-if="hoursError" class="hours-error" data-testid="hours-validation-error">{{ hoursError }}</p>
      <p v-else-if="hoursSaved" class="hours-saved">تم الحفظ</p>
    </section>

    <p class="section-label">أنواع الإشعارات</p>
    <div class="settings-card">
      <div
        v-for="(row, idx) in rows"
        :key="row.type"
        class="type-row"
        :class="{ 'type-row--last': idx === rows.length - 1 }"
        :data-testid="`notification-type-row-${row.type}`"
      >
        <div class="type-row-main">
          <span class="type-row-label">{{ TYPE_LABELS[row.type] }}</span>
          <label class="switch">
            <input
              type="checkbox"
              :checked="row.enabled"
              :data-testid="`enable-toggle-${row.type}`"
              @change="toggleEnabled(row)"
            >
          </label>
        </div>
        <div v-if="row.thresholdField" class="type-row-threshold">
          <input
            type="number"
            min="0"
            class="field-input field-input--small"
            :value="(row.settings as any)[row.thresholdField]"
            :data-testid="`threshold-input-${row.type}`"
            :disabled="!row.enabled"
            @change="updateThreshold(row, ($event.target as HTMLInputElement).value)"
          >
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-body { padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; padding-bottom: 80px; font-family: 'Tajawal', system-ui, sans-serif; }
@media (min-width: 1024px) { .page-body { padding: 20px; max-width: none; } }

.section-label { font-size: 11px; font-weight: 700; color: #3D4F6B; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 4px; margin-bottom: 6px; }

.settings-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; overflow: hidden; margin-bottom: 0.75rem;
}
.settings-card--pad { padding: 0.875rem; }

.business-hours { display: flex; flex-direction: column; gap: 0.65rem; }

.hours-24-7 { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; font-weight: 600; color: #E8EDF5; }

.hours-row { display: flex; gap: 0.6rem; }
.hours-field { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; font-size: 0.75rem; color: #9AA8BE; }

.field-input {
  width: 100%; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px; padding: 9px 12px; font-size: 14px; color: #E8EDF5; outline: none; font-family: inherit;
}
.field-input--small { max-width: 110px; }

.btn-primary {
  align-self: flex-start; display: inline-flex; align-items: center; justify-content: center; height: 40px; padding-inline: 0.9rem;
  border-radius: 0.625rem; font-size: 0.8125rem; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3); border: none; cursor: pointer; font-family: inherit;
}

.hours-error { margin: 0; font-size: 0.78rem; color: #EF4444; }
.hours-saved { margin: 0; font-size: 0.78rem; color: #22C55E; }

.type-row {
  padding: 0.7rem 0.95rem; border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  display: flex; flex-direction: column; gap: 0.5rem;
}
.type-row--last { border-bottom: none; }

.type-row-main { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.type-row-label { font-size: 0.85rem; font-weight: 600; color: #E8EDF5; }

.switch input { width: 18px; height: 18px; }

.type-row-threshold { display: flex; justify-content: flex-end; }
</style>
