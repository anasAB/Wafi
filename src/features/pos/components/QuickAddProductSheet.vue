<script setup lang="ts">
import { ref, computed } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { useProducts } from '@/features/products/composables/useProducts'
import { useDeviceStore } from '@/store/device.store'

const props = defineProps<{ barcode: string }>()
const emit = defineEmits<{ (e: 'saved', productId: string): void; (e: 'cancel'): void }>()

const { save } = useProducts()

const nameAr = ref('')
const price  = ref('')
const cost   = ref('')
const saving = ref(false)
const error  = ref('')

const canSave = computed(() => nameAr.value.trim().length > 0 && parseFloat(price.value) > 0)

async function confirm() {
  if (!canSave.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const device = useDeviceStore()
    const id = await save({
      shopId:            device.shopId,
      nameAr:             nameAr.value.trim(),
      salePriceUsd:       parseFloat(price.value),
      // Skipping cost is explicit and visible downstream — never silently 0
      // treated as "known": the uncosted-sales notice on /reports reads this.
      costPriceUsd:       parseFloat(cost.value) || 0,
      currentStock:       0,
      lowStockThreshold:  0,
      isActive:           true,
      barcode:            props.barcode,
      createdVia:         'quick_add',
    })
    emit('saved', id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'تعذّر إنشاء المنتج'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="إضافة سريعة" @close="emit('cancel')">
    <div class="qa-body" dir="rtl">
      <p class="qa-barcode">الباركود: <span dir="ltr">{{ barcode }}</span></p>

      <p v-if="error" class="qa-error">{{ error }}</p>

      <label class="qa-field">
        <span class="qa-label">الاسم</span>
        <input v-model="nameAr" type="text" class="qa-input" placeholder="اسم المنتج" autofocus />
      </label>

      <label class="qa-field">
        <span class="qa-label">السعر ($)</span>
        <input v-model="price" type="number" min="0" step="0.01" class="qa-input" placeholder="0.00" dir="ltr" />
      </label>

      <label class="qa-field">
        <span class="qa-label">التكلفة ($) — اختياري</span>
        <input v-model="cost" type="number" min="0" step="0.01" class="qa-input" placeholder="تخطّي" dir="ltr" />
      </label>
    </div>

    <template #footer>
      <div class="qa-footer">
        <button type="button" class="btn-cancel" @click="emit('cancel')">إلغاء</button>
        <button type="button" class="btn-confirm" :disabled="!canSave || saving" @click="confirm">
          {{ saving ? 'جارٍ الحفظ...' : 'حفظ وإضافة للسلة' }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.qa-body { font-family: 'Tajawal', system-ui, sans-serif; display: flex; flex-direction: column; gap: 0.75rem; }
.qa-barcode { font-size: 0.8125rem; color: #93A3B8; margin: 0; }
.qa-error {
  margin: 0; font-size: 0.8125rem; color: #FCA5A5; text-align: center;
  border: 1px solid rgba(239, 68, 68, 0.35); background: rgba(127, 29, 29, 0.22);
  border-radius: 0.75rem; padding: 0.5rem 0.625rem;
}
.qa-field { display: flex; flex-direction: column; gap: 0.35rem; }
.qa-label { font-size: 0.75rem; font-weight: 600; color: #93A3B8; }
.qa-input {
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem; padding: 0.625rem 0.875rem; color: #E8EDF5; font-size: 0.9rem;
  outline: none; font-family: inherit;
}
.qa-input:focus { border-color: rgba(26,86,219,0.8); box-shadow: 0 0 0 3px rgba(26,86,219,0.25); }
.qa-footer { display: flex; gap: 0.75rem; }
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
