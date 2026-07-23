<script setup lang="ts">
import { computed } from 'vue'
import type { ImportResult } from '../import.types'

const props = defineProps<{ result: ImportResult }>()
const emit = defineEmits<{ downloadErrors: [] }>()
const hasProblems = computed(() => props.result.skipped + props.result.errored > 0)
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
.back-link {
  align-self: flex-start;
  color: #60A5FA;
  text-decoration: underline;
  font-size: 13px;
}
</style>
