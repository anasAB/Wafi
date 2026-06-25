<!-- Profit trend: one bar per bucket (day or month), colored by sign — loss red,
     profit green. Presentational: takes the points from useProfitTrend. -->
<script setup lang="ts">
import { computed } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import type { ProfitTrendPoint } from '../composables/useProfitTrend'

const props = defineProps<{ points: ProfitTrendPoint[] }>()

const series = computed(() => [{ name: 'الربح', data: props.points.map(p => p.profitUsd) }])

const options = computed(() => ({
  chart: { type: 'bar', background: 'transparent', toolbar: { show: false }, fontFamily: 'Tajawal, system-ui, sans-serif' },
  plotOptions: {
    bar: {
      borderRadius: 4,
      // Color each bar by value sign: loss = red, profit = green.
      colors: { ranges: [
        { from: -1e12, to: 0,    color: '#EF4444' },
        { from: 0,     to: 1e12, color: '#22C55E' },
      ] },
    },
  },
  dataLabels: { enabled: false },
  xaxis: { categories: props.points.map(p => p.label), labels: { style: { colors: '#637285' } } },
  yaxis: { labels: { style: { colors: '#637285' } } },
  tooltip: { theme: 'dark', y: { formatter: (v: number) => `$${v.toFixed(2)}` } },
  grid: { borderColor: 'rgba(255,255,255,0.06)' },
}))
</script>

<template>
  <VueApexCharts type="bar" :height="180" :series="series" :options="options" />
</template>
