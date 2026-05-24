<script setup lang="ts">
import type { SyncStatus } from '@/store/sync.store'

defineProps<{ status: SyncStatus; pendingCount?: number }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full">
    <span
      :class="[
        'w-2 h-2 rounded-full',
        status === 'online'  ? 'bg-green-500' :
        status === 'syncing' ? 'bg-yellow-400 animate-pulse' :
                               'bg-red-500',
      ]"
    />
    <span :class="status === 'online' ? 'text-green-700 dark:text-green-400' : status === 'syncing' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'">
      {{ status === 'online' ? 'متصل' : status === 'syncing' ? 'جارٍ المزامنة' : 'غير متصل' }}
    </span>
    <span v-if="(pendingCount ?? 0) > 0" class="text-gray-400">({{ pendingCount }})</span>
  </span>
</template>
