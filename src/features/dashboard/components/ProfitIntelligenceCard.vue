<!-- src/features/dashboard/components/ProfitIntelligenceCard.vue -->
<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IntelligenceCard from './IntelligenceCard.vue'
import { useProfitIntelligence } from '../composables/useProfitIntelligence'
import type { InsightPeriod } from '../composables/insightRanges'

const props = defineProps<{ period: InsightPeriod; expanded: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const { data, state, load } = useProfitIntelligence()

async function reload() { await load(props.period) }
defineExpose({ reload })

onMounted(reload)
watch(() => props.period, reload)

const cardState = computed(() => {
  if (state.value !== 'ready') return state.value
  return data.value?.drivers === null ? 'placeholder' : 'ready'
})

const headline = computed(() => {
  if (!data.value) return ''
  const { direction, changePct } = data.value.metric
  const percent = changePct !== null ? Math.abs(changePct).toFixed(0) : '0'
  return t(`dashboard2.profit.headline.${direction}`, { percent })
})

const marginLine = computed(() => {
  if (!data.value || data.value.marginCurrentPct === null || data.value.marginPreviousPct === null) return ''
  const current = data.value.marginCurrentPct
  const previous = data.value.marginPreviousPct
  const pp = current - previous
  return t('dashboard2.profit.margin', {
    current: current.toFixed(0), previous: previous.toFixed(0),
    sign: pp >= 0 ? '+' : '', pp: Math.abs(pp).toFixed(0),
  })
})

function driverLabel(key: string): string {
  return t(`dashboard2.profit.${key}`)
}
</script>

<template>
  <IntelligenceCard :state="cardState" :expanded="expanded" @toggle="emit('toggle')" @retry="reload">
    <template #headline>{{ headline }}</template>
    <template #placeholder>{{ t('dashboard2.placeholder') }}</template>

    <div v-if="data?.drivers">
      <p class="profit-margin-line">{{ marginLine }}</p>
      <ul class="profit-drivers">
        <li v-for="d in data.drivers" :key="d.key" class="profit-driver-row">
          <span class="profit-driver-label">{{ driverLabel(d.key) }}</span>
          <span class="profit-driver-value" dir="ltr">${{ d.previous.toFixed(0) }} → ${{ d.current.toFixed(0) }}</span>
        </li>
      </ul>
    </div>
  </IntelligenceCard>
</template>

<style scoped>
.profit-margin-line { font-size: 12px; color: #9AA8BE; margin: 0 0 10px; }
.profit-drivers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.profit-driver-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.profit-driver-label { color: #9AA8BE; }
.profit-driver-value { color: #E8EDF5; font-weight: 700; }
</style>
