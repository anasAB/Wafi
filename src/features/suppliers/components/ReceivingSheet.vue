<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
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

const hasLockedSupplier = computed(() => Boolean(props.presetSupplier))
const lineCount = computed(() => sheet.lines.value.length)
const totalQty = computed(() =>
  sheet.lines.value.reduce((sum, line) => sum + (Number(line.qtyReceived) || 0), 0),
)
const todayLabel = computed(() =>
  new Date().toLocaleDateString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric' }),
)

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
      <div>
        <h2 class="sheet-title">تسجيل استلام بضاعة</h2>
        <p class="sheet-subtitle">أضف الأصناف والكميات مع تكلفة الاستلام</p>
      </div>
      <button class="close-btn" aria-label="إغلاق" @click="emit('close')">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </header>

    <div class="sheet-content">
      <!-- Supplier selector is shown only when the sheet is opened from generic flow. -->
      <button v-if="!hasLockedSupplier" class="supplier-row" @click="showSupplierPicker = true">
        <div class="supplier-content">
          <span class="supplier-label">المورّد</span>
          <span v-if="sheet.supplierName.value" class="supplier-value">{{ sheet.supplierName.value }}</span>
          <span v-else class="muted">اختر المورّد</span>
        </div>
        <svg class="supplier-chevron" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div class="meta-strip">
        <span class="meta-chip">التاريخ: {{ todayLabel }}</span>
        <span class="meta-chip">الأصناف: {{ lineCount }}</span>
        <span class="meta-chip">إجمالي الكمية: {{ totalQty }}</span>
      </div>

      <!-- Lines -->
      <div class="section-block">
        <p class="section-title">الأصناف</p>

        <div class="lines">
          <ReceivingLineItem
            v-for="(line, i) in sheet.lines.value"
            :key="line.productId"
            :line="line"
            @update="(patch) => sheet.updateLine(i, patch)"
            @remove="sheet.removeLine(i)"
          />
          <p v-if="!sheet.lines.value.length" class="muted empty-lines">لم تتم إضافة أصناف بعد.</p>
        </div>

        <button class="btn-secondary" @click="showProductPicker = true">+ أضف صنفاً</button>
      </div>

      <!-- Invoice photo (optional) -->
      <div class="invoice-photo section-block">
        <span class="field-label">صورة الفاتورة (اختياري)</span>
        <ProductPhotoUpload
          :model-value="sheet.invoicePhotoUrl.value"
          @change="onPhotoChange"
          @error="onPhotoError"
        />
        <p v-if="photoError" class="photo-error">{{ photoError }}</p>
      </div>

      <!-- Notes -->
      <label class="notes section-block">ملاحظات
        <textarea v-model="sheet.notes.value" rows="2" placeholder="أضف ملاحظات حول الاستلام..."></textarea>
      </label>
    </div>

    <!-- Total + confirm -->
    <div class="sheet-footer">
      <div class="total-row">
        <span>الإجمالي</span>
        <strong dir="ltr">${{ sheet.totalCostUsd.value.toFixed(2) }}</strong>
      </div>
      <button class="btn-primary" :disabled="!sheet.canConfirm.value || saving" @click="onConfirm">
        {{ saving ? 'جاري الحفظ...' : 'تأكيد الاستلام' }}
      </button>
    </div>

    <SupplierPickerModal v-if="showSupplierPicker" @select="onSupplierSelect" @close="showSupplierPicker = false" />
    <ReceivingProductPicker
      v-if="showProductPicker"
      :selected-product-ids="sheet.lines.value.map(line => line.productId)"
      @select="onProductSelect"
      @close="showProductPicker = false"
    />
  </div>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  max-height: min(78vh, 680px);
  overflow: hidden;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}

.sheet-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  overflow-y: auto;
  padding-inline-end: 0.15rem;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.sheet-content::-webkit-scrollbar {
  width: 8px;
}

.sheet-content::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.sheet-content::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.sheet-content::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

.sheet-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #E8EDF5;
}

.sheet-subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.75rem;
  color: #637285;
}

.close-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  background: rgba(255,255,255,0.06);
  border: none;
  cursor: pointer;
  transition: background 0.12s;
}
.close-btn:hover { background: rgba(255,255,255,0.10); }

.supplier-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  text-align: start;
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(26,86,219,0.22);
  background: linear-gradient(135deg, rgba(26,86,219,0.12), rgba(255,255,255,0.04));
  color: #fff;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.supplier-row:hover {
  border-color: rgba(26,86,219,0.40);
}


.supplier-row:focus-visible {
  border-color: rgba(26,86,219,0.70);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
  outline: none;
}

.supplier-content {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.supplier-label {
  font-size: 0.7rem;
  color: #637285;
}

.supplier-value {
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 600;
}

.supplier-chevron { color: #637285; flex-shrink: 0; }
.meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border-radius: 999px;
  padding-inline: 0.55rem;
  font-size: 0.7rem;
  color: #9CB3D0;
  border: 1px solid rgba(26,86,219,0.22);
  background: rgba(26,86,219,0.08);
}

.muted { color: #9CB3D0; }

.section-block {
  border: 1px solid rgba(26,86,219,0.20);
  border-radius: 0.875rem;
  background: rgba(26,86,219,0.08);
  padding: 0.65rem;
}

.section-title {
  margin: 0 0 0.45rem;
  color: #E8EDF5;
  font-size: 0.82rem;
  font-weight: 700;
}

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
  max-height: clamp(180px, 32vh, 320px);
  overflow-y: auto;
  padding-inline-end: 0.15rem;
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.lines::-webkit-scrollbar {
  width: 8px;
}

.lines::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
}

.lines::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.lines::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.empty-lines {
  text-align: center;
  font-size: 0.82rem;
  padding: 0.55rem 0;
}

.notes {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: #9CB3D0;
}

.notes textarea {
  padding: 0.65rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.07);
  color: #fff;
  resize: none;
  outline: none;
}

.notes textarea:focus {
  border-color: rgba(26,86,219,0.80);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

.sheet-footer {
  border-top: 1px solid rgba(26,86,219,0.18);
  padding-top: 0.7rem;
}

.total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 1rem;
  margin-bottom: 0.55rem;
}

.total-row span {
  color: #C8D5E8;
}

.total-row strong {
  color: #4ADE80;
  font-weight: 800;
}

.btn-primary {
  width: 100%;
  height: 46px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  border: none;
  border-radius: 0.75rem;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.35);
}

.btn-primary:disabled { opacity: 0.5; }

/* "Add item" reads as a secondary add-affordance, not a primary CTA */
.btn-secondary {
  width: 100%;
  height: 40px;
  background: transparent;
  color: #60A5FA;
  border: 1px dashed rgba(26,86,219,0.45);
  border-radius: 0.75rem;
  cursor: pointer;
  font-weight: 700;
}

.btn-secondary:hover { background: rgba(26,86,219,0.08); }

.invoice-photo {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field-label {
  font-size: 0.82rem;
  color: #9CB3D0;
}

.photo-error { color: #E06A6A; font-size: 0.85rem; margin: 0; }
</style>
