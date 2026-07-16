<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'

const router = useRouter()
const { startSession } = useStockTake()
const scope = ref<string | null>(null)

async function start() {
  const sessionId = await startSession(scope.value)
  router.push(`/stock-take/${sessionId}`)
}
</script>

<template>
  <div dir="rtl" class="stock-take-start">
    <h1>بدء جرد جديد</h1>
    <input v-model="scope" placeholder="فئة محددة (اختياري)" data-testid="stock-take-scope-input" />
    <button data-testid="stock-take-start-button" @click="start">ابدأ</button>
    <button @click="router.push('/stock-take/history')">سجل الجرد السابق</button>
  </div>
</template>
