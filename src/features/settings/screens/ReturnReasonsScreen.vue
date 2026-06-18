<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'

interface ReasonRow { id: string; label: string; sort_order: number; is_active: number }

const router = useRouter()
const reasons   = ref<ReasonRow[]>([])
const newLabel  = ref('')
const toast     = ref<string | null>(null)
const toastType = ref<'info' | 'error'>('info')

const totalReasons = computed(() => reasons.value.length)
const activeReasons = computed(() => reasons.value.filter((r) => r.is_active === 1).length)

async function load() {
  const { shopId } = useDeviceStore()
  const rows = await db.getAll<ReasonRow>(
    `SELECT id, label, sort_order, is_active FROM return_reasons WHERE shop_id = ? ORDER BY sort_order ASC`,
    [shopId],
  )
  reasons.value = rows
}

async function addReason() {
  const label = newLabel.value.trim()
  if (!label) return
  const { shopId } = useDeviceStore()
  const maxOrder  = reasons.value.reduce((m, r) => Math.max(m, r.sort_order), -1)
  await db.execute(
    `INSERT INTO return_reasons (id, shop_id, label, sort_order, is_active) VALUES (?, ?, ?, ?, 1)`,
    [uuidv4(), shopId, label, maxOrder + 1],
  )
  newLabel.value = ''
  await load()
  toastType.value = 'info'
  toast.value     = 'تمت الإضافة'
}

async function toggleActive(reason: ReasonRow) {
  await db.execute(
    `UPDATE return_reasons SET is_active = ? WHERE id = ?`,
    [reason.is_active === 1 ? 0 : 1, reason.id],
  )
  await load()
}

async function deleteReason(id: string) {
  await db.execute(`DELETE FROM return_reasons WHERE id = ?`, [id])
  await load()
}

onMounted(load)
</script>

<template>
  <div class="lg:hidden">
    <AppHeader
      title="أسباب الإرجاع"
      :show-back="true"
      :show-settings="false"
      @back="router.back()"
    />
  </div>

  <div class="page-body" dir="rtl">
    <div class="intro-card">
      <p class="intro-title">أسباب الإرجاع</p>
      <p class="intro-sub">تظهر هذه الأسباب كخيارات سريعة عند تسجيل مرتجع</p>
    </div>

    <div class="summary-row">
      <div class="summary-chip">
        <span class="summary-label">إجمالي الأسباب</span>
        <span class="summary-value">{{ totalReasons }}</span>
      </div>
      <div class="summary-chip">
        <span class="summary-label">الأسباب المفعّلة</span>
        <span class="summary-value summary-value--blue">{{ activeReasons }}</span>
      </div>
    </div>

    <p class="section-label">إضافة سبب</p>
    <div class="settings-card settings-card--pad">
      <div class="add-row">
        <input
          v-model="newLabel"
          class="field-input"
          placeholder="مثال: المنتج غير مطابق"
          @keydown.enter="addReason"
        />
        <button type="button" class="btn-primary" :disabled="!newLabel.trim()" @click="addReason">
          إضافة
        </button>
      </div>
    </div>

    <p class="section-label">القائمة</p>
    <div v-if="reasons.length === 0" class="empty-card">
      <p class="empty-title">لا توجد أسباب مضافة بعد</p>
      <p class="empty-sub">أضف أول سبب ليظهر ضمن خيارات المرتجع</p>
    </div>

    <div v-else class="settings-card">
      <div
        v-for="(r, idx) in reasons"
        :key="r.id"
        class="reason-row"
        :class="{
          'reason-row--inactive': r.is_active === 0,
          'reason-row--last': idx === reasons.length - 1,
        }"
      >
        <div class="reason-main">
          <p class="reason-label">{{ r.label }}</p>
          <span class="state-badge" :class="r.is_active === 1 ? 'state-badge--on' : 'state-badge--off'">
            {{ r.is_active === 1 ? 'إيقاف' : 'تفعيل' }}
          </span>
        </div>

        <div class="reason-actions">
          <button type="button" class="btn-outline" @click="toggleActive(r)">
            {{ r.is_active === 1 ? 'إيقاف' : 'تفعيل' }}
          </button>
          <button type="button" class="btn-danger" @click="deleteReason(r.id)">حذف</button>
        </div>
      </div>
    </div>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>

<style scoped>
.page-body {
  padding: 16px;
  max-width: 560px;
  margin: 0 auto;
  width: 100%;
  padding-bottom: 80px;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 1024px) {
  .page-body {
    padding: 20px;
    max-width: none;
  }
}

.intro-card {
  margin-bottom: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.intro-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #E8EDF5;
}

.intro-sub {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: #637285;
}

.summary-row {
  margin-bottom: 0.85rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.summary-chip {
  border-radius: 0.8rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.08);
  padding: 0.55rem 0.65rem;
}

.summary-label {
  display: block;
  color: #637285;
  font-size: 0.72rem;
}

.summary-value {
  display: block;
  margin-top: 0.2rem;
  color: #E8EDF5;
  font-size: 0.95rem;
  font-weight: 800;
}

.summary-value--blue {
  color: #60A5FA;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 8px 4px;
  margin-bottom: 6px;
}

.settings-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-radius: 1rem;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.settings-card--pad {
  padding: 0.75rem;
}

.add-row {
  display: flex;
  gap: 0.45rem;
}

.field-input {
  flex: 1;
  width: 100%;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  color: #E8EDF5;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
}

.field-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.22), 0 0 10px rgba(26,86,219,0.12);
}

.field-input::placeholder {
  color: #3D4F6B;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding-inline: 0.9rem;
  border-radius: 0.625rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 4px 16px rgba(26,86,219,0.35);
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: default;
}

.reason-row {
  padding: 0.8rem 0.95rem;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}

.reason-row--inactive {
  opacity: 0.6;
}

.reason-row--last {
  border-bottom: none;
}

.reason-main {
  min-width: 0;
}

.reason-label {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: #E8EDF5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.22rem;
  padding: 0.16rem 0.5rem;
  border-radius: 999px;
  font-size: 0.67rem;
  font-weight: 700;
}

.state-badge--on {
  background: rgba(26,86,219,0.12);
  border: 1px solid rgba(26,86,219,0.28);
  color: #60A5FA;
}

.state-badge--off {
  background: rgba(122,141,170,0.14);
  border: 1px solid rgba(122,141,170,0.25);
  color: #7A8DAA;
}

.reason-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}

.btn-outline,
.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding-inline: 0.6rem;
  border-radius: 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  border: 1px solid;
  cursor: pointer;
  font-family: inherit;
}

.btn-outline {
  color: #C8D5E8;
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.14);
}

.btn-outline:hover {
  background: rgba(255,255,255,0.1);
}

.btn-danger {
  color: #EF4444;
  background: rgba(239,68,68,0.08);
  border-color: rgba(239,68,68,0.25);
}

.btn-danger:hover {
  background: rgba(239,68,68,0.14);
}

.empty-card {
  border-radius: 1rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.08);
  padding: 2rem 1rem;
  text-align: center;
}

.empty-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: #E8EDF5;
}

.empty-sub {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: #637285;
}

@media (max-width: 639px) {
  .reason-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .reason-actions {
    width: 100%;
  }

  .btn-outline,
  .btn-danger {
    flex: 1;
  }
}
</style>
