<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  lastSyncedAt: string | null
  isOnline:     boolean
}>()

const minutesAgo = computed(() => {
  if (!props.lastSyncedAt) return null
  return Math.floor((Date.now() - new Date(props.lastSyncedAt).getTime()) / 60_000)
})

const show = computed(() =>
  !props.isOnline && minutesAgo.value !== null && minutesAgo.value > 30
)
</script>

<template>
  <div
    v-if="show"
    data-testid="staleness-bar"
    class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-gray-500 dark:text-gray-400
           bg-gray-100 dark:bg-gray-800 mb-2"
    dir="rtl"
  >
    <span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
    <span>آخر تحديث منذ {{ minutesAgo }} دقيقة</span>
    <span class="mr-auto opacity-60">بدون إنترنت</span>
  </div>
</template>
