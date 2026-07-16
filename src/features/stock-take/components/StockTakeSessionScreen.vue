<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'
import { useBarcodeScan } from '@/composables/useBarcodeScan'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const { lines, loadSession, recordCount, progress } = useStockTake()
const currentIndex = ref(0)
const inputValue = ref('')

const remainingLines = computed(() => lines.value.filter(l => l.countedStock === null))
const currentLine = computed(() => remainingLines.value[0] ?? null)

async function submitCount() {
  if (!currentLine.value) return
  const qty = Number(inputValue.value)
  if (!Number.isFinite(qty) || qty < 0) return
  await recordCount(currentLine.value.id, qty)
  inputValue.value = ''
  if (remainingLines.value.length === 0) {
    router.push(`/stock-take/${sessionId}/review`)
  }
}

const { onScan, offScan } = useBarcodeScan()
function handleScan(barcode: string) {
  const match = lines.value.find(l => l.productId === barcode)
  if (match) {
    const idx = remainingLines.value.findIndex(l => l.id === match.id)
    if (idx >= 0) currentIndex.value = idx
  }
}

onMounted(async () => {
  await loadSession(sessionId)
  onScan(handleScan)
})
onUnmounted(() => offScan(handleScan))
</script>

<template>
  <div dir="rtl" class="stock-take-screen">
    <h1>جرد المخزون</h1>
    <p data-testid="stock-take-progress">{{ progress.counted }} من {{ progress.total }}</p>

    <div v-if="currentLine">
      <p>{{ currentLine.productNameAr }}</p>
      <input
        data-testid="stock-take-count-input"
        type="number"
        min="0"
        v-model="inputValue"
      />
      <button data-testid="stock-take-count-submit" @click="submitCount">التالي</button>
    </div>
    <div v-else>
      <p>تم عد جميع المنتجات</p>
    </div>
  </div>
</template>

<style scoped>
.stock-take-screen {
  padding: 1rem;
  font-family: 'Tajawal', sans-serif;
}
</style>
