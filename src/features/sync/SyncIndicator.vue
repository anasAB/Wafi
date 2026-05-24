<script setup lang="ts">
import { useSync } from './useSync'
import SyncBadge from '@/components/ui/SyncBadge.vue'

const { status, pendingCount, isStale, errorMessage } = useSync()
</script>

<template>
  <div class="flex flex-col items-end">
    <SyncBadge :status="status" :pending-count="pendingCount" />
    <p v-if="isStale" role="alert" class="text-xs text-orange-500 mt-0.5">لم تتم المزامنة منذ 24 ساعة</p>
    <p v-if="errorMessage" role="alert" class="text-xs text-red-500 mt-0.5 max-w-xs truncate">{{ errorMessage }}</p>
  </div>
</template>
