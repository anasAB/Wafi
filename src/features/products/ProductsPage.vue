<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue'
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

onUnmounted(() => {
  scanner.offScan(handleBarcodeScan)
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
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader
      title="المنتجات"
      :show-back="true"
      @back="router.back()"
    />

    <main class="flex-1 px-4 py-4 max-w-5xl mx-auto w-full pb-24 lg:pb-6">
      <!-- Desktop toolbar -->
      <div class="hidden lg:flex items-center justify-between mb-5">
        <p class="text-sm text-text-muted">{{ products.length }} منتج</p>
        <button
          type="button"
          class="btn-gold px-5 h-10 text-sm"
          @click="router.push('/products/add')"
        >+ إضافة منتج</button>
      </div>

      <!-- Missed barcode banner -->
      <div
        v-if="missedBarcode"
        class="mb-4 glass-sm px-4 py-3 flex items-center justify-between"
        style="border-color: var(--color-border-gold)"
      >
        <span class="text-sm text-text-primary">لم يُعثر على: <span class="text-gold-primary font-mono">{{ missedBarcode }}</span></span>
        <button
          type="button"
          class="text-sm font-semibold text-gold-primary underline"
          @click="router.push(`/products/add?barcode=${encodeURIComponent(missedBarcode!)}`)"
        >إضافة بهذا الباركود</button>
      </div>

      <ProductList
        :products="products"
        :filter-low-stock="filterLowStock"
        @edit="id => router.push(`/products/${id}/edit`)"
        @delete="handleDelete"
      />
    </main>

    <!-- Mobile FAB (hidden on lg+) -->
    <button
      type="button"
      data-testid="add-fab"
      class="lg:hidden fixed bottom-20 start-6 w-14 h-14 rounded-full text-bg-void text-2xl shadow-lg
             active:scale-95 transition-all flex items-center justify-center z-20"
      style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to)); box-shadow: 0 0 24px var(--color-gold-subtle)"
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
