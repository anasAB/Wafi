<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductList from './components/ProductList.vue'
import { useProducts } from './composables/useProducts'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppToast from '@/components/ui/AppToast.vue'

const router  = useRouter()
const route   = useRoute()
const { products, load, softDelete } = useProducts()
const scanner = useBarcodeScan()

const filterLowStock = computed(() => route.query.filter === 'low-stock')
const deleteTarget   = ref<string | null>(null)
const toast          = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const missedBarcode  = ref<string | null>(null)

onMounted(() => {
  load()
  scanner.onScan(handleBarcodeScan)
})

function handleBarcodeScan(code: string) {
  const match = products.value.find(p => p.barcode === code)
  if (match) {
    missedBarcode.value = null
  } else {
    missedBarcode.value = code
  }
}

function handleDelete(id: string) {
  deleteTarget.value = id
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  await softDelete(deleteTarget.value)
  deleteTarget.value = null
  toast.value = { message: 'تم حذف المنتج', type: 'success' }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader
      title="المنتجات"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/back-office')"
    />

    <main class="flex-1 px-4 py-4 max-w-2xl mx-auto w-full">
      <!-- "Add with scanned barcode" CTA -->
      <div
        v-if="missedBarcode"
        class="mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-3 flex items-center justify-between"
      >
        <span class="text-sm text-blue-800 dark:text-blue-200">لم يُعثر على: {{ missedBarcode }}</span>
        <button
          type="button"
          class="text-sm font-semibold text-blue-600 dark:text-blue-400 underline"
          @click="router.push(`/products/add?barcode=${encodeURIComponent(missedBarcode!)}`)"
        >إضافة منتج جديد بهذا الباركود</button>
      </div>

      <ProductList
        :products="products"
        :filter-low-stock="filterLowStock"
        @edit="id => router.push(`/products/${id}/edit`)"
        @delete="handleDelete"
      />
    </main>

    <!-- FAB -->
    <button
      type="button"
      data-testid="add-fab"
      class="fixed bottom-6 start-6 w-14 h-14 rounded-full bg-blue-600 text-white text-2xl shadow-lg
             hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center z-20"
      aria-label="إضافة منتج"
      @click="router.push('/products/add')"
    >+</button>

    <AppDialog
      v-if="deleteTarget"
      title="حذف المنتج"
      message="حذف هذا المنتج؟ لن يظهر في القائمة بعد الآن، لكن سجلات البيع السابقة ستبقى."
      confirm-label="حذف"
      cancel-label="إلغاء"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />

    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>
