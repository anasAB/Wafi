<script setup lang="ts">
import { computed } from 'vue'
import type { SyncStatus } from '@/store/sync.store'

const props = defineProps<{ status: SyncStatus; pendingCount?: number; blockedCount?: number }>()

// Explain the indicator on hover — offline is a supported state here, not an
// error, so the tooltip reassures rather than alarms (BUG-015 new list).
const tooltip = computed(() => {
  if (props.status === 'online')  return 'متصل بالإنترنت — تتم المزامنة تلقائياً'
  if (props.status === 'syncing') return 'جارٍ مزامنة بياناتك...'
  return 'غير متصل — يعمل التطبيق دون إنترنت، وستتم المزامنة تلقائياً عند عودة الاتصال'
})
</script>

<template>
  <span :title="tooltip" class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full">
    <span
      :class="[
        'w-2 h-2 rounded-full',
        status === 'online'  ? 'bg-green-500' :
        status === 'syncing' ? 'bg-yellow-400 animate-pulse' :
                               'bg-text-muted opacity-60',
      ]"
    />
    <span :class="status === 'online' ? 'text-green-500' : status === 'syncing' ? 'text-yellow-400' : 'text-text-muted'">
      {{ status === 'online' ? 'متصل' : status === 'syncing' ? 'جارٍ المزامنة' : 'غير متصل' }}
    </span>
    <span v-if="(pendingCount ?? 0) > 0" class="text-text-muted">({{ pendingCount }})</span>
    <!-- Quarantined writes are a distinct, attention-worthy state — not plain offline. -->
    <span v-if="(blockedCount ?? 0) > 0" class="font-bold text-amber-400" title="معاملات متوقفة عن المزامنة">⚠ {{ blockedCount }}</span>
  </span>
</template>
