<script setup lang="ts">
import { ref, computed } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'

const emit = defineEmits<{ (e: 'confirm', payload: { nameAr: string; priceUsd: number }): void; (e: 'cancel'): void }>()

const nameAr = ref('')
const price  = ref('')

// A free giveaway ($0) must go through the discount/PIN-approval path (WAFI-100)
// so it's audited — never a silent zero-price open item.
const canConfirm = computed(() => nameAr.value.trim().length > 0 && parseFloat(price.value) > 0)

function confirm() {
  if (!canConfirm.value) return
  emit('confirm', { nameAr: nameAr.value.trim(), priceUsd: parseFloat(price.value) })
}
</script>

<template>
  <BaseModal title="بند حر" @close="emit('cancel')">
    <div class="oi-body" dir="rtl">
      <p class="oi-hint">لبيع صنف غير موجود في الكتالوج — لا يُضاف إلى المخزون</p>

      <label class="oi-field">
        <span class="oi-label">الاسم</span>
        <input v-model="nameAr" type="text" class="oi-input" placeholder="اسم الصنف" autofocus />
      </label>

      <label class="oi-field">
        <span class="oi-label">السعر ($)</span>
        <input v-model="price" type="number" min="0" step="0.01" class="oi-input" placeholder="0.00" dir="ltr" />
      </label>
    </div>

    <template #footer>
      <div class="oi-footer">
        <button type="button" class="btn-cancel" @click="emit('cancel')">إلغاء</button>
        <button type="button" class="btn-confirm" :disabled="!canConfirm" @click="confirm">إضافة للسلة</button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.oi-body { font-family: 'Tajawal', system-ui, sans-serif; display: flex; flex-direction: column; gap: 0.75rem; }
.oi-hint { margin: 0; font-size: 0.78rem; color: #93A3B8; }
.oi-field { display: flex; flex-direction: column; gap: 0.35rem; }
.oi-label { font-size: 0.75rem; font-weight: 600; color: #93A3B8; }
.oi-input {
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem; padding: 0.625rem 0.875rem; color: #E8EDF5; font-size: 0.9rem;
  outline: none; font-family: inherit;
}
.oi-input:focus { border-color: rgba(26,86,219,0.8); box-shadow: 0 0 0 3px rgba(26,86,219,0.25); }
.oi-footer { display: flex; gap: 0.75rem; }
.btn-cancel {
  height: 48px; min-width: 112px; padding-inline: 1rem; border-radius: 1rem;
  background: transparent; border: 1px solid rgba(255,255,255,0.18); color: #E8EDF5;
  font-size: 1rem; cursor: pointer; font-family: inherit;
}
.btn-confirm {
  flex: 1; height: 48px; border-radius: 1rem; background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: white; border: none; font-size: 0.95rem; font-weight: 700; cursor: pointer; font-family: inherit;
}
.btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
