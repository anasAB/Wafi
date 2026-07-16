<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useStockTakeHistory } from '@/features/stock-take/composables/useStockTakeHistory'

const router = useRouter()
const { sessions, load, lastThreeTrendUsd } = useStockTakeHistory()

onMounted(load)
</script>

<template>
  <div dir="rtl" class="stock-take-history">
    <h1>سجل الجرد</h1>
    <p data-testid="stock-take-trend">
      اتجاه العجز (آخر 3 عمليات): {{ lastThreeTrendUsd.toFixed(2) }} $
    </p>
    <div
      v-for="s in sessions"
      :key="s.id"
      data-testid="stock-take-history-row"
      @click="router.push(`/stock-take/${s.id}/review`)"
    >
      {{ s.startedAt }} — {{ s.productsCounted }} منتج —
      <span :class="s.totalShrinkageUsd < 0 ? 'loss' : 'gain'">
        {{ s.totalShrinkageUsd.toFixed(2) }} $
      </span>
    </div>
  </div>
</template>

<style scoped>
.loss { color: #c0392b; }
.gain { color: #27ae60; }
</style>
