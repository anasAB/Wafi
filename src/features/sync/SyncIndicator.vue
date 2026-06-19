<script setup lang="ts">
import { ref } from 'vue'
import { useSync } from './useSync'
import SyncBadge from '@/components/ui/SyncBadge.vue'
import ConnectionPill from '@/components/ui/ConnectionPill.vue'

const { status, pendingCount, lastSyncedAt, isStale, errorMessage, syncNow } = useSync()

const panelOpen = ref(false)
const syncing   = ref(false)

function formatLastSync(d: Date | null): string {
  if (!d) return 'لم تتم المزامنة بعد'
  return new Intl.DateTimeFormat('ar-SY', {
    hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
  }).format(d)
}

async function handleSyncNow() {
  syncing.value = true
  try {
    await syncNow()
  } finally {
    syncing.value = false
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
    @click="panelOpen = !panelOpen"
  >
    <!-- Always-visible indicator reflects TRUE network state (honest in
         local-only mode). The sync-only SyncBadge stays in the panel below. -->
    <ConnectionPill />
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
          <SyncBadge :status="status" :pending-count="pendingCount" />
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
  inset-inline-start: 10px;
  inset-inline-end: 10px;
  z-index: 40;
  border-radius: 14px;
  border: 1px solid rgba(26, 86, 219, 0.28);
  background: linear-gradient(145deg, rgba(9, 16, 31, .97), rgba(6, 12, 24, .97));
  box-shadow: 0 16px 40px rgba(3, 8, 20, 0.7), inset 0 1px 0 rgba(255,255,255,.06);
}

@media (min-width: 1024px) {
  .sync-panel {
    top: 74px;
    inset-inline-start: auto;
    inset-inline-end: 18px;
    width: 360px;
  }
}

.sync-panel-inner {
  padding: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
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
