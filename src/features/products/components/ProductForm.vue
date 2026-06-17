<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDeviceStore } from '@/store/device.store'
import { useProducts } from '@/features/products/composables/useProducts'
import { useStockAdjustment } from '@/features/products/composables/useStockAdjustment'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import ProductPhotoUpload from './ProductPhotoUpload.vue'
import StockAdjustmentDialog from './StockAdjustmentDialog.vue'
import type { Product } from '@/features/pos/pos.types'

const props = defineProps<{
  mode:            'add' | 'edit'
  product?:        Product
  initialBarcode?: string
}>()

const emit = defineEmits<{
  (e: 'saved'):   void
  (e: 'cancel'):  void
}>()

const device   = useDeviceStore()
const products = useProducts()
const adj      = useStockAdjustment()
const scanner  = useBarcodeScan()

const nameAr    = ref(props.product?.nameAr       ?? '')
const nameEn    = ref(props.product?.nameEn       ?? '')
const barcode   = ref(props.product?.barcode ?? props.initialBarcode ?? '')
const category  = ref(props.product?.category     ?? '')
const costPrice = ref<number | ''>(props.product?.costPriceUsd ?? '')
const salePrice = ref<number | ''>(props.product?.salePriceUsd ?? '')
const stock     = ref<number | ''>(props.product?.currentStock ?? '')
const threshold = ref<number>(props.product?.lowStockThreshold ?? 5)
const photoUrl  = ref<string | null>(props.product?.photoUrl ?? null)

const originalStock = props.product?.currentStock ?? 0

const errors       = ref<Record<string, string>>({})
const priceWarning = ref(false)
const saving       = ref(false)
const photoError   = ref<string | null>(null)
const showOptional = ref(false)

const margin = computed(() => {
  const cost = Number(costPrice.value)
  const sale = Number(salePrice.value)
  if (!cost || !sale || cost <= 0 || sale <= 0) return null
  return Math.round(((sale - cost) / cost) * 100)
})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!nameAr.value.trim())   e['name-ar']       = 'هذا الحقل مطلوب'
  if (costPrice.value === '') e['cost-price']    = 'هذا الحقل مطلوب'
  if (salePrice.value === '') e['sale-price']    = 'هذا الحقل مطلوب'
  if (stock.value === '')     e['current-stock'] = 'هذا الحقل مطلوب'
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave(addAnother = false) {
  if (!validate()) return
  const cost = Number(costPrice.value)
  const sale = Number(salePrice.value)
  if (sale < cost) { priceWarning.value = true; return }
  const newStock = Number(stock.value)
  if (props.mode === 'edit' && props.product && newStock !== originalStock) {
    adj.open(props.product.id, props.product.nameAr, originalStock, newStock)
    return
  }
  await commitSave(newStock, addAnother)
}

async function commitSave(newStock: number, addAnother = false) {
  saving.value = true
  try {
    await products.save({
      ...(props.product?.id ? { id: props.product.id } : {}),
      shopId:            device.shopId,
      nameAr:            nameAr.value.trim(),
      nameEn:            nameEn.value.trim() || undefined,
      barcode:           barcode.value.trim() || undefined,
      category:          category.value.trim() || undefined,
      costPriceUsd:      Number(costPrice.value),
      salePriceUsd:      Number(salePrice.value),
      currentStock:      newStock,
      lowStockThreshold: threshold.value,
      photoUrl:          photoUrl.value ?? undefined,
      isActive:          true,
      createdAt:         props.product?.createdAt ?? '',
      updatedAt:         '',
    })
    if (addAnother) {
      nameAr.value = ''; nameEn.value = ''; barcode.value = ''; category.value = ''
      costPrice.value = ''; salePrice.value = ''; stock.value = ''
      threshold.value = 5; photoUrl.value = null
      errors.value = {}; priceWarning.value = false
    } else {
      emit('saved')
    }
  } finally {
    saving.value = false
  }
}

async function handleAdjConfirm() {
  await products.adjustStock(
    adj.pendingProductId.value!,
    adj.pendingNewValue.value,
    adj.reason.value,
    adj.notes.value || undefined
  )
  adj.cancel()
  await commitSave(adj.pendingNewValue.value)
}

onMounted(() => {
  products.load()
  scanner.onScan((code: string) => { barcode.value = code })
})
</script>

<template>
  <div class="form-root" dir="rtl">

    <!-- ── Section: Basic Info (required) ───────────────── -->
    <div class="form-section">
      <p class="section-label">المعلومات الأساسية</p>

      <!-- Name AR -->
      <div class="field">
        <label class="field-label">الاسم بالعربي <span class="required">*</span></label>
        <input
          v-model="nameAr"
          data-testid="name-ar"
          type="text"
          class="form-input"
          :class="{ 'input-error': errors['name-ar'] }"
          placeholder="مثال: شاشة سامسونج 55 بوصة"
          @focus="($event.target as HTMLInputElement).style.borderColor = errors['name-ar'] ? '#EF4444' : 'rgba(26,86,219,0.8)'"
          @blur="($event.target as HTMLInputElement).style.borderColor = errors['name-ar'] ? '#EF4444' : 'rgba(255,255,255,0.18)'"
          @input="delete errors['name-ar']"
        />
        <p v-if="errors['name-ar']" data-testid="error-name-ar" class="field-error">
          {{ errors['name-ar'] }}
        </p>
      </div>
    </div>

    <!-- ── Section: Pricing ───────────────────────────── -->
    <div class="form-section">
      <p class="section-label">التسعير</p>

      <!-- Price warning -->
      <div v-if="priceWarning" data-testid="price-warning" class="price-warning">
        <p class="price-warning-title">سعر البيع أقل من سعر التكلفة — هل أنت متأكد؟</p>
        <div class="price-warning-actions">
          <button type="button" class="warning-confirm-btn" data-testid="confirm-price-warning"
            @click="priceWarning = false; commitSave(Number(stock))">نعم، احفظ</button>
          <button type="button" class="warning-cancel-btn"
            @click="priceWarning = false">لا، تراجع</button>
        </div>
      </div>

      <!-- Cost + Sale prices -->
      <div class="grid-2">
        <div class="field">
          <label class="field-label">سعر التكلفة $ <span class="required">*</span></label>
          <input v-model="costPrice" data-testid="cost-price" type="number" min="0" step="0.01"
            class="form-input"
            :class="{ 'input-error': errors['cost-price'] }"
            placeholder="0.00"
            @focus="($event.target as HTMLInputElement).style.borderColor = errors['cost-price'] ? '#EF4444' : 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = errors['cost-price'] ? '#EF4444' : 'rgba(255,255,255,0.18)'"
            @input="delete errors['cost-price']" />
          <p v-if="errors['cost-price']" class="field-error">{{ errors['cost-price'] }}</p>
        </div>
        <div class="field">
          <label class="field-label">سعر البيع $ <span class="required">*</span></label>
          <input v-model="salePrice" data-testid="sale-price" type="number" min="0" step="0.01"
            class="form-input"
            :class="{ 'input-error': errors['sale-price'] }"
            placeholder="0.00"
            @focus="($event.target as HTMLInputElement).style.borderColor = errors['sale-price'] ? '#EF4444' : 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = errors['sale-price'] ? '#EF4444' : 'rgba(255,255,255,0.18)'"
            @input="delete errors['sale-price']" />
          <p v-if="errors['sale-price']" class="field-error">{{ errors['sale-price'] }}</p>
        </div>
      </div>

      <!-- Margin badge -->
      <div v-if="margin !== null" data-testid="margin-display" class="margin-row">
        <span class="margin-label">هامش الربح على التكلفة:</span>
        <span class="margin-badge" :class="margin >= 0 ? 'margin-positive' : 'margin-negative'">
          {{ margin }}%
        </span>
      </div>
    </div>

    <!-- ── Section: Stock ─────────────────────────────── -->
    <div class="form-section">
      <p class="section-label">المخزون</p>

      <div class="field">
        <label class="field-label">الكمية الحالية <span class="required">*</span></label>
        <input v-model="stock" data-testid="current-stock" type="number" step="1"
          class="form-input"
          :class="{ 'input-error': errors['current-stock'] }"
          placeholder="0"
          @focus="($event.target as HTMLInputElement).style.borderColor = errors['current-stock'] ? '#EF4444' : 'rgba(26,86,219,0.8)'"
          @blur="($event.target as HTMLInputElement).style.borderColor = errors['current-stock'] ? '#EF4444' : 'rgba(255,255,255,0.18)'"
          @input="delete errors['current-stock']" />
        <p v-if="errors['current-stock']" class="field-error">{{ errors['current-stock'] }}</p>
      </div>
    </div>

    <!-- ── Optional Details Toggle ────────────────────── -->
    <button type="button" class="expand-btn" @click="showOptional = !showOptional">
      <svg class="expand-chevron" :class="{ 'expand-chevron-open': showOptional }" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
      {{ showOptional ? 'إخفاء التفاصيل الإضافية' : 'تفاصيل إضافية (باركود، فئة، صورة...)' }}
    </button>

    <!-- ── Optional Fields ────────────────────────────── -->
    <template v-if="showOptional">
      <div class="form-section">
        <p class="section-label">تفاصيل إضافية</p>

        <!-- Name EN -->
        <div class="field">
          <label class="field-label">الاسم بالإنجليزي <span class="optional">(اختياري)</span></label>
          <input v-model="nameEn" data-testid="name-en" type="text"
            class="form-input"
            placeholder="مثال: Samsung TV 55 inch"
            @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'" />
        </div>

        <!-- Barcode -->
        <div class="field">
          <label class="field-label">الباركود <span class="optional">(اختياري)</span></label>
          <input v-model="barcode" data-testid="barcode" type="text"
            class="form-input"
            placeholder="امسح الباركود أو أدخله يدوياً"
            @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'" />
        </div>

        <!-- Category -->
        <div class="field">
          <label class="field-label">الفئة <span class="optional">(اختياري)</span></label>
          <input v-model="category" data-testid="category" type="text"
            class="form-input"
            placeholder="مثال: إلكترونيات، شواحن..."
            @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'" />
        </div>

        <!-- Low stock threshold -->
        <div class="field">
          <label class="field-label">حد التنبيه للمخزون</label>
          <input v-model="threshold" data-testid="threshold" type="number" min="0" step="1"
            class="form-input"
            @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'" />
          <p class="field-hint">إنذار عند الوصول لهذه الكمية (الافتراضي: 5)</p>
        </div>
      </div>

      <!-- Photo -->
      <div class="form-section">
        <p class="section-label">الصورة <span class="optional">(اختياري)</span></p>
        <p v-if="photoError" class="field-error mb-2">{{ photoError }}</p>
        <ProductPhotoUpload
          :model-value="photoUrl"
          @change="photoUrl = $event"
          @error="photoError = $event"
        />
      </div>
    </template>

    <!-- ── Sticky Save Bar ─────────────────────────────── -->
    <div class="save-bar">
      <div class="save-bar-inner" dir="rtl">
        <button
          type="button"
          data-testid="save-btn"
          :disabled="saving"
          class="btn-primary"
          @click="handleSave(false)"
        >{{ saving ? 'جاري الحفظ...' : 'حفظ' }}</button>

        <button
          v-if="mode === 'add'"
          type="button"
          data-testid="save-another-btn"
          :disabled="saving"
          class="btn-secondary"
          @click="handleSave(true)"
        >إضافة أخرى</button>

        <button
          type="button"
          data-testid="cancel-btn"
          class="btn-ghost"
          @click="emit('cancel')"
        >إلغاء</button>
      </div>
    </div>

    <StockAdjustmentDialog
      :is-open="adj.isOpen.value"
      :product-name="adj.pendingProductName.value"
      :old-value="adj.pendingOldValue.value"
      :new-value="adj.pendingNewValue.value"
      :reason="adj.reason.value"
      :notes="adj.notes.value"
      @update:reason="adj.reason.value = $event"
      @update:notes="adj.notes.value = $event"
      @confirm="handleAdjConfirm"
      @cancel="adj.cancel()"
    />
  </div>
</template>

<style scoped>
.form-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 7rem;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Form Section ─────────────────────────────────── */
.form-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.18);
  border-radius: 0.75rem;
  padding: 16px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #637285;
  margin: 0;
}

/* ── Fields ───────────────────────────────────────── */
.field {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  margin-bottom: 6px;
}

.required {
  color: #EF4444;
}

.optional {
  color: #3D4F6B;
  font-weight: 400;
}

.field-error {
  font-size: 11px;
  color: #EF4444;
  margin-top: 5px;
}

.field-hint {
  font-size: 11px;
  color: #637285;
  margin-top: 5px;
}

/* ── Form Input ───────────────────────────────────── */
.form-input {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  width: 100%;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.form-input::placeholder {
  color: #3D4F6B;
}

.form-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

.form-input.input-error {
  border-color: #EF4444;
}

/* ── Grid ─────────────────────────────────────────── */
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

/* ── Optional Expand Button ──────────────────────── */
.expand-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border-radius: 0.75rem;
  font-size: 13px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #637285;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.10);
  cursor: pointer;
  text-align: right;
  transition: color 0.15s, background 0.15s;
}

.expand-btn:hover {
  color: #C8D5E8;
  background: rgba(26,86,219,0.08);
  border-color: rgba(26,86,219,0.20);
}

.expand-chevron {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: transform 0.2s;
}

.expand-chevron-open {
  transform: rotate(180deg);
}

/* ── Price Warning ────────────────────────────────── */
.price-warning {
  background: rgba(245,158,11,0.08);
  border: 1px solid rgba(245,158,11,0.30);
  border-radius: 0.75rem;
  padding: 12px 14px;
}

.price-warning-title {
  font-size: 13px;
  font-weight: 600;
  color: #FCD34D;
  margin: 0 0 10px 0;
}

.price-warning-actions {
  display: flex;
  gap: 12px;
}

.warning-confirm-btn {
  font-size: 12px;
  font-weight: 700;
  color: #FCD34D;
  text-decoration: underline;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.warning-cancel-btn {
  font-size: 12px;
  color: #637285;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

/* ── Margin Badge ─────────────────────────────────── */
.margin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
}

.margin-label {
  color: #637285;
}

.margin-badge {
  border-radius: 8px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}

.margin-positive {
  background: rgba(34,197,94,0.15);
  color: #22C55E;
}

.margin-negative {
  background: rgba(239,68,68,0.15);
  color: #EF4444;
}

/* ── Save Bar ─────────────────────────────────────── */
.save-bar {
  position: fixed;
  bottom: 0;
  inset-inline-start: 0;
  inset-inline-end: 0;
  z-index: 20;
  background: #06090F;
  border-top: 1px solid rgba(26,86,219,0.14);
}

@media (min-width: 1024px) {
  .save-bar {
    inset-inline-start: 220px;
  }
}

.save-bar-inner {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  max-width: 42rem;
  margin: 0 auto;
}

@media (min-width: 1024px) {
  .save-bar-inner {
    max-width: none;
  }
}

/* ── Buttons ──────────────────────────────────────── */
.btn-primary {
  flex: 1;
  height: 48px;
  border-radius: 0.75rem;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.88;
}

.btn-primary:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  height: 48px;
  padding: 0 16px;
  border-radius: 0.75rem;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #60A5FA;
  background: rgba(26,86,219,0.12);
  border: 1px solid rgba(26,86,219,0.30);
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-secondary:hover:not(:disabled) {
  opacity: 0.80;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-ghost {
  height: 48px;
  padding: 0 16px;
  border-radius: 0.75rem;
  font-size: 14px;
  font-weight: 500;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #637285;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.18);
  cursor: pointer;
  transition: color 0.15s;
}

.btn-ghost:hover {
  color: #E8EDF5;
}
</style>
