<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductForm from './components/ProductForm.vue'
import AppToast from '@/components/ui/AppToast.vue'
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
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader
      title="تعديل المنتج"
      :show-back="true"
      @back="router.back()"
    />
    <main class="flex-1 px-4 py-4 max-w-2xl mx-auto w-full">
      <div v-if="!loaded" class="flex justify-center py-20 text-text-muted text-sm">جارٍ التحميل...</div>
      <div v-else-if="!product" class="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
        <p class="text-sm">المنتج غير موجود</p>
        <button type="button" class="text-sm text-gold-primary underline" @click="router.push('/products')">العودة للمنتجات</button>
      </div>
      <ProductForm
        v-else
        mode="edit"
        :product="product"
        @saved="handleSaved"
        @cancel="router.push('/products')"
      />
    </main>
    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>
