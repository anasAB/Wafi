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
  <div class="page-root" dir="rtl">
    <AppHeader
      title="المنتجات"
      :show-back="true"
      @back="router.back()"
    />

    <main class="page-main">
      <!-- Toolbar -->
      <div class="toolbar">
        <p class="product-count">{{ products.length }} منتج</p>
        <button
          type="button"
          class="btn-primary hidden lg:flex"
          @click="router.push('/products/add')"
        >
          <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          إضافة منتج
        </button>
      </div>

      <!-- Missed barcode banner -->
      <div v-if="missedBarcode" class="barcode-banner">
        <span class="barcode-banner-text">
          لم يُعثر على الباركود: <span class="barcode-code">{{ missedBarcode }}</span>
        </span>
        <button
          type="button"
          class="barcode-banner-action"
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

    <!-- Mobile FAB -->
    <button
      type="button"
      data-testid="add-fab"
      class="fab lg:hidden"
      @click="router.push('/products/add')"
    >
      <svg class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      إضافة منتج
    </button>

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

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.page-main {
  flex: 1;
  padding: 1rem 1rem 80px;
  width: 100%;
}

@media (min-width: 1024px) {
  .page-main {
    padding: 1.25rem 1.5rem 1.5rem;
  }
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  gap: 0.75rem;
}

.product-count {
  font-size: 0.875rem;
  color: #637285;
}

/* Primary button */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding-inline: 1.5rem;
  height: 44px;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-primary:hover {
  opacity: 0.88;
}

.btn-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

/* Missed barcode banner */
.barcode-banner {
  margin-bottom: 1rem;
  border-radius: 1rem;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.barcode-banner-text {
  font-size: 0.875rem;
  color: #E8EDF5;
}

.barcode-code {
  font-family: monospace;
  color: #60A5FA;
  font-weight: 700;
}

.barcode-banner-action {
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
  padding: 0.375rem 0.75rem;
  border-radius: 0.625rem;
  color: #60A5FA;
  background: rgba(26, 86, 219, 0.15);
  border: 1px solid rgba(26, 86, 219, 0.30);
  cursor: pointer;
  transition: opacity 0.15s;
}

.barcode-banner-action:hover {
  opacity: 0.85;
}

/* Mobile FAB */
.fab {
  position: fixed;
  bottom: 5rem;
  inset-inline-start: 1rem;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding-inline: 1.25rem;
  height: 3rem;
  border-radius: 1rem;
  font-size: 0.875rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  box-shadow: 0 6px 24px rgba(26, 86, 219, 0.50);
  z-index: 20;
  cursor: pointer;
  transition: transform 0.15s, opacity 0.15s;
}

.fab:active {
  transform: scale(0.95);
}
</style>
