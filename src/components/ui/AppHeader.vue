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
  <!--
    dir="ltr" on the row — navigation headers always lay out LTR:
    back button on the LEFT, actions on the RIGHT, regardless of page RTL/LTR.
    The title and button labels still render in RTL via their own dir.
  -->
  <header class="app-header">
    <div class="header-inner" dir="ltr">

      <!-- Left side: back button + title -->
      <div class="header-left">
        <button
          v-if="showBack"
          type="button"
          data-testid="back-button"
          class="icon-btn"
          aria-label="رجوع"
          @click="emit('back')"
        >
          <!-- Always LEFT-pointing chevron — universally understood as "back" -->
          <svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="header-title" dir="auto">{{ title }}</span>
      </div>

      <!-- Right side: exchange rate + sync -->
      <div class="header-right">
        <ExchangeRateWidget v-if="showExchangeRate" @open-editor="editorOpen = true" />
        <SyncIndicator />
      </div>

    </div>
  </header>

  <ExchangeRateEditor v-if="editorOpen" @close="editorOpen = false" @saved="editorOpen = false" />
</template>

<style scoped>
/* ── Header Bar ──────────────────────────────────────── */
.app-header {
  position: sticky;
  top: 0;
  z-index: 30;
  flex-shrink: 0;
  background: rgba(6, 9, 15, 0.95);
  backdrop-filter: blur(12px) saturate(160%);
  border-bottom: 1px solid rgba(26, 86, 219, 0.18);
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Inner row ───────────────────────────────────────── */
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-inline: 1rem;
  height: 56px;
}

@media (min-width: 1024px) {
  .header-inner {
    padding-inline: 1.5rem;
    height: 60px;
  }
}

/* ── Left side ───────────────────────────────────────── */
.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

/* ── Right side ──────────────────────────────────────── */
.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

/* ── Title ───────────────────────────────────────────── */
.header-title {
  font-size: 1rem;
  font-weight: 600;
  color: #E8EDF5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Icon Button (back button) ───────────────────────── */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.07);
  color: #637285;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.09);
  color: #C8D5E8;
}

.icon {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
