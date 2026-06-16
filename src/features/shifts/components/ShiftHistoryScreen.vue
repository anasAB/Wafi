<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import ZReportScreen from '@/features/shifts/components/ZReportScreen.vue'
import { useShift } from '@/features/shifts/composables/useShift'
import { useStaff } from '@/features/staff/composables/useStaff'
import type { CashierShift } from '@/features/shifts/shift.types'

const router = useRouter()
const { loadShiftHistory } = useShift()
const { staff, loadStaff } = useStaff()
const shifts  = ref<CashierShift[]>([])
const loading = ref(false)
// Opens the same Z-report / close-shift flow the sidebar uses (BUG-012 new list).
const showZReport = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    await loadStaff()
    shifts.value = await loadShiftHistory()
  } finally { loading.value = false }
})

const staffMap = computed(() => {
  const m: Record<string, string> = {}
  for (const s of staff.value) m[s.id] = s.name
  return m
})

function staffName(id: string): string {
  return staffMap.value[id] ?? '—'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' })
}
function fmtDuration(s: CashierShift): string {
  if (!s.closedAt) return 'جارية'
  const ms    = new Date(s.closedAt).getTime() - new Date(s.openedAt).getTime()
  const mins  = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  return hours > 0 ? `${hours}س ${mins % 60}د` : `${mins}د`
}

function variance(s: CashierShift): number | null {
  if (s.closingCashUsd === null || s.closingCashUsd === undefined) return null
  return s.closingCashUsd - s.openingCashUsd
}

const openShifts   = computed(() => shifts.value.filter(s => s.status === 'open'))
const closedShifts = computed(() => shifts.value.filter(s => s.status !== 'open'))

const totalHours = computed(() => {
  let mins = 0
  for (const s of closedShifts.value) {
    if (!s.closedAt) continue
    mins += Math.floor((new Date(s.closedAt).getTime() - new Date(s.openedAt).getTime()) / 60_000)
  }
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}س ${mins % 60}د` : `${mins}د`
})
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="سجل الورديات" :show-back="true" @back="router.push('/')" />

    <!-- Stats summary bar (desktop) -->
    <div v-if="!loading && shifts.length > 0" class="stats-bar hidden lg:flex">
      <div class="stat-cell">
        <span class="stat-label">إجمالي الورديات</span>
        <span class="stat-value">{{ shifts.length }}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-cell">
        <span class="stat-label">مفتوحة الآن</span>
        <span class="stat-value" :style="openShifts.length > 0 ? 'color: #22C55E' : 'color: #637285'">
          {{ openShifts.length }}
        </span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-cell">
        <span class="stat-label">مغلقة</span>
        <span class="stat-value">{{ closedShifts.length }}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-cell">
        <span class="stat-label">إجمالي الوقت</span>
        <span class="stat-value">{{ totalHours }}</span>
      </div>
    </div>

    <main class="page-main">

      <!-- Loading skeletons -->
      <div v-if="loading" class="skeleton-list">
        <div v-for="i in 3" :key="i" class="skeleton-card"></div>
      </div>

      <!-- Empty state -->
      <div v-else-if="shifts.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <svg class="empty-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="empty-title">لا توجد ورديات مسجّلة</p>
        <p class="empty-sub">ستظهر الورديات هنا بعد فتح أول وردية</p>
      </div>

      <template v-else>

        <!-- Open shifts section -->
        <div v-if="openShifts.length > 0" class="section-group">
          <p class="section-label">وردية مفتوحة</p>
          <div class="shifts-grid">
            <div
              v-for="s in openShifts"
              :key="s.id"
              class="shift-card shift-card--open"
            >
              <!-- Top: status + date -->
              <div class="shift-card-top">
                <div class="open-status">
                  <span class="live-dot"></span>
                  <span class="open-label">مفتوحة</span>
                </div>
                <span class="shift-date">{{ fmtDate(s.openedAt) }}</span>
              </div>

              <!-- Time row -->
              <div class="shift-time-row">
                <div class="shift-time-info">
                  <svg class="time-icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>بدأت {{ fmtTime(s.openedAt) }}</span>
                </div>
                <span class="badge-ongoing">جارية</span>
              </div>

              <!-- Stats bar -->
              <div class="shift-stats-bar">
                <div class="shift-stat">
                  <span class="stat-tiny-label">الكاشير</span>
                  <span class="stat-tiny-value">{{ staffName(s.staffId) }}</span>
                </div>
                <template v-if="s.openingCashUsd !== null && s.openingCashUsd !== undefined">
                  <div class="stat-tiny-divider"></div>
                  <div class="shift-stat">
                    <span class="stat-tiny-label">فتح بـ</span>
                    <span class="stat-tiny-value" dir="ltr">${{ (s.openingCashUsd ?? 0).toFixed(2) }}</span>
                  </div>
                </template>
                <div class="stat-tiny-divider"></div>
                <div class="shift-stat">
                  <span class="stat-tiny-label">مدة</span>
                  <span class="stat-tiny-value">{{ fmtDuration(s) }}</span>
                </div>
              </div>

              <!-- Close-shift action, right on the card (BUG-012 new list) -->
              <div class="shift-card-action">
                <button type="button" class="close-shift-cta" @click="showZReport = true">
                  إغلاق الوردية
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Closed shifts section -->
        <div v-if="closedShifts.length > 0" class="section-group">
          <p class="section-label">ورديات سابقة</p>
          <div class="shifts-grid shifts-grid--closed">
            <div
              v-for="s in closedShifts"
              :key="s.id"
              class="shift-card"
            >
              <!-- Top row -->
              <div class="shift-card-top">
                <span class="shift-date shift-date--primary">{{ fmtDate(s.openedAt) }}</span>
                <span class="badge-closed">مغلقة</span>
              </div>

              <!-- Time range -->
              <div class="shift-time-range">
                <svg class="time-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{{ fmtTime(s.openedAt) }}</span>
                <span class="range-sep">—</span>
                <span>{{ s.closedAt ? fmtTime(s.closedAt) : '...' }}</span>
                <span class="range-dot">·</span>
                <span>{{ fmtDuration(s) }}</span>
              </div>

              <!-- Stats bar -->
              <div class="shift-stats-bar">
                <div class="shift-stat">
                  <span class="stat-tiny-label">الكاشير</span>
                  <span class="stat-tiny-value">{{ staffName(s.staffId) }}</span>
                </div>

                <template v-if="s.closingCashUsd !== null && s.closingCashUsd !== undefined">
                  <div class="stat-tiny-divider"></div>
                  <div class="shift-stat">
                    <span class="stat-tiny-label">النقد</span>
                    <span class="stat-tiny-value" dir="ltr">${{ s.closingCashUsd.toFixed(2) }}</span>
                  </div>
                </template>

                <template v-if="variance(s) !== null && variance(s) !== 0">
                  <div class="stat-tiny-divider"></div>
                  <div class="shift-stat">
                    <span class="stat-tiny-label">الفرق</span>
                    <span
                      class="stat-tiny-value"
                      dir="ltr"
                      :style="variance(s)! < 0 ? 'color: #EF4444' : 'color: #22C55E'"
                    >
                      {{ variance(s)! > 0 ? '+' : '' }}${{ variance(s)!.toFixed(2) }}
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

      </template>
    </main>

    <Teleport to="body">
      <ZReportScreen v-if="showZReport" />
    </Teleport>
  </div>
</template>

<style scoped>
/* ─── Layout ─────────────────────────────────────────────── */
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.page-main {
  flex: 1;
  padding: 20px 16px;
  width: 100%;
  padding-bottom: 80px;
}

@media (min-width: 1024px) {
  .page-main { padding: 24px; }
}

/* ─── Stats bar (desktop) ─────────────────────────────────── */
.stats-bar {
  align-items: stretch;
  margin: 20px 24px 0;
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.stat-cell {
  flex: 1;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 0.75rem;
  color: #637285;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #E8EDF5;
}

.stat-divider {
  width: 1px;
  background: rgba(26, 86, 219, 0.14);
}

/* ─── Loading skeletons ───────────────────────────────────── */
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-card {
  height: 112px;
  border-radius: 1rem;
  background: rgba(26, 86, 219, 0.07);
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ─── Empty state ─────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  gap: 12px;
  color: #637285;
}

.empty-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 86, 219, 0.08);
  border: 1px solid rgba(26, 86, 219, 0.18);
}

.empty-icon { width: 32px; height: 32px; color: #3D4F6B; }

.empty-title {
  font-size: 1rem;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0;
}

.empty-sub {
  font-size: 0.875rem;
  color: #637285;
  margin: 0;
}

/* ─── Section groups ──────────────────────────────────────── */
.section-group { margin-bottom: 24px; }

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0 4px;
  margin-bottom: 12px;
}

/* ─── Shifts grid ─────────────────────────────────────────── */
.shifts-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 1024px) {
  .shifts-grid { grid-template-columns: 1fr 1fr; }
  .shifts-grid--closed { grid-template-columns: 1fr 1fr 1fr; }
}

/* ─── Shift card ──────────────────────────────────────────── */
.shift-card {
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  transition: border-color 0.2s;
}

.shift-card:hover { border-color: rgba(26, 86, 219, 0.45); }

.shift-card--open {
  border-color: rgba(34, 197, 94, 0.35);
  box-shadow: 0 4px 20px rgba(34, 197, 94, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

/* ─── Shift card sections ─────────────────────────────────── */
.shift-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 8px;
}

.shift-time-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 12px;
}

.shift-time-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  color: #E8EDF5;
}

.shift-time-range {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.875rem;
  color: #637285;
  padding: 0 16px 12px;
}

.time-icon {
  width: 14px;
  height: 14px;
  color: #637285;
  flex-shrink: 0;
}

.range-sep, .range-dot {
  color: #3D4F6B;
}

/* ─── Open status ─────────────────────────────────────────── */
.open-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22C55E;
  animation: blink 1.5s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.open-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #22C55E;
}

/* ─── Date labels ─────────────────────────────────────────── */
.shift-date {
  font-size: 0.75rem;
  color: #637285;
}

.shift-date--primary {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

/* ─── Badges ──────────────────────────────────────────────── */
.badge-ongoing {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(26, 86, 219, 0.15);
  border: 1px solid rgba(26, 86, 219, 0.35);
  color: #60A5FA;
}

.badge-closed {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: #637285;
}

/* ─── Shift stats bar ─────────────────────────────────────── */
.shift-stats-bar {
  display: flex;
  align-items: stretch;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
}

.shift-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 4px;
}

.stat-tiny-label {
  font-size: 0.7rem;
  color: #637285;
  margin-bottom: 2px;
}

.stat-tiny-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

.stat-tiny-divider {
  width: 1px;
  background: rgba(26, 86, 219, 0.14);
}

/* ─── Close-shift action ──────────────────────────────────── */
.shift-card-action {
  padding: 10px 16px 14px;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
}
.close-shift-cta {
  width: 100%;
  height: 40px;
  border-radius: 0.75rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  /* Routine end-of-day action — primary, not destructive red (BUG-014 new list). */
  color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border: none;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.35);
  transition: opacity 0.15s, transform 0.1s;
}
.close-shift-cta:hover { opacity: 0.9; }
.close-shift-cta:active { transform: scale(0.98); }
</style>
