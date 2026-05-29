<script setup lang="ts">
import { ref } from 'vue'
import { useSync } from './useSync'
import SyncBadge from '@/components/ui/SyncBadge.vue'

const { status, pendingCount, lastSyncedAt, isStale, errorMessage, syncNow } = useSync()

const panelOpen = ref(false)
const syncing   = ref(false)

function formatLastSync(d: Date | null): string {
  if (!d) return 'لم تتم المزامنة بعد'
  return new Intl.DateTimeFormat('ar-SY', {
    hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
  }).format(d)
}

async function handleSyncNow() {
  syncing.value = true
  try {
    await syncNow()
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <!-- Tappable badge -->
  <button
    type="button"
    aria-label="فتح لوحة المزامنة"
    :aria-expanded="panelOpen"
    class="flex flex-col items-end focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
    @click="panelOpen = !panelOpen"
  >
    <SyncBadge :status="status" :pending-count="pendingCount" />
    <p v-if="isStale" role="alert" class="text-xs text-orange-500 mt-0.5">لم تتم المزامنة منذ 24 ساعة</p>
    <p v-if="errorMessage" role="alert" class="text-xs text-red-500 mt-0.5 max-w-xs truncate">{{ errorMessage }}</p>
  </button>

  <!-- Invisible overlay to catch outside clicks -->
  <div
    v-if="panelOpen"
    class="fixed inset-0 z-30"
    @click="panelOpen = false"
  />

  <!-- Detail panel (fixed, always below the 56px header) -->
  <div
    v-if="panelOpen"
    class="fixed top-14 start-0 end-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-md px-4 py-4 text-right"
  >
    <div class="max-w-lg mx-auto space-y-3">
      <div class="flex justify-between text-sm">
        <span class="text-gray-500 dark:text-gray-400">آخر مزامنة</span>
        <span class="text-gray-900 dark:text-white">{{ formatLastSync(lastSyncedAt) }}</span>
      </div>

      <div v-if="(pendingCount ?? 0) > 0" class="flex justify-between text-sm">
        <span class="text-gray-500 dark:text-gray-400">في الانتظار</span>
        <span class="text-orange-600 font-medium">{{ pendingCount }} معاملة</span>
      </div>

      <div v-if="errorMessage" class="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
        {{ errorMessage }}
      </div>

      <div class="flex gap-2 pt-1">
        <button
          type="button"
          :disabled="syncing || status === 'syncing'"
          class="flex-1 h-9 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          @click="handleSyncNow"
        >
          {{ syncing || status === 'syncing' ? 'جارٍ المزامنة...' : 'مزامنة الآن' }}
        </button>
        <button
          type="button"
          class="h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300"
          @click="panelOpen = false"
        >
          إغلاق
        </button>
      </div>
    </div>
  </div>
</template>
