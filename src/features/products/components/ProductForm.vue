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

// Form fields
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

// margin = markup over cost: ((sale - cost) / cost) * 100
const margin = computed(() => {
  const cost = Number(costPrice.value)
  const sale = Number(salePrice.value)
  if (!cost || !sale || cost <= 0 || sale <= 0) return null
  return Math.round(((sale - cost) / cost) * 100)
})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!nameAr.value.trim())           e['name-ar']       = 'هذا الحقل مطلوب'
  if (costPrice.value === '')         e['cost-price']    = 'هذا الحقل مطلوب'
  if (salePrice.value === '')         e['sale-price']    = 'هذا الحقل مطلوب'
  if (stock.value === '')             e['current-stock'] = 'هذا الحقل مطلوب'
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
  <div class="flex flex-col gap-6 pb-24" dir="rtl">

    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">المعلومات الأساسية</p>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الاسم بالعربي *</label>
        <input
          v-model="nameAr"
          data-testid="name-ar"
          type="text"
          class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          :class="errors['name-ar'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
          placeholder="مثال: شاشة سامسونج 55 بوصة"
          @input="delete errors['name-ar']"
        />
        <p v-if="errors['name-ar']" data-testid="error-name-ar" class="text-xs text-red-500 mt-1">
          {{ errors['name-ar'] }}
        </p>
      </div>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الاسم بالإنجليزي</label>
        <input v-model="nameEn" data-testid="name-en" type="text"
          class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="اختياري" />
      </div>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الباركود</label>
        <input v-model="barcode" data-testid="barcode" type="text"
          class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="اختياري" />
      </div>

      <div>
        <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الفئة</label>
        <input v-model="category" data-testid="category" type="text"
          class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="اختياري" />
      </div>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">التسعير</p>

      <div v-if="priceWarning" data-testid="price-warning"
        class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 rounded-xl px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
        سعر البيع أقل من سعر التكلفة — هل أنت متأكد؟
        <div class="flex gap-2 mt-2">
          <button type="button" class="text-xs font-semibold underline" data-testid="confirm-price-warning"
            @click="priceWarning = false; commitSave(Number(stock.value))">نعم، احفظ</button>
          <button type="button" class="text-xs" @click="priceWarning = false">لا، تراجع</button>
        </div>
      </div>

      <div class="flex gap-3">
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">سعر التكلفة $ *</label>
          <input v-model="costPrice" data-testid="cost-price" type="number" min="0" step="0.01"
            class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            :class="errors['cost-price'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
            @input="delete errors['cost-price']" />
          <p v-if="errors['cost-price']" class="text-xs text-red-500 mt-1">{{ errors['cost-price'] }}</p>
        </div>
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">سعر البيع $ *</label>
          <input v-model="salePrice" data-testid="sale-price" type="number" min="0" step="0.01"
            class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            :class="errors['sale-price'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
            @input="delete errors['sale-price']" />
          <p v-if="errors['sale-price']" class="text-xs text-red-500 mt-1">{{ errors['sale-price'] }}</p>
        </div>
      </div>

      <p v-if="margin !== null" data-testid="margin-display"
        class="text-xs font-medium"
        :class="margin >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'">
        هامش الربح على التكلفة: {{ margin }}%
      </p>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide">المخزون</p>
      <div class="flex gap-3">
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">الكمية الحالية *</label>
          <input v-model="stock" data-testid="current-stock" type="number" step="1"
            class="w-full border rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            :class="errors['current-stock'] ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'"
            @input="delete errors['current-stock']" />
          <p v-if="errors['current-stock']" class="text-xs text-red-500 mt-1">{{ errors['current-stock'] }}</p>
        </div>
        <div class="flex-1">
          <label class="block text-sm text-gray-700 dark:text-gray-300 mb-1">حد التنبيه</label>
          <input v-model="threshold" data-testid="threshold" type="number" min="0" step="1"
            class="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    </div>

    <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">الصورة</p>
      <p v-if="photoError" class="text-xs text-red-500 mb-2">{{ photoError }}</p>
      <ProductPhotoUpload
        :model-value="photoUrl"
        @change="photoUrl = $event"
        @error="photoError = $event"
      />
    </div>

    <div class="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex gap-3" dir="rtl">
      <button
        type="button"
        data-testid="save-btn"
        :disabled="saving"
        class="flex-1 h-12 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
        @click="handleSave(false)"
      >{{ saving ? '...' : 'حفظ' }}</button>

      <button
        v-if="mode === 'add'"
        type="button"
        data-testid="save-another-btn"
        :disabled="saving"
        class="h-12 px-4 rounded-xl text-sm text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600"
        @click="handleSave(true)"
      >إضافة آخر</button>

      <button
        type="button"
        data-testid="cancel-btn"
        class="h-12 px-4 rounded-xl text-sm text-gray-600 dark:text-gray-400"
        @click="emit('cancel')"
      >إلغاء</button>
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
