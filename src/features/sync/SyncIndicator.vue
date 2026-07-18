<script setup lang="ts">
import { ref } from 'vue'
import { useSync } from './useSync'
import type { DeadLetterEntry } from '@/data/powersync/dead-letter'
import SyncBadge from '@/components/ui/SyncBadge.vue'
import ConnectionPill from '@/components/ui/ConnectionPill.vue'

const {
  status, pendingCount, blockedCount, lastSyncedAt, isStale, errorMessage, syncNow,
  deadLetter, refreshDeadLetter, retryBlocked, discardBlocked,
  canRetryBlocked, canDiscardBlocked,
} = useSync()

const panelOpen = ref(false)
const syncing   = ref(false)
const busyId        = ref<string | null>(null)        // op currently being retried/discarded
const confirmId     = ref<string | null>(null)        // op awaiting discard confirmation
const itemMessage   = ref<Record<string, string>>({}) // inline per-op retry feedback

// Owner-language labels for the table an op belongs to — avoids exposing raw
// table names in the panel.
const TABLE_LABELS: Record<string, string> = {
  sales: 'بيع', sale_line_items: 'بند بيع', sale_payments: 'دفعة بيع',
  customer_payments: 'دفعة عميل', customers: 'عميل', expenses: 'مصروف',
  products: 'منتج', returns: 'مرتجع', return_line_items: 'بند مرتجع',
  exchange_rates: 'سعر صرف', stock_adjustments: 'تعديل مخزون', suppliers: 'مورد',
  stock_receivings: 'استلام بضاعة', cashier_shifts: 'وردية', staff: 'موظف',
  receipt_settings: 'إعدادات الإيصال',
}
function opLabel(e: DeadLetterEntry): string {
  return TABLE_LABELS[e.table_name] ?? e.table_name
}

// The discard confirm must show exactly what will be dropped (WAFI-135).
function formatFailedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SY', {
      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
    }).format(new Date(iso))
  } catch { return iso }
}

function formatLastSync(d: Date | null): string {
  if (!d) return 'لم تتم المزامنة بعد'
  return new Intl.DateTimeFormat('ar-SY', {
    hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
  }).format(d)
}

async function togglePanel() {
  panelOpen.value = !panelOpen.value
  if (panelOpen.value) await refreshDeadLetter()
}

async function handleSyncNow() {
  syncing.value = true
  try {
    await syncNow()
  } finally {
    syncing.value = false
  }
}

async function onRetry(id: string) {
  busyId.value = id
  confirmId.value = null
  try {
    const result = await retryBlocked(id)
    if (result.status === 'still-blocked') itemMessage.value[id] = 'ما زال الخادم يرفضها — راجع السبب أعلاه'
    else if (result.status === 'transient') itemMessage.value[id] = 'تعذّر الاتصال — أعد المحاولة بعد عودة الإنترنت'
    // 'recovered' → the op leaves the list on refresh, no message needed.
  } finally {
    busyId.value = null
  }
}

async function onDiscard(id: string) {
  // Discarding permanently drops a write that may be a sale — require a confirm tap.
  if (confirmId.value !== id) { confirmId.value = id; return }
  busyId.value = id
  try {
    await discardBlocked(id)
  } finally {
    busyId.value = null
    confirmId.value = null
  }
}
</script>

<template>
  <!-- Tappable badge -->
  <button
    type="button"
    aria-label="فتح لوحة المزامنة"
    :aria-expanded="panelOpen"
    class="sync-trigger"
    @click="togglePanel"
  >
    <!-- Always-visible indicator reflects TRUE network state (honest in
         local-only mode). The sync-only SyncBadge stays in the panel below. -->
    <ConnectionPill />
    <!-- Blocked is a distinct state from offline: writes the server rejected and
         that won't drain on their own — surface it first and most prominently. -->
    <p v-if="(blockedCount ?? 0) > 0" role="alert" class="sync-trigger-note sync-trigger-note--blocked">⚠ {{ blockedCount }} معاملة متوقفة — بحاجة لمراجعة</p>
    <p v-if="isStale" role="alert" class="sync-trigger-note sync-trigger-note--warn">لم تتم المزامنة منذ 24 ساعة</p>
    <p v-if="errorMessage" role="alert" class="sync-trigger-note sync-trigger-note--error">{{ errorMessage }}</p>
  </button>

  <!-- Invisible overlay to catch outside clicks -->
  <Transition name="sync-overlay-fade">
    <div
      v-if="panelOpen"
      class="sync-overlay"
      @click="panelOpen = false"
    />
  </Transition>

  <!-- Detail panel -->
  <Transition name="sync-panel-pop">
    <div
      v-if="panelOpen"
      class="sync-panel"
    >
      <div class="sync-panel-inner" dir="rtl">
        <div class="sync-panel-head">
          <p class="sync-title">حالة المزامنة</p>
          <SyncBadge :status="status" :pending-count="pendingCount" :blocked-count="blockedCount" />
        </div>

      <div class="sync-info-row">
        <span class="sync-info-label">آخر مزامنة</span>
        <span class="sync-info-value">{{ formatLastSync(lastSyncedAt) }}</span>
      </div>

      <div v-if="(pendingCount ?? 0) > 0" class="sync-info-row">
        <span class="sync-info-label">في الانتظار</span>
        <span class="sync-info-value sync-info-value--warn">{{ pendingCount }} معاملة</span>
      </div>

      <div v-if="errorMessage" class="sync-error-box">
        {{ errorMessage }}
      </div>

      <!-- Quarantined (poison) ops: rejected by the server, preserved here so no
           write is ever lost. The owner resolves each one — retry after fixing
           the cause, or discard. -->
      <div v-if="deadLetter.length > 0" class="sync-blocked">
        <p class="sync-blocked-title">معاملات متوقفة عن المزامنة</p>
        <!-- Role gating (WAFI-135): retry = owner/manager; discard = owner only.
             A cashier sees the count and a "needs owner review" notice — no actions. -->
        <p v-if="canRetryBlocked" class="sync-blocked-help">رفضها الخادم ولم تُحذف. أعد المحاولة بعد حل السبب{{ canDiscardBlocked ? '، أو احذفها' : '' }}.</p>
        <p v-else class="sync-blocked-help">رفضها الخادم ولم تُحذف — بحاجة لمراجعة المالك.</p>

        <ul class="sync-blocked-list">
          <li v-for="e in deadLetter" :key="e.id" class="sync-blocked-item">
            <div class="sync-blocked-meta">
              <span class="sync-blocked-op">{{ opLabel(e) }}</span>
              <span class="sync-blocked-reason">{{ e.error_message }}</span>
              <span v-if="itemMessage[e.id]" class="sync-blocked-feedback">{{ itemMessage[e.id] }}</span>
              <span v-if="confirmId === e.id" class="sync-blocked-confirm">
                سيتم حذف هذه المعاملة نهائياً ولن تصل إلى الخادم:
                {{ opLabel(e) }} · {{ formatFailedAt(e.failed_at) }} · السبب: {{ e.error_message }}
              </span>
            </div>
            <div v-if="canRetryBlocked" class="sync-blocked-buttons">
              <button
                type="button"
                class="sync-mini-btn sync-mini-btn--retry"
                :disabled="busyId === e.id"
                @click="onRetry(e.id)"
              >إعادة المحاولة</button>
              <button
                v-if="canDiscardBlocked"
                type="button"
                class="sync-mini-btn sync-mini-btn--discard"
                :disabled="busyId === e.id"
                @click="onDiscard(e.id)"
              >{{ confirmId === e.id ? 'تأكيد الحذف' : 'حذف' }}</button>
            </div>
          </li>
        </ul>
      </div>

        <div class="sync-actions">
          <button
            type="button"
            :disabled="syncing || status === 'syncing'"
            class="sync-btn sync-btn--primary"
            @click="handleSyncNow"
          >
            {{ syncing || status === 'syncing' ? 'جارٍ المزامنة...' : 'مزامنة الآن' }}
          </button>
          <button
            type="button"
            class="sync-btn sync-btn--ghost"
            @click="panelOpen = false"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sync-trigger {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  border-radius: 10px;
  padding: 2px 4px;
  transition: background .2s ease;
}

.sync-trigger:hover {
  background: rgba(26, 86, 219, 0.08);
}

.sync-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(26, 86, 219, .45);
}

.sync-trigger-note {
  margin: 0;
  max-width: 220px;
  font-size: 11px;
  line-height: 1.2;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sync-trigger-note--warn { color: #F59E0B; }
.sync-trigger-note--error { color: #EF4444; }
.sync-trigger-note--blocked { color: #FBBF24; font-weight: 700; }

.sync-overlay {
  position: fixed;
  inset: 0;
  z-index: 35;
  background: rgba(1, 5, 14, 0.45);
  backdrop-filter: blur(1.5px);
}

.sync-panel {
  position: fixed;
  top: 64px;
  bottom: 10px;
  inset-inline-start: 10px;
  inset-inline-end: 10px;
  z-index: 40;
  border-radius: 14px;
  border: 1px solid rgba(26, 86, 219, 0.28);
  background: linear-gradient(145deg, rgba(9, 16, 31, .97), rgba(6, 12, 24, .97));
  box-shadow: 0 16px 40px rgba(3, 8, 20, 0.7), inset 0 1px 0 rgba(255,255,255,.06);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@media (min-width: 1024px) {
  .sync-panel {
    top: 74px;
    bottom: auto;
    inset-inline-start: auto;
    inset-inline-end: 18px;
    width: 360px;
    max-height: calc(100vh - 94px);
  }
}

.sync-panel-inner {
  padding: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.sync-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.sync-title {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: #E8EDF5;
}

.sync-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.sync-info-row:last-of-type {
  border-bottom: none;
}

.sync-info-label {
  font-size: 12px;
  color: #7E90AA;
}

.sync-info-value {
  font-size: 13px;
  font-weight: 700;
  color: #DCE5F2;
}

.sync-info-value--warn {
  color: #FBBF24;
}

.sync-error-box {
  margin-top: 10px;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.38);
  background: rgba(127, 29, 29, 0.24);
  color: #FCA5A5;
  font-size: 12px;
  line-height: 1.35;
  padding: 9px 10px;
}

.sync-blocked {
  margin-top: 12px;
  border-radius: 10px;
  border: 1px solid rgba(251, 191, 36, 0.34);
  background: rgba(120, 80, 8, 0.18);
  padding: 10px;
}

.sync-blocked-title {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  color: #FBBF24;
}

.sync-blocked-help {
  margin: 4px 0 8px;
  font-size: 11px;
  line-height: 1.35;
  color: #C9B27A;
}

.sync-blocked-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sync-blocked-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
  padding: 8px;
}

.sync-blocked-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sync-blocked-op {
  font-size: 12px;
  font-weight: 700;
  color: #E8EDF5;
}

.sync-blocked-reason {
  font-size: 11px;
  color: #9AA8BE;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.sync-blocked-feedback {
  font-size: 11px;
  font-weight: 700;
  color: #FBBF24;
}

.sync-blocked-confirm {
  font-size: 11px;
  line-height: 1.4;
  font-weight: 700;
  color: #FCA5A5;
  white-space: normal;
}

.sync-blocked-buttons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.sync-mini-btn {
  border-radius: 8px;
  border: none;
  height: 28px;
  padding: 0 10px;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s ease, opacity .2s ease;
}

.sync-mini-btn:disabled { opacity: .5; cursor: not-allowed; }

.sync-mini-btn--retry {
  color: #fff;
  background: #1A56DB;
}

.sync-mini-btn--retry:hover:not(:disabled) { background: #1547B2; }

.sync-mini-btn--discard {
  color: #FCA5A5;
  background: rgba(127, 29, 29, 0.3);
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.sync-mini-btn--discard:hover:not(:disabled) { background: rgba(127, 29, 29, 0.5); }

.sync-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin-top: 12px;
}

.sync-btn {
  border-radius: 10px;
  height: 38px;
  padding: 0 14px;
  border: none;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s ease, border-color .2s ease, opacity .2s ease;
}

.sync-btn:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.sync-btn--primary {
  color: #fff;
  background: #1A56DB;
  box-shadow: 0 4px 14px rgba(26,86,219,.35);
}

.sync-btn--primary:hover:not(:disabled) {
  background: #1547B2;
}

.sync-btn--ghost {
  color: #A8B8CC;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
}

.sync-btn--ghost:hover {
  background: rgba(255, 255, 255, 0.08);
}

.sync-overlay-fade-enter-active,
.sync-overlay-fade-leave-active {
  transition: opacity .2s ease;
}

.sync-overlay-fade-enter-from,
.sync-overlay-fade-leave-to {
  opacity: 0;
}

.sync-panel-pop-enter-active,
.sync-panel-pop-leave-active {
  transition: opacity .22s ease, transform .22s ease;
}

.sync-panel-pop-enter-from,
.sync-panel-pop-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(.985);
}
</style>
