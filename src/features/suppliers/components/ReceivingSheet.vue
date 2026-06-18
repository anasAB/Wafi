<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReceivingSheet } from '../composables/useReceivingSheet'
import SupplierPickerModal from './SupplierPickerModal.vue'
import ReceivingProductPicker from './ReceivingProductPicker.vue'
import ReceivingLineItem from './ReceivingLineItem.vue'
import ProductPhotoUpload from '@/features/products/components/ProductPhotoUpload.vue'

const props = defineProps<{ presetSupplier?: { id: string; name: string } }>()
const emit = defineEmits<{ saved: []; close: [] }>()

const sheet = useReceivingSheet()
const showSupplierPicker = ref(false)
const showProductPicker  = ref(false)
const saving = ref(false)
const photoError = ref('')

onMounted(() => {
  if (props.presetSupplier) {
    sheet.supplierId.value   = props.presetSupplier.id
    sheet.supplierName.value = props.presetSupplier.name
  }
})

function onSupplierSelect(s: { id: string; name: string }) {
  sheet.supplierId.value   = s.id
  sheet.supplierName.value = s.name
  showSupplierPicker.value = false
}

function onProductSelect(p: { id: string; nameAr: string; costPriceUsd: number }) {
  sheet.addLine(p)
  showProductPicker.value = false
}

function onPhotoChange(url: string | null) {
  sheet.invoicePhotoUrl.value = url
  photoError.value = ''
}

function onPhotoError(msg: string) {
  photoError.value = msg
}

async function onConfirm() {
  if (!sheet.canConfirm.value || saving.value) return
  saving.value = true
  try {
    await sheet.confirm()
    emit('saved')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="sheet" dir="rtl">
    <header class="sheet-head">
      <h2>تسجيل استلام بضاعة</h2>
      <button class="close-btn" aria-label="إغلاق" @click="emit('close')">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </header>

    <!-- Supplier (combobox — chevron signals it opens a picker, not a text field) -->
    <button class="supplier-row" @click="showSupplierPicker = true">
      <span v-if="sheet.supplierName.value">المورّد: {{ sheet.supplierName.value }}</span>
      <span v-else class="muted">اختر المورّد</span>
      <svg class="supplier-chevron" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Lines -->
    <div class="lines">
      <ReceivingLineItem
        v-for="(line, i) in sheet.lines.value"
        :key="line.productId"
        :line="line"
        @remove="sheet.removeLine(i)"
      />
      <p v-if="!sheet.lines.value.length" class="muted">لم تتم إضافة أصناف بعد.</p>
    </div>
    <button class="btn-secondary" @click="showProductPicker = true">+ أضف صنفاً</button>

    <!-- Invoice photo (optional) -->
    <div class="invoice-photo">
      <span class="field-label">صورة الفاتورة (اختياري)</span>
      <ProductPhotoUpload
        :model-value="sheet.invoicePhotoUrl.value"
        @change="onPhotoChange"
        @error="onPhotoError"
      />
      <p v-if="photoError" class="photo-error">{{ photoError }}</p>
    </div>

    <!-- Notes -->
    <label class="notes">ملاحظات
      <textarea v-model="sheet.notes.value" rows="2"></textarea>
    </label>

    <!-- Total + confirm -->
    <div class="total-row">
      <span>الإجمالي</span>
      <strong>{{ sheet.totalCostUsd.value.toFixed(2) }}$</strong>
    </div>
    <button class="btn-primary" :disabled="!sheet.canConfirm.value || saving" @click="onConfirm">
      تأكيد الاستلام
    </button>

    <SupplierPickerModal v-if="showSupplierPicker" @select="onSupplierSelect" @close="showSupplierPicker = false" />
    <ReceivingProductPicker v-if="showProductPicker" @select="onProductSelect" @close="showProductPicker = false" />
  </div>
</template>

<style scoped>
.sheet { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; }
.close-btn {
  width: 2rem; height: 2rem; border-radius: 0.625rem;
  display: flex; align-items: center; justify-content: center;
  color: #637285; background: rgba(255,255,255,0.06); border: none; cursor: pointer;
  transition: background 0.12s;
}
.close-btn:hover { background: rgba(255,255,255,0.10); }
.supplier-row {
  display: flex; align-items: center; justify-content: space-between;
  text-align: start; padding: 0.75rem; border-radius: 0.75rem;
  border: 1px solid #2A3A52; background: #0D1828; color: #fff; cursor: pointer;
}
.supplier-chevron { color: #637285; flex-shrink: 0; }
.muted { color: #9CB3D0; }
.lines { display: flex; flex-direction: column; gap: 0.5rem; }
.notes { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
.notes textarea { padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0D1828; color: #fff; resize: none; }
.total-row { display: flex; justify-content: space-between; align-items: center; font-size: 1.1rem; padding: 0.75rem 0 0.25rem; border-top: 1px solid rgba(26,86,219,0.18); }
.btn-primary { background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; border: none; padding: 0.8rem; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; box-shadow: 0 4px 16px rgba(26,86,219,0.35); }
.btn-primary:disabled { opacity: 0.5; }
/* "Add item" reads as a secondary add-affordance, not a primary CTA */
.btn-secondary { background: transparent; color: #60A5FA; border: 1px dashed rgba(26,86,219,0.45); padding: 0.6rem; border-radius: 0.5rem; cursor: pointer; }
.btn-secondary:hover { background: rgba(26,86,219,0.08); }
.invoice-photo { display: flex; flex-direction: column; gap: 0.4rem; }
.field-label { font-size: 0.9rem; color: #9CB3D0; }
.photo-error { color: #E06A6A; font-size: 0.85rem; margin: 0; }
</style>
