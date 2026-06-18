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
  <div class="lg:hidden">
    <AppHeader
      :title="t('settings.personal')"
      :show-back="true"
      :show-settings="false"
      @back="router.back()"
    />
  </div>

  <div class="page-body" dir="rtl">

    <div class="intro-card">
      <p class="intro-title">{{ t('settings.personal') }}</p>
      <p class="intro-sub">التغييرات تُطبّق مباشرة على التطبيق</p>
    </div>

    <!-- Preferences group -->
    <p class="section-label">{{ t('personal.preferencesSection') }}</p>
    <div class="settings-card">

      <!-- Luxury theme -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.luxuryTheme') }}</p>
        <ThemePickerScreen />
      </div>

      <!-- Language -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.language') }}</p>
        <div class="tab-bar">
          <button
            v-for="lang in languages"
            :key="lang.value"
            type="button"
            class="tab-btn"
            :class="{ 'tab-btn--active': settings.language === lang.value }"
            @click="settings.language = lang.value"
          >
            {{ lang.label }}
          </button>
        </div>
      </div>

      <!-- Theme -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.theme') }}</p>
        <div class="tab-bar">
          <button
            v-for="thm in themes"
            :key="thm.value"
            type="button"
            class="tab-btn"
            :class="{ 'tab-btn--active': settings.theme === thm.value }"
            @click="settings.theme = thm.value"
          >
            {{ thm.label }}
          </button>
        </div>
      </div>

      <!-- Text size -->
      <div class="settings-row settings-row--last settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.textSize') }}</p>
        <div class="tab-bar">
          <button
            v-for="s in textSizes"
            :key="s.value"
            type="button"
            class="tab-btn"
            :class="{ 'tab-btn--active': settings.textSize === s.value }"
            @click="settings.textSize = s.value"
          >
            <span class="sm:hidden">{{ s.short }}</span>
            <span class="hidden sm:inline">{{ s.full }}</span>
          </button>
        </div>
      </div>

    </div>

    <!-- Session group -->
    <p class="section-label">{{ t('personal.sessionSection') }}</p>
    <div class="settings-card">
      <button
        type="button"
        class="settings-row settings-row--last signout-row"
        disabled
      >
        <span class="signout-label">{{ t('personal.signOut') }}</span>
        <span class="coming-soon-badge">{{ t('common.comingSoon') }}</span>
      </button>
    </div>

  </div>
</template>

<style scoped>
/* ─── Layout ─────────────────────────────────────────────── */
.page-body {
  padding: 16px;
  max-width: 512px;
  margin: 0 auto;
  width: 100%;
  padding-bottom: 80px;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 1024px) {
  .page-body {
    padding: 20px;
    max-width: none;
  }
}

.intro-card {
  margin-bottom: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.intro-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #E8EDF5;
}

.intro-sub {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: #637285;
}

/* ─── Section label ───────────────────────────────────────── */
.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 8px 4px;
  margin-top: 16px;
  margin-bottom: 6px;
}

.section-label:first-child { margin-top: 0; }

/* ─── Settings card ───────────────────────────────────────── */
.settings-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-radius: 1rem;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
  margin-bottom: 0.75rem;
}

/* ─── Settings rows ───────────────────────────────────────── */
.settings-row {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: transparent;
  border-inline: none;
  text-align: right;
  transition: background 0.15s;
}

.settings-row--inner {
  display: block;
}

.settings-row--last {
  border-bottom: none;
}

.settings-row:not(button):hover,
button.settings-row:hover:not(:disabled) {
  background: rgba(26, 86, 219, 0.06);
}

/* ─── Row content ─────────────────────────────────────────── */
.row-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0;
}

.row-title--spaced {
  margin-bottom: 0.625rem;
}

/* ─── Tab bar ─────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  gap: 0.125rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(26, 86, 219, 0.18);
  border-radius: 0.75rem;
  padding: 3px;
}

.tab-btn {
  flex: 1;
  min-height: 34px;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #637285;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, font-weight 0.1s, box-shadow 0.15s;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.tab-btn:hover {
  color: #C8D5E8;
}

.tab-btn--active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: white;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(26, 86, 219, 0.30);
}

/* ─── Sign out row ────────────────────────────────────────── */
.signout-row {
  cursor: not-allowed;
  opacity: 0.7;
  border-bottom: none;
  min-height: 52px;
}

.signout-label {
  font-size: 0.875rem;
  font-weight: 700;
  color: #EF4444;
}

.coming-soon-badge {
  font-size: 0.75rem;
  color: #9CA9BA;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
}
</style>
