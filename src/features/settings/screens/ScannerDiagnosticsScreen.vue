<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useSettingsStore } from '@/features/settings'
import { useBarcodeScan, type ScanDiagnosticEvent } from '@/composables/useBarcodeScan'

// WAFI-125: pairing/diagnostics for cheap wedge scanners. "Scan here — we show
// exactly what we received" so remote support (brother on WhatsApp) can tune
// the thresholds without guessing.
const router   = useRouter()
const settings = useSettingsStore()
const scanner  = useBarcodeScan()

type CapturedScan = {
  at: string
  keys: Array<{ key: string; intervalMs: number | null }>
  verdict: string
  code: string | null
}

const current = ref<Array<{ key: string; intervalMs: number | null }>>([])
const history = ref<CapturedScan[]>([])
const copied  = ref(false)

function pushResult(verdict: string, code: string | null) {
  history.value.unshift({
    at: new Date().toLocaleTimeString('ar-SY'),
    keys: current.value,
    verdict,
    code,
  })
  history.value = history.value.slice(0, 10)
  current.value = []
}

function onEvent(e: ScanDiagnosticEvent) {
  if (e.type === 'key') {
    current.value = [...current.value, { key: e.key, intervalMs: e.intervalMs }]
  } else if (e.type === 'commit') {
    pushResult(e.via === 'terminator' ? '✅ تم التعرف (بمحرف إنهاء)' : '✅ تم التعرف (بالمهلة — بدون محرف إنهاء)', e.code)
  } else {
    pushResult(e.reason === 'too-short' ? '⚠️ أقصر من الحد الأدنى' : '⚠️ أبطأ من عتبة السرعة — ارفع العتبة أدناه', e.code)
  }
}

onMounted(() => scanner.onDiagnostic(onEvent))
onUnmounted(() => scanner.destroy())

function fmtInterval(ms: number | null): string {
  return ms === null ? '—' : `${Math.round(ms)}ms`
}

// Sharable plain-text report for remote support.
async function shareReport() {
  const lines = [
    'تشخيص الماسح الضوئي — وافي',
    `العتبة: ${settings.scannerIntervalMs}ms · الحد الأدنى: ${settings.scannerMinLength} · الإنهاء: ${settings.scannerTerminator}`,
    ...history.value.map(s =>
      `[${s.at}] ${s.verdict} ${s.code ?? ''}\n  ${s.keys.map(k => `${k.key}(${fmtInterval(k.intervalMs)})`).join(' ')}`
    ),
  ]
  const text = lines.join('\n')
  try {
    if (navigator.share) await navigator.share({ text })
    else { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => { copied.value = false }, 2000) }
  } catch { /* user cancelled share */ }
}
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="الماسح الضوئي" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <div class="intro-card">
      <p class="intro-title">تشخيص وإعداد الماسح</p>
      <p class="intro-sub">امسح أي باركود الآن — سيظهر هنا ما استقبله التطبيق حرفاً بحرف</p>
    </div>

    <!-- Live capture -->
    <div class="capture-card" data-testid="scanner-capture">
      <p v-if="current.length === 0 && history.length === 0" class="capture-empty">بانتظار أول مسح…</p>
      <p v-if="current.length > 0" class="capture-live" dir="ltr">
        {{ current.map(k => k.key).join('') }}
      </p>
      <div v-for="(s, i) in history" :key="i" class="capture-row">
        <p class="capture-verdict">{{ s.verdict }} <span v-if="s.code" dir="ltr" class="capture-code">{{ s.code }}</span></p>
        <p class="capture-keys" dir="ltr">{{ s.keys.map(k => `${k.key}(${fmtInterval(k.intervalMs)})`).join(' ') }}</p>
      </div>
    </div>

    <button type="button" class="share-btn" :disabled="history.length === 0" @click="shareReport">
      {{ copied ? 'تم النسخ ✓' : 'مشاركة التقرير (للدعم)' }}
    </button>

    <!-- Configuration -->
    <p class="section-label">الإعدادات</p>
    <div class="settings-card">
      <div class="settings-row">
        <p class="row-title">عتبة السرعة بين الحروف (ms) — ارفعها للماسحات البطيئة</p>
        <input v-model.number="settings.scannerIntervalMs" type="number" min="10" step="1" dir="ltr" class="cfg-input" />
      </div>
      <div class="settings-row">
        <p class="row-title">الحد الأدنى لطول الباركود</p>
        <input v-model.number="settings.scannerMinLength" type="number" min="1" step="1" dir="ltr" class="cfg-input" />
      </div>
      <div class="settings-row">
        <p class="row-title">محرف إنهاء المسح</p>
        <select v-model="settings.scannerTerminator" class="cfg-input">
          <option value="enter-tab">Enter أو Tab (الافتراضي)</option>
          <option value="enter">Enter فقط</option>
          <option value="tab">Tab فقط</option>
          <option value="none">بدون — إنهاء بالمهلة</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; font-family: 'Tajawal', system-ui, sans-serif; color: #E8EDF5; }

.intro-card { border-radius: 1rem; background: #0D1828; border: 1px solid rgba(255,255,255,0.07); padding: 1rem; }
.intro-title { margin: 0; font-size: 0.9375rem; font-weight: 700; }
.intro-sub { margin: 0.25rem 0 0; font-size: 0.75rem; color: #637285; line-height: 1.5; }

.capture-card { border-radius: 1rem; background: #0D1828; border: 1px solid rgba(26,86,219,0.28); padding: 0.875rem; min-height: 7rem; display: flex; flex-direction: column; gap: 0.625rem; }
.capture-empty { margin: auto; font-size: 0.8125rem; color: #3D4F6B; }
.capture-live { margin: 0; font-family: monospace; font-size: 1.125rem; color: #60A5FA; }
.capture-row { border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 0.5rem; }
.capture-row:last-child { border-bottom: none; }
.capture-verdict { margin: 0; font-size: 0.8125rem; font-weight: 700; }
.capture-code { font-family: monospace; color: #4ADE80; }
.capture-keys { margin: 0.25rem 0 0; font-family: monospace; font-size: 0.6875rem; color: #637285; overflow-x: auto; white-space: nowrap; }

.share-btn { height: 44px; border-radius: 0.75rem; border: 1px solid rgba(26,86,219,0.35); background: rgba(26,86,219,0.12); color: #60A5FA; font-family: inherit; font-size: 0.875rem; font-weight: 700; cursor: pointer; }
.share-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.section-label { margin: 0.5rem 0 0; font-size: 0.75rem; color: #637285; }
.settings-card { border-radius: 1rem; background: #0D1828; border: 1px solid rgba(255,255,255,0.07); }
.settings-row { padding: 0.875rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
.settings-row:last-child { border-bottom: none; }
.row-title { margin: 0 0 0.5rem; font-size: 0.8125rem; font-weight: 600; }
.cfg-input { width: 100%; height: 42px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18); border-radius: 0.75rem; padding: 0 0.875rem; color: #E8EDF5; font-size: 0.9375rem; font-weight: 700; font-family: 'Tajawal', system-ui, sans-serif; outline: none; box-sizing: border-box; }
.cfg-input:focus { border-color: rgba(26,86,219,0.8); box-shadow: 0 0 0 3px rgba(26,86,219,0.25); }
</style>
