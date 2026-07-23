<script setup lang="ts">
import { computed } from 'vue'
import type { RowStatus } from '../import.types'

const props = defineProps<{ statuses: RowStatus[]; needsRate: boolean }>()
const emit = defineEmits<{ commit: [] }>()

const counts = computed(() => ({
  importN: props.statuses.filter((s) => s.kind === 'import').length,
  skip:    props.statuses.filter((s) => s.kind === 'skip').length,
  error:   props.statuses.filter((s) => s.kind === 'error').length,
}))
const canCommit = computed(() => counts.value.importN > 0 && !props.needsRate)

defineExpose({ canCommit })
</script>

<template>
  <div class="preview-step" dir="rtl">
    <p class="summary-line">
      <span class="count-import">{{ counts.importN }} للاستيراد</span> ·
      <span class="count-skip">{{ counts.skip }} تم تخطيها</span> ·
      <span class="count-error">{{ counts.error }} أخطاء</span>
    </p>
    <p v-if="needsRate" class="rate-warning">حدّد سعر صرف الدولار قبل استيراد أسعار بالليرة.</p>

    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead>
          <tr><th>#</th><th>الاسم</th><th>الحالة</th><th>السبب</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in statuses" :key="s.index">
            <td>{{ s.index }}</td>
            <td>{{ s.row.nameAr || '—' }}</td>
            <td>
              <span :class="['status-badge', `status-badge--${s.kind}`]">
                {{ s.kind === 'import' ? '✓' : s.kind === 'skip' ? '⏭' : '✗' }}
              </span>
            </td>
            <td>{{ s.reason ?? (s.flags.includes('no-cost') ? 'بدون تكلفة' : '') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <button type="button" class="commit-btn" :disabled="!canCommit" @click="emit('commit')">استيراد</button>
  </div>
</template>

<style scoped>
.preview-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.summary-line { font-size: 13px; color: #C8D5E8; margin: 0; }
.count-import { color: #22C55E; font-weight: 700; }
.count-skip { color: #FBBF24; font-weight: 700; }
.count-error { color: #FCA5A5; font-weight: 700; }
.rate-warning {
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 0.625rem;
  padding: 0.5rem 0.875rem;
  font-size: 13px;
  margin: 0;
}
.preview-table-wrap {
  max-height: 320px;
  overflow: auto;
  border: 1px solid rgba(26,86,219,0.14);
  border-radius: 12px;
}
.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  color: #C8D5E8;
}
.preview-table th {
  position: sticky;
  top: 0;
  background: #0D1828;
  padding: 8px 10px;
  text-align: start;
  font-weight: 700;
  border-bottom: 1px solid rgba(26,86,219,0.14);
}
.preview-table td {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.status-badge--import { color: #22C55E; }
.status-badge--skip { color: #FBBF24; }
.status-badge--error { color: #FCA5A5; }
.commit-btn {
  align-self: flex-start;
  background: #1A56DB;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}
.commit-btn:disabled {
  background: rgba(255,255,255,0.06);
  color: #637285;
  cursor: not-allowed;
}
</style>
