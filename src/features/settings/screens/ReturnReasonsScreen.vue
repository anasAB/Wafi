<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import AppToast from '@/components/ui/AppToast.vue'

interface ReasonRow { id: string; label: string; sort_order: number; is_active: number }

const reasons   = ref<ReasonRow[]>([])
const newLabel  = ref('')
const toast     = ref<string | null>(null)
const toastType = ref<'info' | 'error'>('info')

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
  <div class="rr-page" dir="rtl">
    <div class="rr-header">
      <h2 class="rr-title">أسباب الإرجاع</h2>
      <p class="rr-sub">تظهر هذه الأسباب كخيارات سريعة عند تسجيل مرتجع</p>
    </div>

    <div class="rr-add-row">
      <input
        v-model="newLabel"
        class="rr-input"
        placeholder="سبب جديد..."
        @keydown.enter="addReason"
      />
      <button type="button" class="rr-add-btn" :disabled="!newLabel.trim()" @click="addReason">
        إضافة
      </button>
    </div>

    <div v-if="reasons.length === 0" class="rr-empty">لا توجد أسباب مضافة بعد</div>

    <div v-else class="rr-list">
      <div v-for="r in reasons" :key="r.id" class="rr-row">
        <span class="rr-label" :class="{ 'rr-label--inactive': r.is_active === 0 }">{{ r.label }}</span>
        <div class="rr-actions">
          <button type="button" class="rr-toggle-btn" @click="toggleActive(r)">
            {{ r.is_active === 1 ? 'إيقاف' : 'تفعيل' }}
          </button>
          <button type="button" class="rr-delete-btn" @click="deleteReason(r.id)">حذف</button>
        </div>
      </div>
    </div>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>

<style scoped>
.rr-page   { padding: 20px 16px; font-family: 'Tajawal', system-ui, sans-serif; color: #E8EDF5; }
.rr-header { margin-bottom: 16px; }
.rr-title  { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
.rr-sub    { font-size: 13px; color: #637285; margin: 0; }
.rr-add-row { display: flex; gap: 8px; margin-bottom: 16px; }
.rr-input {
  flex: 1; background: rgba(26,86,219,0.08); border: 1px solid rgba(26,86,219,0.22);
  border-radius: 8px; padding: 9px 12px; color: #E8EDF5; font-size: 14px; font-family: inherit;
}
.rr-input::placeholder { color: #3D4F6B; }
.rr-add-btn {
  padding: 9px 16px; border-radius: 8px; background: #1A56DB; color: white;
  border: none; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.rr-add-btn:disabled { opacity: 0.4; cursor: default; }
.rr-empty  { font-size: 14px; color: #637285; text-align: center; padding: 32px 0; }
.rr-list   { display: flex; flex-direction: column; gap: 0; }
.rr-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.rr-row:last-child { border-bottom: none; }
.rr-label  { font-size: 14px; font-weight: 500; }
.rr-label--inactive { opacity: 0.4; text-decoration: line-through; }
.rr-actions { display: flex; gap: 8px; }
.rr-toggle-btn, .rr-delete-btn {
  font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
  background: transparent; border: 1px solid rgba(255,255,255,0.12); color: #637285;
  font-family: inherit; transition: border-color 0.15s, color 0.15s;
}
.rr-toggle-btn:hover { border-color: #1A56DB; color: #60A5FA; }
.rr-delete-btn:hover { border-color: #EF4444; color: #EF4444; }
</style>
