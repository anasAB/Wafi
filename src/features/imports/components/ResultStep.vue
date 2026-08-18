<script setup lang="ts">
import { computed } from 'vue'
import type { ImportResult, RowStatusKind } from '../import.types'

const props = defineProps<{ result: ImportResult }>()
const emit = defineEmits<{ downloadErrors: [] }>()
const hasProblems = computed(() => props.result.skipped + props.result.errored > 0)
const problemRows = computed(() => props.result.statuses.filter((s) => s.kind !== 'import'))

function statusLabel(kind: RowStatusKind) {
  return kind === 'skip' ? 'تم التخطي' : 'خطأ'
}
</script>

<template>
  <div class="result-step" dir="rtl">
    <p class="result-line">
      تم استيراد <strong>{{ result.inserted }}</strong> منتج ·
      {{ result.skipped }} تم تخطيها ·
      {{ result.errored }} أخطاء
    </p>
    <button v-if="hasProblems" type="button" class="errors-btn" @click="emit('downloadErrors')">
      تنزيل صفوف الأخطاء
    </button>

    <div v-if="hasProblems" class="problems-wrap">
      <p class="problems-title">تفاصيل الصفوف التي تحتاج مراجعة</p>
      <table class="problems-table">
        <thead>
          <tr>
            <th>رقم الصف</th>
            <th>الاسم</th>
            <th>الحالة</th>
            <th>السبب</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in problemRows" :key="`${s.kind}-${s.index}`">
            <td>{{ s.index }}</td>
            <td>{{ s.row.nameAr || '—' }}</td>
            <td>
              <span :class="['status-pill', `status-pill--${s.kind}`]">
                {{ statusLabel(s.kind) }}
              </span>
            </td>
            <td>{{ s.reason || (s.flags.includes('no-cost') ? 'بدون تكلفة' : '—') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <router-link to="/products" class="back-link">العودة إلى المنتجات</router-link>
  </div>
</template>

<style scoped>
.result-step {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.result-line { font-size: 14px; color: #E8EDF5; margin: 0; }
.errors-btn {
  align-self: flex-start;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(26,86,219,0.24);
  color: #C8D5E8;
  border-radius: 10px;
  padding: 10px 18px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
}

.problems-wrap {
  border: 1px solid rgba(26,86,219,0.18);
  border-radius: 12px;
  overflow: hidden;
}

.problems-title {
  margin: 0;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 700;
  color: #C8D5E8;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid rgba(26,86,219,0.14);
}

.problems-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  color: #C8D5E8;
}

.problems-table th {
  padding: 8px 10px;
  text-align: start;
  font-weight: 700;
  border-bottom: 1px solid rgba(26,86,219,0.14);
  background: #0D1828;
}

.problems-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  border-radius: 999px;
  padding: 2px 8px;
  font-weight: 700;
}

.status-pill--skip {
  background: rgba(251,191,36,0.15);
  color: #FBBF24;
}

.status-pill--error {
  background: rgba(252,165,165,0.15);
  color: #FCA5A5;
}

.back-link {
  align-self: flex-start;
  color: #60A5FA;
  text-decoration: underline;
  font-size: 13px;
}
</style>
