<script setup lang="ts">
import SyncIndicator      from '@/features/sync/SyncIndicator.vue'
import ExchangeRateWidget from '@/features/exchange-rate/ExchangeRateWidget.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { ref } from 'vue'

withDefaults(defineProps<{
  title:             string
  showExchangeRate?: boolean
  showBack?:         boolean
  showSettings?:     boolean
}>(), {
  showSettings: true,
})

const emit = defineEmits<{ (e: 'back'): void }>()
const editorOpen = ref(false)
</script>

<template>
  <header class="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">

      <!-- Right side (RTL start): gear + back + title -->
      <div class="flex items-center gap-2">
        <RouterLink
          v-if="showSettings"
          to="/settings"
          data-testid="gear-link"
          class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white
                 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg
                 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="الإعدادات"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </RouterLink>

        <button
          v-if="showBack"
          type="button"
          data-testid="back-button"
          class="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white
                 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="رجوع"
          @click="emit('back')"
        >
          →
        </button>

        <span class="text-base font-semibold text-gray-900 dark:text-white">{{ title }}</span>
      </div>

      <!-- Left side (RTL end): exchange rate + sync -->
      <div class="flex items-center gap-3">
        <ExchangeRateWidget v-if="showExchangeRate" @open-editor="editorOpen = true" />
        <SyncIndicator />
      </div>

    </div>
  </header>

  <ExchangeRateEditor v-if="editorOpen" @close="editorOpen = false" @saved="editorOpen = false" />
</template>
