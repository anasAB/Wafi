<script setup lang="ts">
import SyncIndicator from '@/features/sync/SyncIndicator.vue'
import ExchangeRateWidget from '@/features/exchange-rate/ExchangeRateWidget.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { ref } from 'vue'

defineProps<{
  title:            string
  showExchangeRate?: boolean
  showBack?:        boolean
}>()

const emit = defineEmits<{ (e: 'back'): void }>()
const editorOpen = ref(false)
</script>

<template>
  <header class="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
      <!-- Right side: back or title -->
      <div class="flex items-center gap-3">
        <button
          v-if="showBack"
          type="button"
          class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white p-1 -mr-1 min-w-[44px] min-h-[44px] flex items-center"
          aria-label="رجوع"
          @click="emit('back')"
        >
          ←
        </button>
        <span class="text-base font-semibold text-gray-900 dark:text-white">{{ title }}</span>
      </div>

      <!-- Left side: sync + rate -->
      <div class="flex items-center gap-3">
        <ExchangeRateWidget
          v-if="showExchangeRate"
          @open-editor="editorOpen = true"
        />
        <SyncIndicator />
      </div>
    </div>
  </header>

  <ExchangeRateEditor
    v-if="editorOpen"
    @close="editorOpen = false"
    @saved="editorOpen = false"
  />
</template>
