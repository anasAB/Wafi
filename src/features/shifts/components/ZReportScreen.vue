<script setup lang="ts">
import { ref, computed, onMounted }  from 'vue'
import { useShift }        from '@/features/shifts/composables/useShift'
import { useZReport }      from '@/features/shifts/composables/useZReport'
import { useShiftStore }   from '@/features/shifts/shift.store'
import { useDeviceStore }  from '@/store/device.store'
import { useCan }          from '@/composables/useCan'
import CashCountSheet      from './CashCountSheet.vue'
import type { ZReportMetrics } from '@/features/shifts/shift.types'
import type { CashierShift, DenominationBreakdown }   from '@/features/shifts/shift.types'

const emit = defineEmits<{ (e: 'close'): void }>()

const { loadActiveShift, closeShift } = useShift()
const { compute, printZReport }       = useZReport()
const shiftStore = useShiftStore()
const device     = useDeviceStore()
const { can }    = useCan()

// WAFI-058: the Z-report's money figures (revenue, profit, payment mix,
// per-operator sales, expenses) are a financial roll-up — owner-only by default.
// A staffer without can_view_reports can still COUNT the drawer and close the
// shift: only the cash count and variance stay visible, never the money lines.
// Resolved through the single permission accessor (WAFI-063), keyed off the
// CURRENT operator, so an operator switch re-scopes what's shown and fail-closed
// applies when there is no active operator.
const canViewMoney = can('can_view_reports')

const step       = ref<'cash-count' | 'report'>('cash-count')
const shift      = ref<CashierShift | null>(null)
const metrics    = ref<ZReportMetrics | null>(null)
const cashCountError = ref('')
const closingUsd = ref(0)
const closingSyp = ref(0)
const closingBreakdown = ref<{ usd: DenominationBreakdown | null; syp: DenominationBreakdown | null } | null>(null)
const closing    = ref(false)
// WAFI-060: a close whose variance exceeds 5% must carry a reason note.
const closeNote  = ref('')
const noteError  = ref('')

// |variance| / |expected| per currency. A zero expected with a nonzero variance is
// treated as significant (any unexplained cash is over 5% of nothing).
function exceeds5pct(variance: number, expected: number): boolean {
  if (expected === 0) return variance !== 0
  return Math.abs(variance) / Math.abs(expected) > 0.05
}

// True when either drawer is off by more than 5% — forces a close note (Story 5.5).
const requiresNote = computed(() => {
  if (!metrics.value) return false
  const m = metrics.value
  return exceeds5pct(m.varianceUsd, m.expectedUsd) || exceeds5pct(m.varianceSyp, m.expectedSyp)
})

onMounted(async () => { shift.value = await loadActiveShift() })

async function onCashCounted(
  usd: number,
  syp: number,
  breakdown: { usd: DenominationBreakdown | null; syp: DenominationBreakdown | null },
) {
  if (!shift.value) {
    shift.value = await loadActiveShift()
  }
  if (!shift.value) {
    cashCountError.value = 'لا توجد وردية مفتوحة لهذا الجهاز. افتح وردية أولاً ثم أعد المحاولة.'
    return
  }
  cashCountError.value = ''
  closingUsd.value = usd
  closingSyp.value = syp
  closingBreakdown.value = breakdown
  metrics.value = await compute(shift.value, usd, syp)
  step.value = 'report'
}

async function handleClose(withPrint: boolean) {
  if (!shift.value || !metrics.value) return
  // Block a >5% close until the cashier explains the gap. Never close silently.
  if (requiresNote.value && closeNote.value.trim() === '') {
    noteError.value = 'الفرق يتجاوز 5% — أدخل سبب الفرق قبل الإغلاق.'
    return
  }
  noteError.value = ''
  closing.value = true
  try {
    if (withPrint) {
      printZReport(
        shift.value,
        shiftStore.activeStaff?.name ?? '',
        device.deviceCode,
        metrics.value
      )
    }
    // Persist the immutable evidence with the close: variance per currency, the
    // reason note, and the full Z-report snapshot. Closed-shift reads come back
    // from this snapshot, so later edits can't rewrite history (WAFI-060).
    await closeShift({
      closingCashUsd: closingUsd.value,
      closingCashSyp: closingSyp.value,
      shiftId:        shift.value.id,
      varianceUsd:    metrics.value.varianceUsd,
      varianceSyp:    metrics.value.varianceSyp,
      closeNote:      closeNote.value.trim() || null,
      zReport:        metrics.value,
      closingBreakdown: closingBreakdown.value,
    })
  } finally {
    closing.value = false
  }
}

const fmt    = (n: number) => `$${n.toFixed(2)}`
const fmtSyp = (n: number) => `${n.toLocaleString()} ل.س`
</script>

<template>
  <CashCountSheet
    v-if="step === 'cash-count'"
    :error-message="cashCountError"
    @confirm="onCashCounted"
    @cancel="emit('close')"
  />

  <div v-else-if="step === 'report' && metrics" class="zreport-overlay" dir="rtl">

    <!-- Sticky header bar -->
    <div class="zreport-topbar">
      <div class="zreport-topbar-inner">
        <!-- Abort: shift isn't closed until a footer action is pressed -->
        <button type="button" class="zreport-back" aria-label="رجوع دون إغلاق" @click="emit('close')">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div class="zreport-badge">Z</div>
        <div class="zreport-topbar-text">
          <span class="zreport-title">تقرير الوردية</span>
          <span class="zreport-subtitle">{{ shiftStore.activeStaff?.name }} · {{ new Date(shift!.openedAt).toLocaleTimeString('ar-SY') }}</span>
        </div>
        <div v-if="canViewMoney" class="zreport-hero-stat">
          <span class="zreport-hero-label">إجمالي المبيعات</span>
          <span class="zreport-hero-value">{{ fmt(metrics.totalRevenueUsd) }}</span>
        </div>
      </div>
    </div>

    <div class="zreport-scroll">

      <!-- 2-col grid on desktop, stacked on mobile -->
      <div class="z-grid-top">

        <!-- Col A: shift info + payment breakdown -->
        <div class="z-col">
          <div class="z-card">
            <div class="z-card-header">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
              معلومات الوردية
            </div>
            <div class="z-rows">
              <div class="z-row"><span class="z-label">الكاشير</span><span class="z-value">{{ shiftStore.activeStaff?.name }}</span></div>
              <div class="z-row"><span class="z-label">الجهاز</span><span class="z-value z-value-mono">{{ device.deviceCode }}</span></div>
              <div class="z-row"><span class="z-label">وقت الفتح</span><span class="z-value">{{ new Date(shift!.openedAt).toLocaleTimeString('ar-SY') }}</span></div>
              <div class="z-row"><span class="z-label">المدة</span><span class="z-value">{{ Math.floor(metrics.durationMinutes / 60) }}س {{ metrics.durationMinutes % 60 }}د</span></div>
            </div>
          </div>

          <div v-if="canViewMoney" class="z-card">
            <div class="z-card-header">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
              تفصيل طريقة الدفع
            </div>
            <div class="z-rows">
              <div class="z-row"><span class="z-label">نقد دولار</span><span class="z-value">{{ fmt(metrics.cashUsdSales) }}</span></div>
              <div class="z-row"><span class="z-label">نقد ليرة</span><span class="z-value">{{ fmtSyp(metrics.cashSypSalesRaw) }}</span></div>
              <div class="z-row"><span class="z-label">بطاقة</span><span class="z-value">{{ fmt(metrics.cardSales) }}</span></div>
              <div class="z-row"><span class="z-label">آجل (دين)</span><span class="z-value">{{ fmt(metrics.creditSales) }}</span></div>
            </div>
          </div>
        </div>

        <!-- Col B: sales totals + expenses — financial roll-up, owner-only (WAFI-058) -->
        <div v-if="canViewMoney" class="z-col">
          <div class="z-card">
            <div class="z-card-header">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
              المبيعات
            </div>
            <div class="z-rows">
              <div class="z-row"><span class="z-label">عدد الفواتير</span><span class="z-value">{{ metrics.invoiceCount }}</span></div>
              <div class="z-row z-row-total"><span class="z-label-bold">إجمالي المبيعات</span><span class="z-value-big">{{ fmt(metrics.totalRevenueUsd) }}</span></div>
            </div>
          </div>

          <div class="z-card">
            <div class="z-card-header">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>
              المصاريف
            </div>
            <div class="z-rows">
              <div class="z-row"><span class="z-label">مصاريف الوردية</span><span class="z-value">{{ fmt(metrics.cashExpensesUsd) }}</span></div>
            </div>
          </div>
        </div>

      </div><!-- /z-grid-top -->

      <!-- Money masked for staff without reports access — they still count the
           drawer and close below. Plain note so the screen doesn't look broken. -->
      <div v-if="!canViewMoney" class="z-masked-note">
        الأرقام المالية مخفية. عُدّ النقد وأغلق الوردية — التفاصيل المالية للمالك.
      </div>

      <!-- Sales by operator — per-operator "who sold what" breakdown. A financial
           roll-up, so owner-only by default (WAFI-058). -->
      <div v-if="canViewMoney && metrics.byOperator.length > 1" class="z-card">
        <div class="z-card-header">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
          المبيعات حسب المستخدم
        </div>
        <div class="z-rows">
          <div v-for="op in metrics.byOperator" :key="op.staffId ?? 'unattributed'" class="z-row">
            <span class="z-label">{{ op.name ?? 'غير محدد' }} <span class="z-op-count">({{ op.salesCount }} فاتورة)</span></span>
            <span class="z-value">{{ fmt(op.totalUsd) }}</span>
          </div>
        </div>
      </div>

      <!-- Cash reconciliation — full width below grid -->
      <div class="z-card z-card-recon">
        <div class="z-card-header">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 8.485-7.5 11.9-7.5 11.9s-7.5-3.415-7.5-11.9a7.5 7.5 0 1115 0z" /></svg>
          حساب الصندوق
        </div>

        <!-- Reconciliation 2-col on desktop -->
        <div class="z-recon-grid">
          <div class="z-recon-col">
            <p class="z-recon-col-title">دولار $</p>
            <div class="z-rows">
              <!-- Opening + sales + expenses + expected reveal the shift's money
                   roll-up → owner-only. The counted total and variance always
                   show so any shift-capable staffer can close (WAFI-058). -->
              <template v-if="canViewMoney">
                <div class="z-row"><span class="z-label">رصيد الفتح</span><span class="z-value">{{ fmt(shift!.openingCashUsd) }}</span></div>
                <div class="z-row"><span class="z-label">+ نقد مبيعات</span><span class="z-value z-value-green">{{ fmt(metrics.cashUsdSales) }}</span></div>
                <div class="z-row"><span class="z-label">- مصاريف نقدية</span><span class="z-value z-value-red">{{ fmt(metrics.cashExpensesUsd) }}</span></div>
                <div class="z-divider" />
                <div class="z-row"><span class="z-label">متوقع</span><span class="z-value z-value-bold">{{ fmt(metrics.expectedUsd) }}</span></div>
              </template>
              <div class="z-row"><span class="z-label">عند العد</span><span class="z-value z-value-bold">{{ fmt(metrics.actualUsd) }}</span></div>
            </div>
            <div class="z-variance-row" :class="metrics.varianceUsd < 0 ? 'z-variance-neg' : 'z-variance-pos'">
              <span class="z-variance-label">الفرق</span>
              <span class="z-variance-value">
                {{ metrics.varianceUsd >= 0 ? '+' : '' }}{{ fmt(metrics.varianceUsd) }}
                <span class="z-variance-icon">{{ metrics.varianceUsd < 0 ? '⚠' : '✓' }}</span>
              </span>
            </div>
          </div>

          <div class="z-recon-col z-recon-col-syp">
            <p class="z-recon-col-title">ليرة سورية ل.س</p>
            <div class="z-rows">
              <div v-if="canViewMoney" class="z-row"><span class="z-label">رصيد الفتح</span><span class="z-value">{{ fmtSyp(shift!.openingCashSyp ?? 0) }}</span></div>
              <div v-if="canViewMoney" class="z-row"><span class="z-label">متوقع</span><span class="z-value">{{ fmtSyp(metrics.expectedSyp) }}</span></div>
              <div class="z-row"><span class="z-label">عند العد</span><span class="z-value">{{ fmtSyp(metrics.actualSyp) }}</span></div>
            </div>
            <div class="z-variance-row" :class="metrics.varianceSyp < 0 ? 'z-variance-neg' : 'z-variance-pos'">
              <span class="z-variance-label">الفرق</span>
              <span class="z-variance-value">{{ metrics.varianceSyp >= 0 ? '+' : '' }}{{ fmtSyp(metrics.varianceSyp) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- >5% variance: a reason note is mandatory before the shift can close
           (WAFI-060 / Story 5.5). Shown to whoever is closing, money-access or not. -->
      <div v-if="requiresNote" class="z-note-card">
        <label class="z-note-label" for="z-close-note">سبب الفرق (مطلوب — الفرق يتجاوز 5%)</label>
        <textarea
          id="z-close-note"
          v-model="closeNote"
          class="z-note-input"
          rows="2"
          placeholder="مثال: دفعت سلفة للموظف، أو خطأ في العد..."
          dir="rtl"
        ></textarea>
        <p v-if="noteError" class="z-note-error">{{ noteError }}</p>
      </div>

      <!-- Actions: side by side on desktop. Print is hidden for staff without
           reports access — a printed Z-report carries the masked money figures,
           so they close without printing (the shift still closes). -->
      <div class="z-actions">
        <button v-if="canViewMoney" class="z-btn-primary" :disabled="closing" @click="handleClose(true)">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>
          طباعة وإغلاق
        </button>
        <button
          class="z-btn-ghost"
          :class="{ 'z-btn-ghost--solo': !canViewMoney }"
          :disabled="closing"
          @click="handleClose(false)"
        >
          إغلاق بدون طباعة
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Overlay ── */
.zreport-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #06090F;
  overflow-y: auto;
  font-family: 'Tajawal', system-ui, sans-serif;
  display: flex;
  flex-direction: column;
}

/* ── Sticky top bar ── */
.zreport-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: linear-gradient(180deg, rgba(7,11,20,0.98) 0%, rgba(7,11,20,0.92) 100%);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(26,86,219,0.22);
  flex-shrink: 0;
}

.zreport-topbar-inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.zreport-back {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #637285;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.zreport-back:hover { background: rgba(255, 255, 255, 0.09); color: #C8D5E8; }

.zreport-topbar-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.zreport-hero-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
}

.zreport-hero-label {
  font-size: 10px;
  color: #3D4F6B;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.zreport-hero-value {
  font-size: 20px;
  font-weight: 900;
  color: #E8EDF5;
  font-variant-numeric: tabular-nums;
}

.zreport-scroll {
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 16px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

/* ── 2-col grid (top cards) ── */
.z-grid-top {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.z-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (min-width: 768px) {
  .z-grid-top {
    flex-direction: row;
    align-items: flex-start;
  }
  .z-col {
    flex: 1;
    min-width: 0;
  }
}

/* ── Reconciliation inner grid ── */
.z-recon-grid {
  display: flex;
  flex-direction: column;
}

.z-recon-col {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.z-recon-col-syp {
  border-top: 1px solid rgba(26,86,219,0.15);
  background: rgba(26,86,219,0.05);
}

.z-recon-col-title {
  font-size: 10px;
  font-weight: 700;
  color: #60A5FA;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 6px;
  opacity: 0.75;
}

@media (min-width: 768px) {
  .z-recon-grid {
    flex-direction: row;
  }
  .z-recon-col {
    flex: 1;
    min-width: 0;
  }
  .z-recon-col-syp {
    border-top: none;
    border-inline-start: 1px solid rgba(26,86,219,0.15);
  }
}

/* ── Header (topbar elements) ── */
.zreport-header {
  display: none;
}

.zreport-badge {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 4px 20px rgba(26,86,219,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 900;
  color: white;
  letter-spacing: -0.02em;
  margin-bottom: 4px;
}

.zreport-title {
  font-size: 15px;
  font-weight: 800;
  color: #E8EDF5;
  margin: 0;
}

.zreport-subtitle {
  font-size: 11px;
  color: #3D4F6B;
  margin: 0;
}

.zreport-badge {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 16px;
}

/* ── Card ── */
.z-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.22);
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(26,86,219,0.08);
  overflow: hidden;
}

.z-card-recon {
  border-color: rgba(26,86,219,0.30);
  box-shadow: 0 4px 24px rgba(26,86,219,0.13);
}

.z-card-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 16px 10px;
  font-size: 12px;
  font-weight: 700;
  color: #60A5FA;
  letter-spacing: 0.03em;
  border-bottom: 1px solid rgba(26,86,219,0.15);
  background: rgba(26,86,219,0.07);
}

/* ── Rows ── */
.z-rows {
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.z-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.z-row:last-child { border-bottom: none; }

.z-row-total {
  padding-top: 9px;
  margin-top: 2px;
  border-top: 1px solid rgba(26,86,219,0.18);
  border-bottom: none;
}

.z-label {
  font-size: 13px;
  color: #637285;
}

.z-label-bold {
  font-size: 13px;
  font-weight: 700;
  color: #C8D5E8;
}

.z-op-count {
  font-size: 11px;
  color: #3D4F6B;
}

.z-value {
  font-size: 13px;
  color: #C8D5E8;
  font-weight: 500;
}

.z-value-mono {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #637285;
}

.z-value-big {
  font-size: 16px;
  font-weight: 800;
  color: #E8EDF5;
}

.z-value-bold {
  font-weight: 700;
  color: #E8EDF5;
}

.z-value-green { color: #34D399; font-weight: 600; }
.z-value-red   { color: #F87171; font-weight: 600; }

/* ── Divider ── */
.z-divider {
  height: 1px;
  background: rgba(26,86,219,0.22);
  margin: 4px 0;
}

/* ── Variance row ── */
.z-variance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-radius: 10px;
  margin-top: 4px;
}

.z-variance-pos {
  background: rgba(52,211,153,0.10);
  border: 1px solid rgba(52,211,153,0.22);
}

.z-variance-neg {
  background: rgba(248,113,113,0.10);
  border: 1px solid rgba(248,113,113,0.22);
}

.z-variance-label {
  font-size: 13px;
  font-weight: 700;
  color: #C8D5E8;
}

.z-variance-value {
  font-size: 14px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 5px;
}

.z-variance-pos .z-variance-value { color: #34D399; }
.z-variance-neg .z-variance-value { color: #F87171; }

.z-variance-icon {
  font-size: 13px;
}

/* ── Sub-section (SYP) ── */
.z-sub-section {
  border-top: 1px solid rgba(26,86,219,0.15);
  background: rgba(26,86,219,0.04);
}

/* ── Actions ── */
.z-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}

@media (min-width: 768px) {
  .z-actions {
    flex-direction: row-reverse;
  }
  .z-btn-primary {
    flex: 2;
  }
  .z-btn-ghost {
    flex: 1;
  }
}

.z-btn-primary {
  width: 100%;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 6px 24px rgba(26,86,219,0.50);
  border: none;
  color: white;
  font-size: 15px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.15s, box-shadow 0.15s;
}

.z-btn-primary:hover {
  box-shadow: 0 8px 30px rgba(26,86,219,0.65);
}

.z-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

.z-btn-ghost {
  width: 100%;
  height: 48px;
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.10);
  color: #637285;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.z-btn-ghost:hover {
  background: rgba(255,255,255,0.07);
  color: #C8D5E8;
}

.z-btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }

/* When the print button is hidden (no reports access), the close button is the
   sole, primary action — give it the full primary treatment. */
.z-btn-ghost--solo {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  color: #fff;
  box-shadow: 0 6px 24px rgba(26,86,219,0.50);
}
.z-btn-ghost--solo:hover {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
}

/* ── Close-note (mandatory on >5% variance) ── */
.z-note-card {
  background: rgba(234, 179, 8, 0.07);
  border: 1px solid rgba(234, 179, 8, 0.30);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.z-note-label {
  font-size: 12px;
  font-weight: 700;
  color: #FCD34D;
}
.z-note-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  padding: 8px 10px;
  color: #E8EDF5;
  font-size: 13px;
  font-family: 'Tajawal', system-ui, sans-serif;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}
.z-note-input:focus { border-color: rgba(234, 179, 8, 0.55); }
.z-note-error {
  margin: 0;
  font-size: 12px;
  color: #FCA5A5;
}

/* Note shown in place of the masked money cards. */
.z-masked-note {
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(26,86,219,0.07);
  border: 1px solid rgba(26,86,219,0.20);
  color: #93A3B8;
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}
</style>
