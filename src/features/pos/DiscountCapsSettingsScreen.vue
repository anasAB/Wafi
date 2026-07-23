<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useDiscountCaps } from '@/features/pos/useDiscountCaps'

const router = useRouter()
const caps = useDiscountCaps()
const cashierInput = ref(0)
const managerInput = ref(15)
const saved = ref(false)

onMounted(async () => {
  await caps.load()
  cashierInput.value = caps.cashierPct.value
  managerInput.value = caps.managerPct.value
})

async function submit(cashierPct: number, managerPct: number) {
  await caps.save({ cashierPct, managerPct })
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}

defineExpose({ submit })
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="حدود الخصم" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <p class="hint">أقصى نسبة خصم يمكن لكل رتبة تطبيقها بدون رمز موافقة المالك.</p>

    <label class="field">
      <span>الكاشير</span>
      <input type="number" min="0" max="100" v-model.number="cashierInput" />
      <span class="suffix">%</span>
    </label>

    <label class="field">
      <span>المدير</span>
      <input type="number" min="0" max="100" v-model.number="managerInput" />
      <span class="suffix">%</span>
    </label>

    <button type="button" class="save-btn" @click="submit(cashierInput, managerInput)">
      حفظ
    </button>
    <p v-if="saved" class="saved-note">تم الحفظ</p>
  </div>
</template>

<style scoped>
.page-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.hint { font-size: 12px; color: #637285; margin: 0; }
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(26,86,219,0.14);
  border-radius: 12px;
  padding: 10px 14px;
  color: #E8EDF5;
}
.field input {
  width: 70px;
  background: transparent;
  border: none;
  outline: none;
  color: #E8EDF5;
  font-size: 16px;
  font-weight: 700;
  font-family: inherit;
}
.suffix { color: #637285; }
.save-btn {
  align-self: flex-start;
  background: #1A56DB;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}
.saved-note { color: #22C55E; font-size: 12px; margin: 0; }
</style>
