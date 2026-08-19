<script setup lang="ts">
import type { DetailSection } from '../report.types'
defineProps<{ section: DetailSection }>()

function cell(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}
</script>

<template>
  <section class="detail-section" dir="rtl">
    <p class="section-title">{{ section.title }}</p>
    <p v-if="section.rows.length === 0" class="empty-state">لا توجد بيانات</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr><th v-for="col in section.columns" :key="col.key">{{ col.label }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in section.rows" :key="i">
            <td v-for="col in section.columns" :key="col.key">{{ cell(row, col.key) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.detail-section { background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; padding: 0.9rem; margin-bottom: 0.75rem; overflow-x: auto; }
.section-title { font-size: 0.8rem; font-weight: 700; color: #9AA8BE; margin: 0 0 0.5rem; }
.empty-state { color: #637285; font-size: 0.8rem; margin: 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
th { text-align: start; padding: 0.4rem; color: #9AA8BE; border-bottom: 1px solid rgba(26,86,219,0.2); }
td { padding: 0.4rem; color: #E8EDF5; border-bottom: 1px solid rgba(255,255,255,0.05); }
</style>
