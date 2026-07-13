<!-- Cumulative profit trend: area chart where each point is the running sum of
     bucket profit. This keeps one profit engine and only changes the view shape. -->
<script setup lang="ts">
import { computed } from 'vue'
import VueApexCharts from 'vue3-apexcharts'
import type { ApexOptions } from 'apexcharts'
import type { ProfitTrendPoint } from '../composables/useProfitTrend'

const props = defineProps<{ points: ProfitTrendPoint[]; selectedIndex?: number | null }>()
const emit = defineEmits<{ (e: 'point-select', index: number): void }>()

function emitPointSelect(index: unknown) {
  if (typeof index === 'number' && index >= 0) {
    emit('point-select', index)
  }
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function formatUsd(value: number): string {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}`
}

function formatUsdAxisCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }

  return `${sign}$${Math.round(abs)}`
}

function bucketKeyToEpochMs(bucketKey: string | undefined, fallbackIndex: number): number {
  if (!bucketKey) return fallbackIndex

  if (/^\d{4}-\d{2}-\d{2}$/.test(bucketKey)) {
    return new Date(`${bucketKey}T00:00:00`).getTime()
  }

  if (/^\d{4}-\d{2}$/.test(bucketKey)) {
    return new Date(`${bucketKey}-01T00:00:00`).getTime()
  }

  return fallbackIndex
}

const cumulativeSeries = computed(() => {
  let running = 0
  return props.points.map((point) => {
    running += safeNumber(point.profitUsd)
    return running
  })
})

const hasNegative = computed(() => cumulativeSeries.value.some((v) => v < 0))

const series = computed(() => [{
  name: 'الربح التراكمي',
  data: props.points.map((point, index) => ({
    x: bucketKeyToEpochMs(point.bucketKey, index),
    y: cumulativeSeries.value[index] ?? 0,
  })),
}])
const selectedMarker = computed(() => {
  if (props.selectedIndex === null || props.selectedIndex === undefined) return []
  if (props.selectedIndex < 0 || props.selectedIndex >= props.points.length) return []
  return [
    {
      seriesIndex: 0,
      dataPointIndex: props.selectedIndex,
      fillColor: '#FCD34D',
      strokeColor: '#0B1220',
      size: 7,
      shape: 'circle' as const,
    },
  ]
})

const options = computed<ApexOptions>(() => ({
  chart: {
    type: 'area',
    background: 'transparent',
    toolbar: { show: false },
    fontFamily: 'Tajawal, system-ui, sans-serif',
    events: {
      dataPointSelection: (_event, _ctx, config) => {
        emitPointSelect(config?.dataPointIndex)
      },
      markerClick: (_event, _ctx, config) => {
        emitPointSelect(config?.dataPointIndex)
      },
      click: (_event, _ctx, config) => {
        emitPointSelect(config?.dataPointIndex)
      },
    },
  },
  stroke: {
    curve: 'smooth',
    width: 3,
    colors: ['#1A56DB'],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.38,
      opacityTo: 0.06,
      stops: [0, 100],
      colorStops: [
        [
          { offset: 0, color: '#1A56DB', opacity: 0.42 },
          { offset: 100, color: '#1A56DB', opacity: 0.06 },
        ],
      ],
    },
  },
  markers: {
    size: 4,
    strokeWidth: 2,
    strokeColors: '#0B1220',
    colors: ['#60A5FA'],
    hover: { size: 6 },
    discrete: selectedMarker.value,
  },
  dataLabels: { enabled: false },
  xaxis: {
    type: 'datetime',
    labels: {
      style: { colors: '#637285' },
      datetimeUTC: false,
      format: 'dd/M',
    },
  },
  yaxis: {
    min: hasNegative.value ? undefined : 0,
    labels: {
      style: { colors: '#637285' },
      formatter: (v) => formatUsdAxisCompact(v),
    },
  },
  annotations: {
    yaxis: [{
      y: 0,
      borderColor: 'rgba(255,255,255,0.16)',
      strokeDashArray: 4,
    }],
  },
  tooltip: {
    theme: 'dark',
    custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
      const point = props.points[dataPointIndex]
      const dailyProfit = point ? safeNumber(point.profitUsd) : 0
      const cumulativeProfit = safeNumber(cumulativeSeries.value[dataPointIndex] ?? 0)
      const dayLabel = point?.bucketKey ?? point?.label ?? ''

      return `<div style="padding:8px 10px;direction:rtl;text-align:right;font-family:Tajawal,system-ui,sans-serif;">
        <div style="font-size:12px;color:#93A3B8;margin-bottom:4px;">${dayLabel}</div>
        <div style="font-size:12px;color:#E8EDF5;">الإجمالي التراكمي: <b>${formatUsd(cumulativeProfit)}</b></div>
        <div style="font-size:12px;color:#E8EDF5;">ربح اليوم: <b>${formatUsd(dailyProfit)}</b></div>
      </div>`
    },
  },
  grid: { borderColor: 'rgba(255,255,255,0.06)' },
}))
</script>

<template>
  <VueApexCharts type="area" :height="180" :series="series" :options="options" />
</template>
