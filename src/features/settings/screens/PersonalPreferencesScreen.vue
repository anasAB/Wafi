<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSettingsStore } from '@/features/settings'
import type { Language, Theme, TextSize } from '@/features/settings'
import ThemePickerScreen from './ThemePickerScreen.vue'

const router   = useRouter()
const settings = useSettingsStore()
const { t }    = useI18n()

const languages: { value: Language; label: string }[] = [
  { value: 'ar', label: 'العربية' },
  { value: 'en', label: 'English' },
]

const themes = computed(() => [
  { value: 'light' as Theme, label: t('theme.light') },
  { value: 'dark'  as Theme, label: t('theme.dark')  },
  { value: 'auto'  as Theme, label: t('theme.auto')  },
])

const textSizes = computed(() => [
  { value: 'small'   as TextSize, short: t('textSize.small'),   full: t('textSize.smallFull')   },
  { value: 'default' as TextSize, short: t('textSize.default'),  full: t('textSize.defaultFull') },
  { value: 'large'   as TextSize, short: t('textSize.large'),    full: t('textSize.largeFull')   },
  { value: 'xlarge'  as TextSize, short: t('textSize.xlarge'),   full: t('textSize.xlargeFull')  },
])
</script>

<template>
  <!-- Header shown on mobile only; desktop renders inside SettingsPage panel -->
  <div class="md:hidden">
    <AppHeader
      :title="t('settings.personal')"
      :show-back="true"
      :show-settings="false"
      @back="router.back()"
    />
  </div>

  <div class="px-4 py-4 md:p-5 max-w-lg mx-auto w-full md:max-w-none" dir="rtl">

    <!-- Preferences group -->
    <p class="text-xs font-semibold text-text-muted mb-2 px-1 md:px-0 tracking-widest uppercase">{{ t('personal.preferencesSection') }}</p>
    <div class="glass-sm overflow-hidden mb-4">

      <!-- Luxury theme -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <p class="text-sm text-text-muted mb-3">{{ t('personal.luxuryTheme') }}</p>
        <ThemePickerScreen />
      </div>

      <!-- Language -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <p class="text-sm text-text-muted mb-2.5">{{ t('personal.language') }}</p>
        <div class="flex gap-2">
          <button
            v-for="lang in languages"
            :key="lang.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-all"
            :class="settings.language === lang.value
              ? 'text-bg-void font-semibold'
              : 'bg-surface-glass text-text-muted hover:bg-surface-raised hover:text-text-primary'"
            :style="settings.language === lang.value
              ? 'background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))'
              : ''"
            @click="settings.language = lang.value"
          >
            {{ lang.label }}
          </button>
        </div>
      </div>

      <!-- Theme -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <p class="text-sm text-text-muted mb-2.5">{{ t('personal.theme') }}</p>
        <div class="flex gap-2">
          <button
            v-for="thm in themes"
            :key="thm.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-all"
            :class="settings.theme === thm.value
              ? 'text-bg-void font-semibold'
              : 'bg-surface-glass text-text-muted hover:bg-surface-raised hover:text-text-primary'"
            :style="settings.theme === thm.value
              ? 'background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))'
              : ''"
            @click="settings.theme = thm.value"
          >
            {{ thm.label }}
          </button>
        </div>
      </div>

      <!-- Text size -->
      <div class="px-4 py-3.5">
        <p class="text-sm text-text-muted mb-2.5">{{ t('personal.textSize') }}</p>
        <div class="flex gap-1.5">
          <button
            v-for="s in textSizes"
            :key="s.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-all"
            :class="settings.textSize === s.value
              ? 'text-bg-void font-semibold'
              : 'bg-surface-glass text-text-muted hover:bg-surface-raised hover:text-text-primary'"
            :style="settings.textSize === s.value
              ? 'background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))'
              : ''"
            @click="settings.textSize = s.value"
          >
            <span class="sm:hidden">{{ s.short }}</span>
            <span class="hidden sm:inline">{{ s.full }}</span>
          </button>
        </div>
      </div>

    </div>

    <!-- Session group -->
    <p class="text-xs font-semibold text-text-muted mb-2 px-1 md:px-0 tracking-widest uppercase">{{ t('personal.sessionSection') }}</p>
    <div class="glass-sm overflow-hidden">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-500 opacity-50 cursor-not-allowed"
        disabled
      >
        <span>{{ t('personal.signOut') }}</span>
        <span class="text-xs text-text-muted">{{ t('common.comingSoon') }}</span>
      </button>
    </div>

  </div>
</template>
