<!-- src/features/dashboard/components/StaffIntelligenceCard.vue -->
<!-- WAFI-146: Staff Intelligence Card — top performer + highest discount rate.
     Wraps IntelligenceCard with useStaffIntelligence composable. No permission
     check here — Dashboard2Screen.vue decides whether to render at all. -->
<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useStaffIntelligence } from '../composables/useStaffIntelligence'
import type { InsightPeriod } from '../composables/insightRanges'

const props = defineProps<{ period: InsightPeriod; expanded: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const router = useRouter()
const { data, state, load } = useStaffIntelligence()

async function reload() {
  await load(props.period)
}
defineExpose({ reload })

onMounted(reload)
watch(() => props.period, reload)

const topPerformerLine = computed(() =>
  data.value?.topPerformer
    ? t('dashboard2.staff.topPerformer', {
        name: data.value.topPerformer.name,
        revenue: data.value.topPerformer.revenueUsd.toFixed(0),
      })
    : ''
)

const highestDiscountLine = computed(() =>
  data.value?.highestDiscountRate && data.value.shopAverageDiscountRatePct !== null
    ? t('dashboard2.staff.highestDiscountRate', {
        name: data.value.highestDiscountRate.name,
        rate: data.value.highestDiscountRate.discountRatePct.toFixed(1),
        shopAverage: data.value.shopAverageDiscountRatePct.toFixed(1),
      })
    : ''
)
</script>

<template>
  <IntelligenceCard :state="state" :expanded="expanded" @toggle="emit('toggle')" @retry="reload">
    <template #headline>{{ topPerformerLine }}</template>

    <div v-if="data">
      <p v-if="highestDiscountLine" class="staff-discount-line">{{ highestDiscountLine }}</p>
      <button
        v-if="data.topPerformer"
        type="button"
        class="staff-action-link"
        @click="router.push('/reports/staff')"
      >
        {{ t('dashboard2.staff.viewPerformance', { name: data.topPerformer.name }) }}
      </button>
    </div>
  </IntelligenceCard>
</template>

<style scoped>
.staff-discount-line {
  font-size: 12px;
  color: #9aa8be;
  margin: 0 0 10px;
}

.staff-action-link {
  border: none;
  background: transparent;
  color: #60a5fa;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.staff-action-link:hover {
  text-decoration: underline;
}
</style>