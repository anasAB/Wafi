<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import SourceStep from './components/SourceStep.vue'
import { autoDetectMapping } from './composables/useColumnMapping'
import type { FieldMapping, RowStatus } from './import.types'

const router = useRouter()
const step = ref(1)
const headers = ref<string[]>([])
const rawRows = ref<Record<string, unknown>[]>([])
const mapping = ref<FieldMapping | null>(null)
const statuses = ref<RowStatus[]>([])

function onParsed(p: { headers: string[]; rawRows: Record<string, unknown>[] }) {
  headers.value = p.headers
  rawRows.value = p.rawRows
  mapping.value = autoDetectMapping(p.headers)
  step.value = 2
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="استيراد المنتجات من Excel" :show-back="true" @back="router.back()" />
    <main class="wizard-body">
      <SourceStep v-if="step === 1" @parsed="onParsed" />
      <!-- MappingStep (step 2), PreviewStep (step 3), ResultStep (step 4) wired in Tasks 9–10 -->
    </main>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.wizard-body { padding: 16px; }
</style>
