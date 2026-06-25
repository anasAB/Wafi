<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useShift }   from '@/features/shifts/composables/useShift'
import { useZReport } from '@/features/shifts/composables/useZReport'
import type { CashierShift, ZReportMetrics } from '@/features/shifts/shift.types'
import type { Staff } from '@/features/staff/staff.types'

// Owner force-close of an abandoned shift (WAFI-065 Part 2). The cashier never
// counted the drawer, so the owner enters/accepts the SYSTEM-COMPUTED expected cash
// — a real, labelled close with variance, never a silent fabricated count.
const props = defineProps<{ shift: CashierShift; forcedBy: Staff }>()
const emit  = defineEmits<{ done: []; cancel: [] }>()

// Default reason recorded on every force-close (epic edge case #2). The owner's
// optional note is appended.
const DEFAULT_NOTE = 'إغلاق إجباري من قبل المالك (دون عدّ من الكاشير)'

const { forceCloseShift } = useShift()
const { compute }         = useZReport()

const loading  = ref(true)
const closing  = ref(false)
const errorMsg = ref('')
// Expected figures, computed from the shift's sales/expenses (independent of count).
const expectedUsd = ref(0)
const expectedSyp = ref(0)
// Counted cash the owner attests to — defaults to expected (= "accept system figure",
// variance 0). The owner may override if they physically counted the drawer.
const countedUsd = ref('')
const countedSyp = ref('')
const reason     = ref('')

onMounted(async () => {
  try {
    // Counted value is irrelevant to `expected`; pass 0 just to read the expecteds.
    const m = await compute(props.shift, 0, 0)
    expectedUsd.value = m.expectedUsd
    expectedSyp.value = m.expectedSyp
    countedUsd.value  = String(m.expectedUsd)
    countedSyp.value  = String(m.expectedSyp)
  } catch (e) {
    errorMsg.value = 'تعذّر حساب المبلغ المتوقع. حاول مرة أخرى.'
    // eslint-disable-next-line no-console
    console.warn('[ForceCloseSheet] compute failed:', e)
  } finally {
    loading.value = false
  }
})

const fmtUsd = (n: number) => `$${n.toFixed(2)}`
const fmtSyp = (n: number) => `${n.toLocaleString('en-US')} ل.س`

const countedUsdNum = computed(() => parseFloat(countedUsd.value) || 0)
const countedSypNum = computed(() => parseFloat(countedSyp.value) || 0)
// Live variance preview so the owner sees the consequence of overriding the expected.
const varianceUsd = computed(() => countedUsdNum.value - expectedUsd.value)
const varianceSyp = computed(() => countedSypNum.value - expectedSyp.value)

async function confirm() {
  if (loading.value || closing.value) return
  closing.value = true
  errorMsg.value = ''
  try {
    // Recompute with the attested counts so the persisted snapshot's variance/actual
    // match exactly what the owner confirmed.
    const metrics: ZReportMetrics = await compute(props.shift, countedUsdNum.value, countedSypNum.value)
    const note = reason.value.trim() ? `${DEFAULT_NOTE} — ${reason.value.trim()}` : DEFAULT_NOTE
    await forceCloseShift({
      shiftId:        props.shift.id,
      forcedBy:       props.forcedBy,
      closingCashUsd: countedUsdNum.value,
      closingCashSyp: countedSypNum.value,
      varianceUsd:    metrics.varianceUsd,
      varianceSyp:    metrics.varianceSyp,
      closeNote:      note,
      zReport:        metrics,
    })
    emit('done')
  } catch (e) {
    errorMsg.value = 'تعذّر إغلاق الوردية. حاول مرة أخرى.'
    // eslint-disable-next-line no-console
    console.warn('[ForceCloseSheet] forceClose failed:', e)
  } finally {
    closing.value = false
  }
}
</script>

<template>
  <div class="fc-overlay" dir="rtl" @click.self="emit('cancel')">
    <div class="fc-card">
      <div class="fc-head">
        <span class="fc-warn-icon">⚠</span>
        <div>
          <h2 class="fc-title">إغلاق إجباري للوردية</h2>
          <p class="fc-sub">الكاشير لم يُغلق الوردية. أكّد المبلغ المتوقع لإغلاقها بشكل موثّق.</p>
        </div>
      </div>

      <div v-if="loading" class="fc-muted">جاري حساب المبلغ المتوقع...</div>

      <template v-else>
        <!-- Expected (system-computed) — accepting it yields zero variance -->
        <div class="fc-expected">
          <div class="fc-exp-row">
            <span class="fc-label">المتوقع (دولار)</span>
            <span class="fc-value" dir="ltr">{{ fmtUsd(expectedUsd) }}</span>
          </div>
          <div class="fc-exp-row">
            <span class="fc-label">المتوقع (ليرة)</span>
            <span class="fc-value" dir="ltr">{{ fmtSyp(expectedSyp) }}</span>
          </div>
        </div>

        <!-- Counted: defaults to expected; owner may override if they counted -->
        <label class="fc-field-label">المبلغ المؤكَّد (دولار)</label>
        <div class="fc-input-card">
          <span class="fc-cur">$</span>
          <input v-model="countedUsd" type="number" min="0" step="0.01" class="fc-input" dir="ltr" />
        </div>
        <label class="fc-field-label">المبلغ المؤكَّد (ليرة)</label>
        <div class="fc-input-card">
          <span class="fc-cur">ل.س</span>
          <input v-model="countedSyp" type="number" min="0" step="1" class="fc-input" dir="ltr" />
        </div>

        <!-- Variance preview when the owner overrides the expected -->
        <div v-if="varianceUsd !== 0 || varianceSyp !== 0" class="fc-variance">
          <span class="fc-label">الفرق</span>
          <span class="fc-value" dir="ltr">
            {{ varianceUsd >= 0 ? '+' : '' }}{{ fmtUsd(varianceUsd) }} ·
            {{ varianceSyp >= 0 ? '+' : '' }}{{ fmtSyp(varianceSyp) }}
          </span>
        </div>

        <label class="fc-field-label" for="fc-reason">سبب الإغلاق الإجباري (اختياري)</label>
        <textarea
          id="fc-reason"
          v-model="reason"
          class="fc-textarea"
          rows="2"
          placeholder="مثال: الكاشير غادر دون إغلاق، الجهاز فُقد..."
          dir="rtl"
        ></textarea>

        <p v-if="errorMsg" class="fc-error">{{ errorMsg }}</p>

        <div class="fc-actions">
          <button type="button" class="fc-btn-ghost" :disabled="closing" @click="emit('cancel')">إلغاء</button>
          <button type="button" class="fc-btn-danger" :disabled="closing" @click="confirm">
            {{ closing ? 'جاري الإغلاق...' : 'إغلاق إجبارياً' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fc-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center; padding: 1rem;
  background: rgba(6, 9, 15, 0.78); backdrop-filter: blur(6px);
  font-family: 'Tajawal', system-ui, sans-serif;
}
.fc-card {
  width: 100%; max-width: 26rem; max-height: 92dvh; overflow-y: auto;
  padding: 1.25rem 1.25rem 1.5rem; border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(248,113,113,0.10), rgba(255,255,255,0.04));
  border: 1px solid rgba(248,113,113,0.35);
  box-shadow: 0 12px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07);
}
.fc-head { display: flex; gap: 0.75rem; align-items: flex-start; margin-bottom: 1rem; }
.fc-warn-icon { font-size: 1.5rem; color: #F87171; line-height: 1.2; }
.fc-title { font-size: 1.0625rem; font-weight: 800; color: #E8EDF5; margin: 0; }
.fc-sub { font-size: 0.8125rem; color: #93A3B8; margin: 0.25rem 0 0; line-height: 1.5; }
.fc-muted { color: #637285; text-align: center; padding: 1.5rem 0; }

.fc-expected {
  background: rgba(26,86,219,0.08); border: 1px solid rgba(26,86,219,0.22);
  border-radius: 0.875rem; padding: 0.625rem 0.875rem; margin-bottom: 1rem;
}
.fc-exp-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
.fc-label { font-size: 0.8125rem; color: #93A3B8; }
.fc-value { font-size: 0.9375rem; font-weight: 700; color: #E8EDF5; }

.fc-field-label { display: block; font-size: 0.75rem; color: #637285; margin: 0.5rem 0 0.3rem; }
.fc-input-card {
  display: flex; align-items: center; gap: 0.5rem; width: 100%;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem; padding: 0.6rem 0.875rem; transition: border-color 0.15s;
}
.fc-input-card:focus-within { border-color: rgba(26,86,219,0.7); }
.fc-cur { color: #637285; min-width: 2rem; text-align: center; }
.fc-input { flex: 1; background: transparent; border: none; outline: none; color: #E8EDF5; font-size: 1.125rem; font-weight: 700; font-family: inherit; }

.fc-variance {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 0.625rem;
  background: rgba(234,179,8,0.10); border: 1px solid rgba(234,179,8,0.28);
}
.fc-variance .fc-value { color: #FCD34D; }

.fc-textarea {
  width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 0.625rem; padding: 0.5rem 0.625rem; color: #E8EDF5; font-size: 0.8125rem;
  font-family: inherit; resize: vertical; outline: none; transition: border-color 0.15s;
}
.fc-textarea:focus { border-color: rgba(26,86,219,0.55); }

.fc-error { margin: 0.625rem 0 0; font-size: 0.8125rem; color: #FCA5A5; }

.fc-actions { display: flex; gap: 0.625rem; margin-top: 1.25rem; }
.fc-btn-ghost {
  flex: 1; height: 46px; border-radius: 0.75rem; cursor: pointer; font-family: inherit;
  font-size: 0.875rem; font-weight: 600; color: #93A3B8;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
}
.fc-btn-ghost:hover:not(:disabled) { color: #C8D5E8; background: rgba(255,255,255,0.08); }
.fc-btn-danger {
  flex: 2; height: 46px; border-radius: 0.75rem; cursor: pointer; font-family: inherit;
  font-size: 0.9375rem; font-weight: 700; color: #fff; border: none;
  background: linear-gradient(135deg, #DC2626, #B91C1C);
  box-shadow: 0 4px 16px rgba(220,38,38,0.35);
}
.fc-btn-danger:hover:not(:disabled) { opacity: 0.92; }
.fc-btn-danger:disabled, .fc-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
