<script setup lang="ts">
defineProps<{
  cashUsd: number
  cashSyp: number
}>()

const emit = defineEmits<{ (e: 'tap'): void }>()
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-center justify-between
           cursor-pointer active:scale-[0.98] transition-transform"
    dir="rtl"
    data-testid="cash-drawer-bar"
    role="button"
    @click="emit('tap')"
  >
    <div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">النقد المتوقع في الدرج</p>
      <p class="text-sm font-bold text-gray-900 dark:text-white">
        <span v-if="cashUsd !== 0">{{ cashUsd < 0 ? '−' : '' }}${{ Math.abs(cashUsd).toFixed(2) }}</span>
        <span v-if="cashUsd !== 0 && cashSyp !== 0" class="text-gray-400 mx-1">+</span>
        <span v-if="cashSyp !== 0">{{ Math.round(cashSyp).toLocaleString('en-US') }} ل.س</span>
        <span v-if="cashUsd === 0 && cashSyp === 0" class="text-gray-400">$0</span>
      </p>
    </div>
    <span class="text-xl">💰</span>
  </div>
</template>
