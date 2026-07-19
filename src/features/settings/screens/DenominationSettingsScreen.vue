<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { useDenominationConfig } from '@/features/shifts/composables/useDenominationConfig'

const router = useRouter()
const { syp, usd, load, add, remove } = useDenominationConfig()
const newSyp = ref('')
const newUsd = ref('')
const toast  = ref<string | null>(null)

onMounted(load)

async function addSyp() {
  const value = parseFloat(newSyp.value)
  if (!value || value <= 0) return
  await add('SYP', value)
  newSyp.value = ''
  toast.value = 'تمت الإضافة'
}

async function addUsd() {
  const value = parseFloat(newUsd.value)
  if (!value || value <= 0) return
  await add('USD', value)
  newUsd.value = ''
  toast.value = 'تمت الإضافة'
}
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="فئات العملة" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <div class="intro-card">
      <p class="intro-title">فئات العملة لعدّ الصندوق</p>
      <p class="intro-sub">تُستخدم هذه القائمة عند عدّ الصندوق بالفئات في فتح/إغلاق الوردية</p>
    </div>

    <p class="section-label">ليرة سورية</p>
    <div class="settings-card settings-card--pad">
      <div class="add-row">
        <input v-model="newSyp" type="number" min="0" class="field-input" placeholder="مثال: 5000" dir="ltr" @keydown.enter="addSyp" />
        <button type="button" class="btn-primary" :disabled="!newSyp" @click="addSyp">إضافة</button>
      </div>
    </div>
    <div v-if="syp.length" class="settings-card">
      <div v-for="(d, idx) in syp" :key="d.id" class="denom-row" :class="{ 'denom-row--last': idx === syp.length - 1 }">
        <span class="denom-value" dir="ltr">{{ d.value.toLocaleString('en-US') }} ل.س</span>
        <button type="button" class="btn-danger" @click="remove(d.id)">حذف</button>
      </div>
    </div>

    <p class="section-label">دولار أمريكي</p>
    <div class="settings-card settings-card--pad">
      <div class="add-row">
        <input v-model="newUsd" type="number" min="0" step="0.01" class="field-input" placeholder="مثال: 20" dir="ltr" @keydown.enter="addUsd" />
        <button type="button" class="btn-primary" :disabled="!newUsd" @click="addUsd">إضافة</button>
      </div>
    </div>
    <div v-if="usd.length" class="settings-card">
      <div v-for="(d, idx) in usd" :key="d.id" class="denom-row" :class="{ 'denom-row--last': idx === usd.length - 1 }">
        <span class="denom-value" dir="ltr">${{ d.value }}</span>
        <button type="button" class="btn-danger" @click="remove(d.id)">حذف</button>
      </div>
    </div>
  </div>

  <AppToast v-if="toast" :message="toast" type="info" @dismiss="toast = null" />
</template>

<style scoped>
.page-body { padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; padding-bottom: 80px; font-family: 'Tajawal', system-ui, sans-serif; }
@media (min-width: 1024px) { .page-body { padding: 20px; max-width: none; } }

.intro-card {
  margin-bottom: 0.875rem; padding: 0.875rem 1rem; border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
}
.intro-title { margin: 0; font-size: 0.95rem; font-weight: 700; color: #E8EDF5; }
.intro-sub { margin: 0.2rem 0 0; font-size: 0.78rem; color: #637285; }

.section-label { font-size: 11px; font-weight: 700; color: #3D4F6B; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 4px; margin-bottom: 6px; }

.settings-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; overflow: hidden; margin-bottom: 0.75rem;
}
.settings-card--pad { padding: 0.75rem; }

.add-row { display: flex; gap: 0.45rem; }

.field-input {
  flex: 1; width: 100%; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px; padding: 9px 12px; font-size: 14px; color: #E8EDF5; outline: none; font-family: inherit;
}

.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; height: 40px; padding-inline: 0.9rem;
  border-radius: 0.625rem; font-size: 0.8125rem; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3); border: none; cursor: pointer; font-family: inherit;
}
.btn-primary:disabled { opacity: 0.45; cursor: default; }

.denom-row {
  padding: 0.7rem 0.95rem; border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  display: flex; align-items: center; justify-content: space-between;
}
.denom-row--last { border-bottom: none; }
.denom-value { font-size: 0.875rem; font-weight: 700; color: #E8EDF5; }

.btn-danger {
  height: 32px; padding-inline: 0.6rem; border-radius: 0.5rem; font-size: 0.72rem; font-weight: 700;
  color: #EF4444; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); cursor: pointer; font-family: inherit;
}
</style>
