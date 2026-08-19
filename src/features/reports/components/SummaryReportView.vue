<script setup lang="ts">
import type { SummarySection } from '../report.types'
defineProps<{ section: SummarySection }>()
</script>

<template>
  <section class="summary-section" dir="rtl">
    <p class="section-title">{{ section.title }}</p>
    <div class="metrics-grid">
      <div v-for="(m, i) in section.metrics" :key="i" class="metric-row">
        <span class="metric-label">{{ m.label }}</span>
        <span class="metric-value">{{ m.value }}<span v-if="m.unit" class="metric-unit"> {{ m.unit }}</span></span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.summary-section { background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; padding: 0.9rem; margin-bottom: 0.75rem; }
.section-title { font-size: 0.8rem; font-weight: 700; color: #9AA8BE; margin: 0 0 0.5rem; }
.metric-row { display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.85rem; }
.metric-row:last-child { border-bottom: none; }
.metric-label { color: #C8D5E8; }
.metric-value { font-weight: 700; color: #E8EDF5; }
.metric-unit { font-weight: 400; color: #9AA8BE; font-size: 0.75rem; }
</style>
