<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStockTake } from '@/features/stock-take/composables/useStockTake'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const { loadSession, reviewLines, totalShrinkageValueUsd, confirmSession } = useStockTake()

onMounted(() => loadSession(sessionId))

async function onConfirm() {
  await confirmSession()
  router.push('/stock-take/history')
}
</script>

<template>
  <div dir="rtl" class="stock-take-review">
    <h1>مراجعة الجرد</h1>
    <p data-testid="stock-take-total-shrinkage">
      إجمالي قيمة العجز: {{ totalShrinkageValueUsd.toFixed(2) }} $
    </p>
    <ul>
      <li v-for="line in reviewLines" :key="line.id">
        {{ line.productNameAr }} — الفرق: {{ line.variance }}
        <span v-if="line.varianceValueUsd !== null">({{ line.varianceValueUsd.toFixed(2) }} $)</span>
        <span v-else>(—)</span>
      </li>
    </ul>
    <button data-testid="stock-take-confirm" @click="onConfirm">تأكيد وتطبيق</button>
  </div>
</template>
