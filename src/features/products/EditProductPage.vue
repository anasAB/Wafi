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
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader
      title="تعديل المنتج"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/products')"
    />
    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
      <div v-if="!loaded" class="flex justify-center py-20 text-gray-400">جارٍ التحميل...</div>
      <div v-else-if="!product" class="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
        <span class="text-3xl">📦</span>
        <p class="text-sm">المنتج غير موجود</p>
        <button type="button" class="text-sm text-blue-600 underline" @click="router.push('/products')">العودة للمنتجات</button>
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
