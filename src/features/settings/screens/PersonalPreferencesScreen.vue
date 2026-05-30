<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSettingsStore } from '@/features/settings'
import type { Language, Theme, TextSize } from '@/features/settings'

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

  <div class="px-4 py-4 md:p-5 max-w-lg mx-auto w-full md:max-w-none">

    <!-- Preferences group -->
    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1 md:px-0">{{ t('personal.preferencesSection') }}</p>
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden mb-4 md:shadow-none md:rounded-none md:bg-transparent md:dark:bg-transparent">

      <!-- Language -->
      <div class="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <p class="text-sm text-gray-700 dark:text-gray-300 mb-2.5">{{ t('personal.language') }}</p>
        <div class="flex gap-2">
          <button
            v-for="lang in languages"
            :key="lang.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
            :class="settings.language === lang.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'"
            @click="settings.language = lang.value"
          >
            {{ lang.label }}
          </button>
        </div>
      </div>

      <!-- Theme -->
      <div class="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <p class="text-sm text-gray-700 dark:text-gray-300 mb-2.5">{{ t('personal.theme') }}</p>
        <div class="flex gap-2">
          <button
            v-for="thm in themes"
            :key="thm.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
            :class="settings.theme === thm.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'"
            @click="settings.theme = thm.value"
          >
            {{ thm.label }}
          </button>
        </div>
      </div>

      <!-- Text size -->
      <div class="px-4 py-3.5">
        <p class="text-sm text-gray-700 dark:text-gray-300 mb-2.5">{{ t('personal.textSize') }}</p>
        <div class="flex gap-1.5">
          <button
            v-for="s in textSizes"
            :key="s.value"
            type="button"
            class="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
            :class="settings.textSize === s.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'"
            @click="settings.textSize = s.value"
          >
            <span class="sm:hidden">{{ s.short }}</span>
            <span class="hidden sm:inline">{{ s.full }}</span>
          </button>
        </div>
      </div>

    </div>

    <!-- Session group -->
    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1 md:px-0">{{ t('personal.sessionSection') }}</p>
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden md:shadow-none md:rounded-none md:bg-transparent md:dark:bg-transparent">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3.5 text-sm text-red-500 opacity-60 cursor-not-allowed"
        disabled
        title="سيتم تفعيله في الإصدار القادم"
      >
        <span>{{ t('personal.signOut') }}</span>
        <span class="text-xs text-gray-400 dark:text-gray-500">{{ t('common.comingSoon') }}</span>
      </button>
    </div>

  </div>
</template>
