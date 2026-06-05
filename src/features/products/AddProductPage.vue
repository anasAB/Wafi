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
  <div class="page-root" dir="rtl">
    <AppHeader
      title="إضافة منتج"
      :show-back="true"
      @back="router.back()"
    />
    <main class="page-main">
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
  padding: 1rem;
  width: 100%;
  max-width: 42rem;
  margin-inline: auto;
}

@media (min-width: 1024px) {
  .page-main {
    padding: 1.25rem 1.5rem;
    max-width: 48rem;
  }
}
</style>
