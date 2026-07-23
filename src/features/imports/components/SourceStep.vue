<script setup lang="ts">
import { ref } from 'vue'
import { parseFile, downloadTemplate } from '../composables/useImportParse'

const emit = defineEmits<{ parsed: [{ headers: string[]; rawRows: Record<string, unknown>[] }] }>()
const error = ref<string | null>(null)

async function handleFile(file: File) {
  error.value = null
  try {
    emit('parsed', await parseFile(file))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'تعذّرت قراءة الملف'
  }
}

function onInput(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) handleFile(f)
}

defineExpose({ handleFile })
</script>

<template>
  <div class="source-step" dir="rtl">
    <p class="hint">اختر ملف Excel أو CSV يحتوي على المنتجات لاستيرادها.</p>
    <button type="button" class="template-link" @click="downloadTemplate">تنزيل قالب Excel</button>
    <label class="file-drop">
      <input type="file" accept=".xlsx,.csv" @change="onInput" />
      <span>اضغط لاختيار ملف</span>
    </label>
    <p v-if="error" class="error-note">{{ error }}</p>
  </div>
</template>

<style scoped>
.source-step {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.hint { font-size: 13px; color: #637285; margin: 0; }
.template-link {
  align-self: flex-start;
  background: none;
  border: none;
  color: #60A5FA;
  text-decoration: underline;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
}
.file-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  border: 2px dashed rgba(26,86,219,0.30);
  border-radius: 14px;
  color: #AFC0D8;
  font-size: 14px;
  cursor: pointer;
}
.file-drop:hover { border-color: rgba(26,86,219,0.55); }
.file-drop input { display: none; }
.error-note {
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 0.625rem;
  padding: 0.5rem 0.875rem;
  font-size: 13px;
  margin: 0;
}
</style>
