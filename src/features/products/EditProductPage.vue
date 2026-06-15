<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductForm from './components/ProductForm.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AuditHistory from '@/features/audit/components/AuditHistory.vue'
import { useProducts } from './composables/useProducts'
import type { Product } from '@/features/pos/pos.types'

const router = useRouter()
const route  = useRoute()
const { products, load } = useProducts()
const product = ref<Product | undefined>(undefined)
const toast   = ref<{ message: string; type: 'success' } | null>(null)
const loaded  = ref(false)

onMounted(async () => {
  await load()
  product.value = products.value.find(p => p.id === (route.params.id as string))
  loaded.value = true
})

function handleSaved() {
  toast.value = { message: 'تم حفظ التغييرات', type: 'success' }
  setTimeout(() => router.push('/products'), 800)
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader
      title="تعديل المنتج"
      :show-back="true"
      @back="router.back()"
    />
    <main class="page-main">
      <div v-if="!loaded" class="state-loading">جارٍ التحميل...</div>
      <div v-else-if="!product" class="state-empty">
        <svg xmlns="http://www.w3.org/2000/svg" class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
        <p class="empty-text">المنتج غير موجود</p>
        <button type="button" class="empty-back-btn" @click="router.push('/products')">العودة للمنتجات</button>
      </div>
      <ProductForm
        v-else
        mode="edit"
        :product="product"
        @saved="handleSaved"
        @cancel="router.push('/products')"
      />
      <AuditHistory
        v-if="product"
        entity-type="product"
        :entity-id="route.params.id as string"
      />
    </main>
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
  /* The fixed save bar overlaps the bottom of the page. ProductForm reserves
     this space on the add page, but here AuditHistory follows the form, so the
     clearance belongs to the page instead — otherwise the log sits under the bar. */
  padding: 1rem 1rem 7rem;
  width: 100%;
  max-width: 42rem;
  margin-inline: auto;
}

@media (min-width: 1024px) {
  .page-main {
    padding: 1.25rem 1.5rem 7rem;
    max-width: 48rem;
  }
}

/* The form's own bottom reservation would otherwise leave a large empty gap
   between it and the activity log; the page now provides the bar clearance. */
:deep(.form-root) {
  padding-bottom: 1rem;
}

/* Loading state */
.state-loading {
  display: flex;
  justify-content: center;
  padding-top: 5rem;
  padding-bottom: 5rem;
  font-size: 0.875rem;
  color: #637285;
}

/* Empty state */
.state-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 5rem;
  padding-bottom: 5rem;
  gap: 0.75rem;
  text-align: center;
}

.empty-icon {
  width: 2.5rem;
  height: 2.5rem;
  color: #637285;
  opacity: 0.30;
}

.empty-text {
  font-size: 0.875rem;
  color: #637285;
}

.empty-back-btn {
  font-size: 0.875rem;
  color: #60A5FA;
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  transition: opacity 0.15s;
}

.empty-back-btn:hover {
  opacity: 0.80;
}
</style>
