<script setup lang="ts">
/**
 * Always-visible connection indicator. Shows متصل / جارٍ المزامنة / غير متصل
 * driven by TRUE network state (see useConnectionStatus), so it is correct in
 * local-only mode — unlike the sync-only SyncBadge, which lives in the sync
 * detail panel.
 */
import { useConnectionStatus } from '@/composables/useConnectionStatus'

const { tone, label, detail } = useConnectionStatus()
</script>

<template>
  <span
    :title="detail"
    data-testid="connection-pill"
    class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full"
    dir="rtl"
  >
    <span
      :class="[
        'w-2 h-2 rounded-full',
        tone === 'ok'   ? 'bg-green-500' :
        tone === 'busy' ? 'bg-yellow-400 animate-pulse' :
                          'bg-text-muted opacity-60',
      ]"
    />
    <span
      :class="tone === 'ok' ? 'text-green-500' : tone === 'busy' ? 'text-yellow-400' : 'text-text-muted'"
    >{{ label }}</span>
  </span>
</template>
