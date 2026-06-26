<script setup lang="ts">
import { computed } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import type { ApexOptions } from 'apexcharts'
import type { ExpenseBreakdownSlice } from '../composables/useExpenseBreakdown'

const props = defineProps<{
  slices: ExpenseBreakdownSlice[]
  totalUsd: number
}>()

const emit = defineEmits<{ (e: 'category-select', category: string): void }>()

const series = computed(() => props.slices.map((slice) => slice.totalUsd))
const labels = computed(() => props.slices.map((slice) => slice.category))

const options = computed<ApexOptions>(() => ({
  chart: {
    type: 'donut',
    background: 'transparent',
    toolbar: { show: false },
    fontFamily: 'Tajawal, system-ui, sans-serif',
    events: {
      dataPointSelection: (_event, _ctx, config) => {
        const index = config?.dataPointIndex
        if (typeof index !== 'number' || index < 0) return
        const category = props.slices[index]?.category
        if (category) emit('category-select', category)
      },
    },
  },
  labels: labels.value,
  legend: {
    position: 'bottom',
    labels: { colors: '#C8D5E8' },
  },
  stroke: {
    width: 2,
    colors: ['#0B1220'],
  },
  plotOptions: {
    pie: {
      donut: {
        size: '68%',
        labels: {
          show: true,
          name: { show: true, color: '#93A3B8' },
          value: {
            show: true,
            color: '#E8EDF5',
            formatter: (value) => `$${Number(value).toFixed(2)}`,
          },
          total: {
            show: true,
            label: 'الإجمالي',
            color: '#93A3B8',
            formatter: () => `$${props.totalUsd.toFixed(2)}`,
          },
        },
      },
    },
  },
  tooltip: {
    theme: 'dark',
    y: { formatter: (value) => `$${value.toFixed(2)}` },
  },
  dataLabels: { enabled: false },
  colors: ['#1A56DB', '#2563EB', '#3B82F6', '#60A5FA', '#0EA5E9', '#14B8A6', '#38BDF8', '#93C5FD'],
}))
</script>

<template>
  <VueApexCharts type="donut" :height="260" :series="series" :options="options" />
</template>
