<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useShift } from '@/features/shifts/composables/useShift'
import { useShiftDetail, type ShiftDetailData } from '@/features/shifts/composables/useShiftDetail'
import { useStaff } from '@/features/staff/composables/useStaff'
import { useCan } from '@/composables/useCan'
import { useSessionStore } from '@/store/session.store'
import ForceCloseSheet from '@/features/shifts/components/ForceCloseSheet.vue'
import CashMovementsList from '@/features/shifts/components/CashMovementsList.vue'
import { useCashMovements } from '@/features/shifts/composables/useCashMovements'
import { varianceLevel } from '@/features/shifts/shift.types'
import type { CashierShift } from '@/features/shifts/shift.types'
import type { CashMovement } from '@/features/shifts/cashMovement.types'

const router = useRouter()
const route  = useRoute()
const { loadShiftById } = useShift()
const { loadDetail }    = useShiftDetail()
const { staff, loadStaff } = useStaff()
const session = useSessionStore()
// WAFI-058: money lines in the detail are owner-only; an ungranted staffer sees the
// shift structure (times, cashier, counts) but not the financial figures.
const { can } = useCan()
const canViewMoney = can('can_view_reports')

// WAFI-065: only the owner may force-close an abandoned shift (not a manager) — a
// role rule, deliberately not a permission flag, so it can't widen another grant.
const isOwner = computed(() => session.activeStaff?.role === 'owner')
const showForceClose = ref(false)

// In-shift cash movements (review). Voiding is for the owner/manager from this
// review screen (the recording cashier voids from the live drill-down); voids are
// themselves logged, so this only limits accidental cross-voiding.
const { listForShift, voidMovement } = useCashMovements()
const movements = ref<CashMovement[]>([])
const canVoid = computed(() =>
  session.activeStaff?.role === 'owner' || session.activeStaff?.role === 'manager')

async function loadMovements(shiftId: string) {
  movements.value = await listForShift(shiftId)
}

async function onVoidMovement(movementId: string) {
  if (!shift.value) return
  await voidMovement(movementId, 'تصحيح من شاشة الوردية')
  await loadMovements(shift.value.id)
}

const shift   = ref<CashierShift | null>(null)
const detail  = ref<ShiftDetailData | null>(null)
const loading = ref(true)
const notFound = ref(false)

// Collapsible sections — sales open by default, the rest collapsed to keep a long
// shift readable on a cheap phone.
const open = ref({ sales: true, expenses: false, payments: false })

onMounted(async () => {
  loading.value = true
  try {
    await loadStaff()
    const s = await loadShiftById(route.params.id as string)
    if (!s) { notFound.value = true; return }
    shift.value  = s
    detail.value = await loadDetail(s)
    await loadMovements(s.id)
  } finally {
    loading.value = false
  }
})

const staffName = computed(() => {
  const map: Record<string, string> = {}
  for (const s of staff.value) map[s.id] = s.name
  return (id: string | null) => (id ? map[id] ?? '—' : '—')
})

const isOpen      = computed(() => shift.value?.status === 'open')
const isAbandoned = computed(() => shift.value?.status === 'abandoned')

// After a force-close, re-read the now-closed shift so the screen reflects the
// recorded count, variance, snapshot, and force-closed note.
async function onForceClosed() {
  showForceClose.value = false
  const s = await loadShiftById(route.params.id as string)
  if (s) {
    shift.value  = s
    detail.value = await loadDetail(s)
    await loadMovements(s.id)
  }
}

// Closed shifts read the WAFI-060 snapshot (immutable, consistent with reprint);
// open shifts have no snapshot yet → live/partial detail labelled "مفتوحة".
const z = computed(() => shift.value?.zReportData ?? null)

const durationLabel = computed(() => {
  if (!shift.value) return ''
  const end = shift.value.closedAt ? new Date(shift.value.closedAt).getTime() : Date.now()
  const mins = Math.floor((end - new Date(shift.value.openedAt).getTime()) / 60_000)
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}س ${mins % 60}د` : `${mins}د`
})

const fmtUsd = (n: number) => `$${n.toFixed(2)}`
const fmtSyp = (n: number) => `${n.toLocaleString('en-US')} ل.س`
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('ar-SY-u-nu-latn', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const methodLabel: Record<string, string> = {
  cash_usd: 'نقد دولار', cash_syp: 'نقد ليرة', card: 'بطاقة',
  credit: 'آجل', split: 'مقسّم', cash: 'نقد', transfer: 'حوالة', usdt: 'USDT', hawala: 'حوالة',
}

// Variance colour for the USD drawer (the SYP figure mirrors it in the snapshot).
const varClass = computed(() => {
  if (!shift.value || shift.value.varianceUsd == null || !z.value) return 'v-match'
  const level = varianceLevel(shift.value.varianceUsd, z.value.expectedUsd)
  return level === 'alert' ? 'v-alert' : level === 'warn' ? 'v-warn' : 'v-match'
})
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="تفاصيل الوردية" @back="router.back()" />

    <main class="page-main">
      <div v-if="loading" class="muted">جاري التحميل...</div>
      <div v-else-if="notFound" class="muted">لم يتم العثور على الوردية.</div>

      <template v-else-if="shift">
        <!-- Header card -->
        <div class="card">
          <div class="card-top">
            <span class="cashier">{{ staffName(shift.staffId) }}</span>
            <span v-if="isOpen" class="badge badge-open">مفتوحة</span>
            <span v-else-if="isAbandoned" class="badge badge-abandoned">متروكة</span>
            <span v-else class="badge badge-closed">مغلقة</span>
          </div>
          <div class="meta-grid">
            <div><span class="meta-label">الفتح</span><span class="meta-value">{{ fmtDateTime(shift.openedAt) }}</span></div>
            <div><span class="meta-label">الإغلاق</span><span class="meta-value">{{ shift.closedAt ? fmtDateTime(shift.closedAt) : '—' }}</span></div>
            <div><span class="meta-label">المدة</span><span class="meta-value">{{ durationLabel }}</span></div>
            <div><span class="meta-label">رصيد الفتح</span><span class="meta-value" dir="ltr">{{ fmtSyp(shift.openingCashSyp ?? 0) }} · {{ fmtUsd(shift.openingCashUsd) }}</span></div>
          </div>

          <!-- Owner force-close (WAFI-065): only for an open shift, owner only. The
               cashier abandoned it without counting, so the owner closes it on the
               record (force_closed_by + audit + snapshot), never silently. -->
          <div v-if="isOpen && isOwner" class="force-close-bar">
            <p class="force-close-hint">هذه الوردية ما زالت مفتوحة. أغلقها إجبارياً إذا غادر الكاشير دون إغلاقها.</p>
            <button type="button" class="force-close-btn" @click="showForceClose = true">
              إغلاق إجبارياً
            </button>
          </div>
        </div>

        <!-- Z-report section (closed: snapshot; open: partial note) -->
        <div class="card">
          <p class="section-title">تقرير الوردية</p>
          <p v-if="isOpen" class="muted small">الوردية ما زالت مفتوحة — تظهر التفاصيل الكاملة بعد الإغلاق.</p>
          <p v-else-if="!canViewMoney" class="muted small">الأرقام المالية مخفية — للمالك فقط.</p>
          <div v-else-if="z" class="z-rows">
            <div class="z-row"><span class="meta-label">عدد الفواتير</span><span class="meta-value">{{ z.invoiceCount }}</span></div>
            <div class="z-row"><span class="meta-label">إجمالي المبيعات</span><span class="meta-value">{{ fmtUsd(z.totalRevenueUsd) }}</span></div>
            <div class="z-row"><span class="meta-label">نقد دولار / ليرة</span><span class="meta-value" dir="ltr">{{ fmtUsd(z.cashUsdSales) }} · {{ fmtSyp(z.cashSypSalesRaw) }}</span></div>
            <div class="z-row"><span class="meta-label">بطاقة / آجل</span><span class="meta-value" dir="ltr">{{ fmtUsd(z.cardSales) }} · {{ fmtUsd(z.creditSales) }}</span></div>
            <div class="z-row variance" :class="varClass">
              <span class="meta-label">الفرق (دولار / ليرة)</span>
              <span class="meta-value" dir="ltr">
                {{ z.varianceUsd >= 0 ? '+' : '' }}{{ fmtUsd(z.varianceUsd) }} ·
                {{ z.varianceSyp >= 0 ? '+' : '' }}{{ fmtSyp(z.varianceSyp) }}
              </span>
            </div>
          </div>
          <p v-else class="muted small">لا يوجد تقرير محفوظ لهذه الوردية.</p>

          <!-- Cashier note (reason for variance) -->
          <div v-if="shift.closeNote" class="note-box">
            <span class="meta-label">ملاحظة الكاشير</span>
            <p class="note-text">{{ shift.closeNote }}</p>
          </div>
        </div>

        <!-- In-shift cash movements (pay-ins / pay-outs / drops). Amount-gated by
             can_view_reports, consistent with the Z-report block (WAFI-058). -->
        <div v-if="canViewMoney" class="card">
          <p class="section-title">الحركات النقدية</p>
          <div class="movements-wrap">
            <CashMovementsList
              :movements="movements"
              :can-void="canVoid"
              @void="onVoidMovement"
            />
          </div>
        </div>

        <!-- Sales -->
        <div class="card">
          <button type="button" class="section-toggle" @click="open.sales = !open.sales">
            <span>المبيعات ({{ detail?.sales.length ?? 0 }})</span>
            <span>{{ open.sales ? '▲' : '▼' }}</span>
          </button>
          <div v-if="open.sales" class="list">
            <button
              v-for="sale in detail?.sales"
              :key="sale.id"
              type="button"
              class="list-row list-row--link"
              @click="router.push('/history')"
            >
              <div class="row-main">
                <span class="row-title">{{ sale.displayNumber }}</span>
                <span class="row-sub">{{ fmtDateTime(sale.createdAt) }} · {{ staffName(sale.staffId) }}</span>
              </div>
              <div class="row-end">
                <span v-if="canViewMoney" class="row-amount">{{ fmtUsd(sale.totalUsd) }}</span>
                <span class="row-method">{{ methodLabel[sale.paymentMethod] ?? sale.paymentMethod }}</span>
              </div>
            </button>
            <p v-if="!detail?.sales.length" class="muted small pad">لا توجد مبيعات.</p>
          </div>
        </div>

        <!-- Expenses -->
        <div class="card">
          <button type="button" class="section-toggle" @click="open.expenses = !open.expenses">
            <span>المصاريف ({{ detail?.expenses.length ?? 0 }})</span>
            <span>{{ open.expenses ? '▲' : '▼' }}</span>
          </button>
          <div v-if="open.expenses" class="list">
            <div v-for="exp in detail?.expenses" :key="exp.id" class="list-row">
              <div class="row-main">
                <span class="row-title">{{ exp.category }}</span>
                <span class="row-sub">{{ fmtDateTime(exp.createdAt) }}</span>
              </div>
              <span v-if="canViewMoney" class="row-amount" dir="ltr">
                {{ exp.currency === 'SYP' ? fmtSyp(exp.amount) : fmtUsd(exp.amount) }}
              </span>
            </div>
            <p v-if="!detail?.expenses.length" class="muted small pad">لا توجد مصاريف.</p>
          </div>
        </div>

        <!-- Customer payments -->
        <div class="card">
          <button type="button" class="section-toggle" @click="open.payments = !open.payments">
            <span>تحصيل ديون العملاء ({{ detail?.payments.length ?? 0 }})</span>
            <span>{{ open.payments ? '▲' : '▼' }}</span>
          </button>
          <div v-if="open.payments" class="list">
            <div v-for="pay in detail?.payments" :key="pay.id" class="list-row">
              <div class="row-main">
                <span class="row-title">{{ pay.customerName ?? 'عميل' }}</span>
                <span class="row-sub">{{ fmtDateTime(pay.createdAt) }} · {{ methodLabel[pay.method] ?? pay.method }}</span>
              </div>
              <span v-if="canViewMoney" class="row-amount" dir="ltr">
                {{ pay.currency === 'SYP' ? fmtSyp(pay.amountRaw) : fmtUsd(pay.amountRaw) }}
              </span>
            </div>
            <p v-if="!detail?.payments.length" class="muted small pad">لا يوجد تحصيل.</p>
          </div>
        </div>
      </template>
    </main>

    <Teleport to="body">
      <ForceCloseSheet
        v-if="showForceClose && shift && session.activeStaff"
        :shift="shift"
        :forced-by="session.activeStaff"
        @done="onForceClosed"
        @cancel="showForceClose = false"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.page-root { display: flex; flex-direction: column; min-height: 100dvh; background: #06090F; font-family: 'Tajawal', system-ui, sans-serif; }
.page-main { flex: 1; padding: 16px; max-width: 720px; margin: 0 auto; width: 100%; padding-bottom: 80px; display: flex; flex-direction: column; gap: 12px; }

.muted { color: #637285; text-align: center; padding: 24px 0; }
.small { font-size: 0.8125rem; }
.pad { padding: 12px 16px; }

.card {
  border-radius: 1rem; overflow: hidden;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.card-top { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.cashier { font-size: 1rem; font-weight: 700; color: #E8EDF5; }

.badge { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
.badge-open { background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34,197,94,0.35); color: #22C55E; }
.badge-closed { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10); color: #637285; }
.badge-abandoned { background: rgba(248,113,113,0.12); border: 1px solid rgba(248,113,113,0.30); color: #F87171; }

/* ─── Owner force-close bar (WAFI-065) ─────────────────────── */
.force-close-bar { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.force-close-hint { margin: 0; font-size: 0.78rem; color: #93A3B8; line-height: 1.5; }
.force-close-btn {
  align-self: flex-start; padding: 8px 16px; border-radius: 0.75rem; cursor: pointer;
  font-family: inherit; font-size: 0.8125rem; font-weight: 700; color: #FCA5A5;
  background: rgba(248,113,113,0.10); border: 1px solid rgba(248,113,113,0.32);
  transition: background 0.15s, color 0.15s;
}
.force-close-btn:hover { background: rgba(248,113,113,0.18); color: #FECACA; }

.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; padding: 8px 16px 16px; }
.meta-grid > div { display: flex; flex-direction: column; gap: 2px; }
.meta-label { font-size: 0.7rem; color: #637285; }
.meta-value { font-size: 0.875rem; font-weight: 600; color: #E8EDF5; }

.section-title { font-size: 0.8125rem; font-weight: 700; color: #60A5FA; padding: 14px 16px 6px; margin: 0; }

.movements-wrap { padding: 4px 16px 14px; }

.z-rows { padding: 4px 16px 12px; display: flex; flex-direction: column; }
.z-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.z-row:last-child { border-bottom: none; }
.z-row.variance { margin-top: 6px; padding: 9px 12px; border-radius: 10px; border-bottom: none; }
.v-match { background: rgba(52,211,153,0.10); border: 1px solid rgba(52,211,153,0.22); }
.v-warn  { background: rgba(234,179,8,0.10);  border: 1px solid rgba(234,179,8,0.28); }
.v-alert { background: rgba(248,113,113,0.10); border: 1px solid rgba(248,113,113,0.24); }
.v-match .meta-value { color: #34D399; }
.v-warn  .meta-value { color: #FCD34D; }
.v-alert .meta-value { color: #F87171; }

.note-box { margin: 0 16px 16px; padding: 10px 12px; border-radius: 10px; background: rgba(234,179,8,0.07); border: 1px solid rgba(234,179,8,0.25); display: flex; flex-direction: column; gap: 4px; }
.note-text { margin: 0; font-size: 0.875rem; color: #E8EDF5; line-height: 1.5; }

.section-toggle {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; background: transparent; border: none; cursor: pointer;
  font-family: inherit; font-size: 0.875rem; font-weight: 700; color: #C8D5E8;
}

.list { border-top: 1px solid rgba(26,86,219,0.14); }
.list-row { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.04); background: transparent; font-family: inherit; text-align: right; }
.list-row:last-child { border-bottom: none; }
.list-row--link { cursor: pointer; border-inline: none; }
.list-row--link:hover { background: rgba(26,86,219,0.06); }
.row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row-title { font-size: 0.875rem; font-weight: 600; color: #E8EDF5; }
.row-sub { font-size: 0.75rem; color: #637285; }
.row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.row-amount { font-size: 0.875rem; font-weight: 700; color: #E8EDF5; }
.row-method { font-size: 0.72rem; color: #637285; }
</style>
