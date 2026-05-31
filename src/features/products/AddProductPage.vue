<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ProductForm from './components/ProductForm.vue'
import AppToast from '@/components/ui/AppToast.vue'
import { ref, computed } from 'vue'

const router = useRouter()
const route  = useRoute()
const toast  = ref<{ message: string; type: 'success' } | null>(null)

const initialBarcode = computed(() => route.query.barcode as string | undefined)

function handleSaved() {
  toast.value = { message: 'تم حفظ المنتج', type: 'success' }
  setTimeout(() => router.push('/products'), 800)
}
</script>

<template>
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader
      title="إضافة منتج"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/products')"
    />
    <main class="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
      <ProductForm
        mode="add"
        :initial-barcode="initialBarcode"
        @saved="handleSaved"
        @cancel="router.push('/products')"
      />
    </main>
    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>
