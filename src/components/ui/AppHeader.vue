<script setup lang="ts">
import SyncIndicator      from '@/features/sync/SyncIndicator.vue'
import ExchangeRateWidget from '@/features/exchange-rate/ExchangeRateWidget.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import { ref } from 'vue'

withDefaults(defineProps<{
  title:             string
  showExchangeRate?: boolean
  showBack?:         boolean
}>(), {
  showExchangeRate: false,
  showBack:         false,
})

const emit = defineEmits<{ (e: 'back'): void }>()
const editorOpen = ref(false)
</script>

<template>
  <header
    class="sticky top-0 z-30 flex-shrink-0"
    style="background: rgb(255 255 255 / 0.05); backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid rgb(201 168 76 / 0.25)"
  >
    <div class="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">

      <!-- Start side: back button + title -->
      <div class="flex items-center gap-2">
        <button
          v-if="showBack"
          type="button"
          data-testid="back-button"
          class="text-text-muted hover:text-gold-primary hover:bg-surface-glass rounded-lg
                 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
          aria-label="رجوع"
          @click="emit('back')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="font-display text-base font-medium text-text-primary">{{ title }}</span>
      </div>

      <!-- End side: exchange rate + sync -->
      <div class="flex items-center gap-3">
        <ExchangeRateWidget v-if="showExchangeRate" @open-editor="editorOpen = true" />
        <SyncIndicator />
      </div>

    </div>
  </header>

  <ExchangeRateEditor v-if="editorOpen" @close="editorOpen = false" @saved="editorOpen = false" />
</template>
