<!-- src/features/dashboard/components/InsightBanner.vue -->
<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAutomaticInsights } from '@/composables/useAutomaticInsights'
import type { InsightPeriod } from '@/features/dashboard/composables/insightRanges'
import type { Insight } from '@/composables/insights/evaluateInsight'

const props = defineProps<{ period: InsightPeriod }>()
const { t, locale } = useI18n()
const { insights, load } = useAutomaticInsights()

// Read via a computed rather than the raw `insights` binding: the composable
// returns a genuine ref in production, but wrapping it here guarantees a
// real Vue ref reaches the template regardless of the exact shape returned
// by a mocked composable in tests (a plain { value } object is not a ref
// and would not be auto-unwrapped by the template compiler).
const insightsList = computed(() => insights.value)

onMounted(() => load(props.period))
watch(() => props.period, (p) => load(p))

// Same weekday name as the comparison date, for the 'day' period's label
// ("last Tuesday"). Comparison is always exactly 7 days back (see
// insightRanges.ts), so today's own weekday name is the correct label.
const comparisonLabel = computed(() => {
  if (props.period === 'day') {
    const weekday = new Intl.DateTimeFormat(locale.value, { weekday: 'long' }).format(new Date())
    return t('insights.comparisonLabel.day', { weekday })
  }
  return t(`insights.comparisonLabel.${props.period}`)
})

function formatUsd(value: number): string {
  return value < 0 ? `-$${Math.abs(value).toFixed(2)}` : `$${value.toFixed(2)}`
}

function primaryLine(insight: Insight): string {
  const label = comparisonLabel.value
  if (insight.metric === 'revenue') {
    if (props.period === 'day' && insight.direction === 'down' && insight.currentUsd === 0) {
      return t('insights.revenue.noSalesToday', { previous: insight.previousUsd.toFixed(2), label })
    }
    const percent = Math.abs(insight.percentChange ?? 0).toFixed(0)
    return t(`insights.revenue.${insight.direction}`, { percent, label })
  }
  // profit
  if (insight.percentChange !== null) {
    const percent = Math.abs(insight.percentChange).toFixed(0)
    return t(`insights.profit.${insight.direction}`, { percent, label })
  }
  const amount = Math.abs(insight.currentUsd - insight.previousUsd).toFixed(2)
  return t(`insights.profit.${insight.direction}`, { amount })
}
</script>

<template>
  <div v-if="insightsList.length > 0" data-test="insight-banner" class="insight-banner">
    <div
      v-for="insight in insightsList"
      :key="insight.metric"
      class="insight-banner__item"
      :class="{
        'insight-banner__item--positive': ['up', 'loss_to_profit', 'loss_narrowed'].includes(insight.direction),
        'insight-banner__item--negative': ['down', 'profit_to_loss', 'loss_widened'].includes(insight.direction),
      }"
    >
      <p class="insight-banner__primary">{{ primaryLine(insight) }}</p>
      <p class="insight-banner__secondary" dir="ltr">
        {{ formatUsd(insight.currentUsd) }} · {{ formatUsd(insight.previousUsd) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Mirrors AnomalyBanner.vue's card styling for a consistent computed-insight
   visual language — plain scoped CSS, not Tailwind, matching that
   component's existing pattern. */
.insight-banner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}
.insight-banner__item {
  border-radius: 8px;
  padding: 10px 14px;
  background: #f5f7fa;
}
.insight-banner__item--positive {
  border-inline-start: 4px solid #16a34a;
}
.insight-banner__item--negative {
  border-inline-start: 4px solid #dc2626;
}
.insight-banner__primary {
  margin: 0;
  font-weight: 600;
}
.insight-banner__secondary {
  margin: 4px 0 0;
  font-size: 0.85em;
  color: #6b7280;
}
</style>
