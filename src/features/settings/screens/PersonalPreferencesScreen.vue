<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSettingsStore } from '@/features/settings'
import type { Language, Theme, TextSize, IdleTimeout } from '@/features/settings'
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

const idleOptions: { value: IdleTimeout; label: string }[] = [
  { value: 5,       label: '5 د'  },
  { value: 15,      label: '15 د' },
  { value: 30,      label: '30 د' },
  { value: 60,      label: '60 د' },
  { value: 'never', label: 'أبداً' },
]

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
      @back="router.back()"
    />
  </div>

  <div class="page-body" dir="rtl">

    <div class="intro-card">
      <p class="intro-title">{{ t('settings.personal') }}</p>
      <p class="intro-sub">التغييرات تُطبّق مباشرة على التطبيق</p>
    </div>

    <div class="summary-row">
      <div class="summary-chip">
        <span class="summary-label">اللغة الحالية</span>
        <span class="summary-value">{{ settings.language === 'ar' ? 'العربية' : 'English' }}</span>
      </div>
      <div class="summary-chip">
        <span class="summary-label">حجم النص</span>
        <span class="summary-value summary-value--blue">{{ textSizes.find((s) => s.value === settings.textSize)?.short }}</span>
      </div>
    </div>

    <!-- Preferences group -->
    <p class="section-label">{{ t('personal.preferencesSection') }}</p>
    <div class="settings-card">

      <!-- Luxury theme -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.luxuryTheme') }}</p>
        <div class="theme-picker-wrap">
          <ThemePickerScreen />
        </div>
      </div>

      <!-- Language -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.language') }}</p>
        <div class="option-grid option-grid--two">
          <button
            v-for="lang in languages"
            :key="lang.value"
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': settings.language === lang.value }"
            @click="settings.language = lang.value"
          >
            {{ lang.label }}
          </button>
        </div>
      </div>

      <!-- Theme -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.theme') }}</p>
        <div class="option-grid option-grid--three">
          <button
            v-for="thm in themes"
            :key="thm.value"
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': settings.theme === thm.value }"
            @click="settings.theme = thm.value"
          >
            {{ thm.label }}
          </button>
        </div>
      </div>

      <!-- Text size -->
      <div class="settings-row settings-row--last settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.textSize') }}</p>
        <div class="option-grid option-grid--four">
          <button
            v-for="s in textSizes"
            :key="s.value"
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': settings.textSize === s.value }"
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

      <!-- WAFI-062: idle auto-lock (PIN re-entry without closing the shift) -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">القفل التلقائي بعد الخمول</p>
        <div class="option-grid option-grid--five">
          <button
            v-for="opt in idleOptions"
            :key="String(opt.value)"
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': settings.idleTimeout === opt.value }"
            @click="settings.idleTimeout = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

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

.summary-row {
  margin-bottom: 0.85rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.summary-chip {
  border-radius: 0.8rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.08);
  padding: 0.55rem 0.65rem;
}

.summary-label {
  display: block;
  color: #637285;
  font-size: 0.72rem;
}

.summary-value {
  display: block;
  margin-top: 0.2rem;
  color: #E8EDF5;
  font-size: 0.92rem;
  font-weight: 800;
}

.summary-value--blue {
  color: #60A5FA;
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
  margin-bottom: 0.7rem;
}

/* ─── Option buttons ─────────────────────────────────────── */
.option-grid {
  display: grid;
  gap: 0.4rem;
}

.option-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.option-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.option-grid--five {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.option-grid--four {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 640px) {
  .option-grid--four {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.option-btn {
  min-height: 36px;
  padding: 0.42rem 0.55rem;
  border-radius: 0.6rem;
  font-size: 0.79rem;
  font-weight: 700;
  color: #AFC0D8;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(26,86,219,0.2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.option-btn:hover {
  color: #E8EDF5;
  border-color: rgba(26,86,219,0.4);
  background: rgba(26,86,219,0.12);
}

.option-btn--active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border-color: transparent;
  color: white;
  box-shadow: 0 4px 12px rgba(26, 86, 219, 0.30);
}

.theme-picker-wrap :deep(button[data-testid="theme-swatch"]) {
  background: rgba(255,255,255,0.04) !important;
  border-color: rgba(26,86,219,0.2) !important;
  box-shadow: 0 2px 12px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
  border-radius: 0.7rem !important;
}

.theme-picker-wrap :deep(button[data-testid="theme-swatch"][aria-pressed="true"]) {
  border-color: rgba(96,165,250,0.65) !important;
  box-shadow: 0 0 0 2px rgba(26,86,219,0.22), 0 4px 16px rgba(26,86,219,0.2);
}

.theme-picker-wrap :deep(button[data-testid="theme-swatch"] span:last-child) {
  font-family: 'Tajawal', system-ui, sans-serif !important;
  font-size: 0.72rem !important;
  font-weight: 700;
  color: #DCE7F7;
}

/* ─── Sign out row ────────────────────────────────────────── */
.signout-row {
  cursor: not-allowed;
  opacity: 0.85;
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
