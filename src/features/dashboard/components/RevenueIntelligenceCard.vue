<!-- src/features/dashboard/components/RevenueIntelligenceCard.vue -->
<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useRevenueIntelligence } from '../composables/useRevenueIntelligence'
import type { InsightPeriod } from '../composables/insightRanges'

const props = defineProps<{ period: InsightPeriod; expanded: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const router = useRouter()
const { data, state, load } = useRevenueIntelligence()

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
  return t(`dashboard2.revenue.headline.${direction}`, { percent })
})

function driverLabel(key: string): string {
  return t(`dashboard2.revenue.${key}`)
}
</script>

<template>
  <IntelligenceCard
    :state="cardState"
    :expanded="expanded"
    @toggle="emit('toggle')"
    @retry="reload"
  >
    <template #headline>{{ headline }}</template>
    <template #placeholder>{{ t('dashboard2.placeholder') }}</template>

    <ul v-if="data?.drivers" class="rev-drivers">
      <li v-for="d in data.drivers" :key="d.key" class="rev-driver-row">
        <span class="rev-driver-label">{{ driverLabel(d.key) }}</span>
        <span class="rev-driver-value" dir="ltr">{{ d.previous.toFixed(0) }} → {{ d.current.toFixed(0) }}</span>
      </li>
      <li>
        <button type="button" @click="router.push(`/history?period=${props.period}`)" class="rev-action-link">
          {{ t('dashboard2.revenue.viewTransactions') }}
        </button>
      </li>
    </ul>
  </IntelligenceCard>
</template>

<style scoped>
.rev-drivers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rev-driver-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.rev-driver-label { color: #9AA8BE; }
.rev-driver-value { color: #E8EDF5; font-weight: 700; }
.rev-action-link { background: none; border: none; color: #60A5FA; font-size: 12px; text-decoration: none; cursor: pointer; padding: 0; font-family: 'Tajawal', sans-serif; text-align: right; }
</style>
