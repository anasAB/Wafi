<script setup lang="ts">
import type { DetailSection, ReportColumn } from '../report.types'
defineProps<{ section: DetailSection }>()

function cell(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

/** Presentation-only formatting -- row values themselves stay raw (see
 *  ReportColumn's doc comment in report.types.ts). Keeps the UI generic:
 *  one small switch here, not per-report formatting logic. */
function formatCell(row: object, col: ReportColumn): string {
  const value = cell(row, col.key)
  if (value === null || value === undefined) return ''
  switch (col.format) {
    case 'currency-usd':
      return Number(value).toFixed(2)
    case 'percent':
      return `${Number(value).toFixed(1)}%`
    case 'date':
      return String(value).slice(0, 10)
    default:
      return String(value)
  }
}

function cellStyle(col: ReportColumn): Record<string, string> {
  return col.align ? { textAlign: col.align === 'start' ? 'start' : col.align === 'end' ? 'end' : 'center' } : {}
}
</script>

<template>
  <section class="detail-section" dir="rtl">
    <p class="section-title">{{ section.title }}</p>
    <p v-if="section.rows.length === 0" class="empty-state">لا توجد بيانات</p>
    <template v-else>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th v-for="col in section.columns" :key="col.key" :style="cellStyle(col)">{{ col.label }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in section.rows" :key="i">
              <td v-for="col in section.columns" :key="col.key" :style="cellStyle(col)">{{ formatCell(row, col) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="section.truncated" class="truncated-notice" data-testid="truncated-notice">تم عرض أول ٥٠٠ نتيجة فقط</p>
    </template>
  </section>
</template>

<style scoped>
.detail-section { background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04)); border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; padding: 0.9rem; margin-bottom: 0.75rem; overflow-x: auto; }
.section-title { font-size: 0.8rem; font-weight: 700; color: #9AA8BE; margin: 0 0 0.5rem; }
.empty-state { color: #637285; font-size: 0.8rem; margin: 0; }
.truncated-notice { color: #9AA8BE; font-size: 0.72rem; margin: 0.5rem 0 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
th { text-align: start; padding: 0.4rem; color: #9AA8BE; border-bottom: 1px solid rgba(26,86,219,0.2); }
td { padding: 0.4rem; color: #E8EDF5; border-bottom: 1px solid rgba(255,255,255,0.05); }
</style>
