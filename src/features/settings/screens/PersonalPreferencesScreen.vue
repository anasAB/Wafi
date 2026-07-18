<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useSettingsStore } from '@/features/settings'
import type { Language, Theme, TextSize, IdleTimeout } from '@/features/settings'
import ThemePickerScreen from './ThemePickerScreen.vue'
import { signOut } from '@/data/supabase/auth'
import { db } from '@/data/powersync/db'
import { useFastCashSettings } from '@/features/payment/useFastCashSettings'

const router   = useRouter()
const settings = useSettingsStore()
const { t }    = useI18n()

const showSignOutConfirm = ref(false)
const unsyncedCount = ref(0)
const signOutError = ref('')

async function openSignOutConfirm() {
  try {
    const stats = await db.getUploadQueueStats()
    unsyncedCount.value = stats.count
    signOutError.value = ''
    showSignOutConfirm.value = true
  } catch {
    signOutError.value = t('personal.signOutError')
  }
}

async function confirmSignOut() {
  try {
    signOutError.value = ''
    await signOut()
    showSignOutConfirm.value = false
    router.push('/login')
  } catch {
    signOutError.value = t('personal.signOutError')
  }
}

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

const digestHourLabel = computed(() => {
  const hour = settings.dailyDigestHour
  return `${String(hour).padStart(2, '0')}:00`
})

// WAFI-124: fast-cash button configuration (device-local, like other prefs here)
const { settings: fastCash } = useFastCashSettings()

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

      <!-- WAFI-124: one-tap exact-cash buttons on the POS cart -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">أزرار الدفع السريع (نقداً مضبوط)</p>
        <div class="option-grid option-grid--two">
          <button
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': fastCash.showSyp }"
            @click="fastCash.showSyp = !fastCash.showSyp"
          >زر ل.س</button>
          <button
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': fastCash.showUsd }"
            @click="fastCash.showUsd = !fastCash.showUsd"
          >زر $</button>
        </div>
        <div class="option-grid option-grid--two" style="margin-top: 8px">
          <button
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': fastCash.sypFirst }"
            @click="fastCash.sypFirst = true"
          >ل.س أولاً</button>
          <button
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': !fastCash.sypFirst }"
            @click="fastCash.sypFirst = false"
          >$ أولاً</button>
        </div>
      </div>

      <!-- WAFI-126: soft credit warning threshold -->
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">تنبيه رصيد الآجل عند تجاوز (بالدولار)</p>
        <input
          v-model.number="settings.creditWarnThresholdUsd"
          type="number" min="0" step="1" dir="ltr"
          class="threshold-input"
          placeholder="100"
        />
        <p class="row-hint">تحذير فقط عند البيع الآجل لزبون رصيده أعلى — لا يمنع البيع</p>
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
        data-testid="signout-btn"
        class="settings-row settings-row--last signout-row"
        @click="openSignOutConfirm"
      >
        <span class="signout-label">{{ t('personal.signOut') }}</span>
      </button>
      <p v-if="signOutError" class="signout-error" data-testid="signout-error">{{ signOutError }}</p>
    </div>

    <!-- Daily digest group -->
    <p class="section-label">{{ t('personal.dailyDigestSection') }}</p>
    <div class="settings-card">
      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.dailyDigestToggle') }}</p>
        <div class="option-grid option-grid--two">
          <button
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': settings.dailyDigestEnabled }"
            @click="settings.dailyDigestEnabled = true"
          >{{ t('personal.dailyDigestOn') }}</button>
          <button
            type="button"
            class="option-btn"
            :class="{ 'option-btn--active': !settings.dailyDigestEnabled }"
            @click="settings.dailyDigestEnabled = false"
          >{{ t('personal.dailyDigestOff') }}</button>
        </div>
      </div>

      <div class="settings-row settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.dailyDigestPhone') }}</p>
        <input
          v-model="settings.dailyDigestPhone"
          type="tel"
          class="field-input"
          :placeholder="t('personal.dailyDigestPhoneHint')"
          dir="ltr"
        />
      </div>

      <div class="settings-row settings-row--last settings-row--inner">
        <p class="row-title row-title--spaced">{{ t('personal.dailyDigestHour') }}</p>
        <div class="digest-hour-row">
          <input
            :value="settings.dailyDigestHour"
            type="number"
            min="0"
            max="23"
            class="field-input field-input--hour"
            @change="settings.dailyDigestHour = Math.max(0, Math.min(23, Number(($event.target as HTMLInputElement).value || 0)))"
          />
          <span class="digest-hour-preview">{{ digestHourLabel }}</span>
        </div>
      </div>
    </div>

    <AppDialog
      v-if="showSignOutConfirm"
      :title="t('personal.signOutConfirmTitle')"
      :message="unsyncedCount > 0 ? t('personal.signOutUnsyncedMessage', { count: unsyncedCount }) : t('personal.signOutConfirmMessage')"
      :confirm-label="t('personal.signOut')"
      @confirm="confirmSignOut"
      @cancel="showSignOutConfirm = false"
    />

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

/* WAFI-126: threshold input + hint */
.threshold-input {
  width: 100%;
  height: 42px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0 0.875rem;
  color: #E8EDF5;
  font-size: 0.9375rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  box-sizing: border-box;
}
.threshold-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25);
}
.row-hint {
  margin: 0.4rem 0 0;
  font-size: 0.6875rem;
  color: #637285;
  line-height: 1.4;
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

.field-input {
  width: 100%;
  min-height: 40px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem;
  padding: 0.55rem 0.8rem;
  color: #E8EDF5;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.field-input::placeholder { color: #637285; }

.field-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 10px rgba(26,86,219,0.12);
}

.digest-hour-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.field-input--hour {
  max-width: 6rem;
}

.digest-hour-preview {
  font-size: 0.82rem;
  font-weight: 700;
  color: #93C5FD;
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
  cursor: pointer;
  border-bottom: none;
  min-height: 52px;
}

.signout-label {
  font-size: 0.875rem;
  font-weight: 700;
  color: #EF4444;
}

.signout-error {
  margin: 0;
  padding: 0 16px 14px;
  font-size: 0.78rem;
  color: #EF4444;
  text-align: right;
}
</style>
