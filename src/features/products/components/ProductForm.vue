<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Select from 'primevue/select'
import { useDeviceStore } from '@/store/device.store'
import { useProducts } from '@/features/products/composables/useProducts'
import { useStockAdjustment } from '@/features/products/composables/useStockAdjustment'
import { useCategories } from '@/features/categories/composables/useCategories'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import ProductPhotoUpload from './ProductPhotoUpload.vue'
import StockAdjustmentDialog from './StockAdjustmentDialog.vue'
import CategoryQuickAdd from '@/features/categories/components/CategoryQuickAdd.vue'
import type { Product } from '@/features/pos/pos.types'

const props = defineProps<{
  mode:            'add' | 'edit'
  product?:        Product
  initialBarcode?: string
  // When hosted inside a modal (or the edit page), render the actions inline
  // instead of a viewport-fixed bar (which otherwise overlaps the nav). (#10)
  embedded?:       boolean
  // Optional teleport target for placing the embedded save bar in page layout.
  saveBarTeleportTo?: string
}>()

const emit = defineEmits<{
  (e: 'saved'):   void
  (e: 'cancel'):  void
}>()

const device     = useDeviceStore()
const products   = useProducts()
const adj        = useStockAdjustment()
const scanner    = useBarcodeScan()
const categories = useCategories()

const nameAr        = ref(props.product?.nameAr       ?? '')
const nameEn        = ref(props.product?.nameEn       ?? '')
const barcode       = ref(props.product?.barcode ?? props.initialBarcode ?? '')
const categoryId    = ref(props.product?.categoryId    ?? '')
const subcategoryId = ref(props.product?.subcategoryId ?? '')
const showQuickAddCategory = ref(false)
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

// The subcategory dropdown is disabled until a category is chosen, and only
// ever offers subcategories that belong to it (spec: subcategory-requires-category).
const availableSubcategories = computed(() => {
  const cat = categories.categoriesWithSubcategories.value.find(c => c.id === categoryId.value)
  return cat?.subcategories ?? []
})

const categoryOptions = computed(() =>
  categories.categoriesWithSubcategories.value.map(c => ({ label: c.name, value: c.id })),
)

const subcategoryOptions = computed(() => [
  { label: 'بدون فئة فرعية', value: '' },
  ...availableSubcategories.value.map(s => ({ label: s.name, value: s.id })),
])

function onCategoryChange() {
  if (!availableSubcategories.value.some(s => s.id === subcategoryId.value)) {
    subcategoryId.value = ''
  }
}

async function onCategoryCreated(id: string) {
  // CategoryQuickAdd owns its own useCategories() instance (separate reactive
  // state from this form's `categories`), so its create-then-load already
  // refreshed ITS list, not ours — without this reload, the new category is
  // absent from `categoryOptions` and the Select can't resolve the id we're
  // about to assign it.
  await categories.load()
  categoryId.value = id
  delete errors.value['category']
  showQuickAddCategory.value = false
}

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!nameAr.value.trim())   e['name-ar']       = 'هذا الحقل مطلوب'
  if (!categoryId.value)      e['category']      = 'هذا الحقل مطلوب'
  if (costPrice.value === '') e['cost-price']    = 'هذا الحقل مطلوب'
  if (salePrice.value === '') e['sale-price']    = 'هذا الحقل مطلوب'
  if (stock.value === '')     e['current-stock'] = 'هذا الحقل مطلوب'
  // BUG-L01 (/products): threshold previously accepted negative values with no
  // validation at all, unlike every other numeric field on this form.
  if (Number(threshold.value) < 0) e['threshold'] = 'يجب ألا يكون العدد أقل من صفر'
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
      categoryId:        categoryId.value || undefined,
      subcategoryId:     subcategoryId.value || undefined,
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
      nameAr.value = ''; nameEn.value = ''; barcode.value = ''
      categoryId.value = ''; subcategoryId.value = ''
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
  categories.load()
  scanner.onScan((code: string) => { barcode.value = code })
})

// Detach the scanner's global keydown listener on unmount (WAFI-032) — otherwise
// it leaks and double-fires after the form is opened more than once.
onUnmounted(() => {
  scanner.destroy()
})
</script>

<template>
  <div class="form-root" :class="{ 'form-root--embedded': embedded }" dir="rtl">

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

      <!-- Category / Subcategory (moved here from optional details) -->
      <div class="field">
        <label class="field-label">الفئة <span class="required">*</span></label>
        <Select
          v-model="categoryId"
          data-testid="category-select"
          class="form-input select-input"
          :class="{ 'input-error': errors['category'] }"
          :options="categoryOptions"
          option-label="label"
          option-value="value"
          placeholder="اختر فئة"
          @update:model-value="onCategoryChange(); delete errors['category']"
        />
        <p v-if="errors['category']" data-testid="error-category" class="field-error">
          {{ errors['category'] }}
        </p>
        <button
          v-if="!categoryId"
          type="button"
          data-testid="quick-add-category-toggle"
          class="expand-btn"
          @click="showQuickAddCategory = !showQuickAddCategory"
        >
          + فئة جديدة
        </button>
        <CategoryQuickAdd v-if="!categoryId && showQuickAddCategory" @created="onCategoryCreated" />
      </div>

      <div class="field">
        <label class="field-label">الفئة الفرعية <span class="optional">(اختياري)</span></label>
        <Select
          v-model="subcategoryId"
          data-testid="subcategory-select"
          class="form-input select-input"
          :options="subcategoryOptions"
          option-label="label"
          option-value="value"
          :disabled="!categoryId"
        />
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
        <input v-model="stock" data-testid="current-stock" type="number" step="1" min="0"
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

        <!-- Low stock threshold -->
        <div class="field">
          <label class="field-label">حد التنبيه للمخزون</label>
          <input v-model="threshold" data-testid="threshold" type="number" min="0" step="1"
            class="form-input"
            :class="{ 'input-error': errors['threshold'] }"
            @focus="($event.target as HTMLInputElement).style.borderColor = errors['threshold'] ? '#EF4444' : 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = errors['threshold'] ? '#EF4444' : 'rgba(255,255,255,0.18)'"
            @input="delete errors['threshold']" />
          <p v-if="errors['threshold']" class="field-error">{{ errors['threshold'] }}</p>
          <p v-else class="field-hint">إنذار عند الوصول لهذه الكمية (الافتراضي: 5)</p>
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

    <!-- ── Save Bar ──────────────────────────────────────────────────────
         Fixed on a full page; inline when embedded in a modal; teleported
         into the page content (after the audit log) when a target is given. -->
    <Teleport defer :to="props.saveBarTeleportTo" :disabled="!props.saveBarTeleportTo">
      <div class="save-bar" :class="{ 'save-bar--embedded': props.embedded || !!props.saveBarTeleportTo }">
        <div class="save-bar-inner" dir="rtl">
        <button
          type="button"
          data-testid="save-btn"
          :disabled="saving"
          class="btn-primary"
          @click="handleSave(false)"
        >{{ saving ? 'جاري الحفظ...' : 'حفظ' }}</button>

        <button
          v-if="props.mode === 'add'"
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
    </Teleport>

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
  /* Reserve space for the viewport-fixed save bar on the full-page form. */
  padding-bottom: 7rem;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* In a modal the save bar flows inline, so the 7rem reservation would just be
   dead space that forces the modal body to scroll. Drop it. */
.form-root--embedded {
  padding-bottom: 0;
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

/* ── PrimeVue Select, styled to sit inside the same .form-input box ── */
.select-input {
  position: relative;
  display: flex;
  align-items: center;
  padding-inline-end: 2.25rem;
  cursor: pointer;
}

.select-input :deep(.p-select-label) {
  padding: 0;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.select-input :deep(.p-placeholder) {
  color: #3D4F6B;
}

.select-input :deep(.p-select-dropdown) {
  position: absolute;
  inset-inline-end: 0.75rem;
  inset-block: 0;
  margin: auto;
  width: 1rem;
  height: 1rem;
  color: #637285;
}

.select-input.p-disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  /* Dodge the 230px sidebar. The bar is viewport-fixed but lives inside the
     form's hardcoded dir="rtl", so inset-inline-start follows the FORM, not the
     app shell — and lands on the wrong edge when the shell renders LTR. Key the
     offset off the shell's actual direction with physical left/right instead. */
  :global(#app[dir="rtl"]) .save-bar:not(.save-bar--embedded) {
    right: 230px;
    left: 0;
  }
  :global(#app[dir="ltr"]) .save-bar:not(.save-bar--embedded) {
    left: 230px;
    right: 0;
  }
}

/* Embedded in a modal: flow inline at the end of the form, no viewport pinning. */
.save-bar--embedded {
  position: static;
  inset-inline: auto;
  background: transparent;
  margin-top: 0.5rem;
  width: 100%;
  max-width: 100%;
}
@media (min-width: 1024px) {
  .save-bar--embedded { inset-inline-start: auto; }
}

.save-bar--embedded .save-bar-inner {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding-inline: 0;
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
