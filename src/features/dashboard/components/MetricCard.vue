<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label:         string
  amountUsd:     number
  syp:           number
  accent:        'blue' | 'orange' | 'green' | 'red' | 'gray'
  warningCount?: number
}>()

const emit = defineEmits<{
  (e: 'warning-tap'): void
  (e: 'tap'):         void
}>()

const accentClass = computed(() => ({
  blue:   'text-blue-600 dark:text-blue-400',
  orange: 'text-orange-500 dark:text-orange-400',
  green:  'text-green-600 dark:text-green-400',
  red:    'text-red-600 dark:text-red-400',
  gray:   'text-gray-500 dark:text-gray-400',
}[props.accent]))

const formattedUsd = computed(() => {
  const abs = Math.abs(props.amountUsd).toFixed(2)
  if (props.amountUsd > 0)  return `+$${abs}`
  if (props.amountUsd < 0)  return `−$${abs}`
  return `$${abs}`
})

const formattedSyp = computed(() =>
  Math.round(props.syp).toLocaleString('en-US')
)

const showWarning = computed(() => (props.warningCount ?? 0) > 0)
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-start justify-between
           cursor-pointer active:scale-[0.98] transition-transform select-none"
    dir="rtl"
    role="button"
    tabindex="0"
    data-testid="metric-card"
    @click="emit('tap')"
    @keydown.enter="emit('tap')"
  >
    <div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ label }}</p>
      <p
        data-testid="amount-usd"
        class="text-2xl font-bold"
        :class="accentClass"
      >{{ formattedUsd }}</p>
      <p
        data-testid="amount-syp"
        class="text-xs text-gray-400 dark:text-gray-500 mt-0.5"
      >{{ formattedSyp }} ل.س</p>
    </div>

    <button
      v-if="showWarning"
      type="button"
      data-testid="warning-badge"
      class="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700
             rounded-lg px-2 py-1 text-xs text-amber-700 dark:text-amber-300 shrink-0"
      @click.stop="emit('warning-tap')"
    >⚠ {{ warningCount }}</button>
  </div>
</template>
