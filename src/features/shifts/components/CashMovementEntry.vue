<!-- Shared launcher for recording an in-shift cash movement. Used from both entry
     points (the POS shift area in the sidebar and the dashboard cash-drawer
     drill-down) so the open-shift load + record flow lives in ONE place (DRY).
     The button shows only while a shift is open on this device; on a successful
     record it emits 'recorded' so the host can refresh its figures. -->
<script setup lang="ts">
import { ref } from 'vue'
import { useShiftStore } from '@/features/shifts/shift.store'
import { useShift } from '@/features/shifts/composables/useShift'
import { useCashMovements } from '@/features/shifts/composables/useCashMovements'
import RecordCashMovementSheet from '@/features/shifts/components/RecordCashMovementSheet.vue'
import type { CashierShift } from '@/features/shifts/shift.types'
import type {
  CashMovementDirection, CashMovementCategory, CashCurrency,
} from '@/features/shifts/cashMovement.types'

withDefaults(defineProps<{ variant?: 'sidebar' | 'drawer' }>(), { variant: 'drawer' })
const emit = defineEmits<{ (e: 'recorded'): void }>()

const shiftStore = useShiftStore()
const { loadActiveShift } = useShift()
const { record, liveDrawer } = useCashMovements()

const activeShift = ref<CashierShift | null>(null)
const showSheet   = ref(false)
const drawerUsd   = ref(0)
const drawerSyp   = ref(0)
const busy        = ref(false)

async function openSheet() {
  // Re-read the open shift at click time (offline-first, store may be stale after a
  // refresh). No open shift on this device → no entry point, nothing to move.
  activeShift.value = await loadActiveShift()
  if (!activeShift.value) return
  const d = await liveDrawer(activeShift.value)
  drawerUsd.value = d.expectedUsd
  drawerSyp.value = d.expectedSyp
  showSheet.value = true
}

async function onRecord(v: {
  direction: CashMovementDirection; category: CashMovementCategory
  currency: CashCurrency; amount: number; note: string | null
}) {
  if (!activeShift.value || busy.value) return
  busy.value = true
  try {
    await record({ shift: activeShift.value, ...v })
    showSheet.value = false
    emit('recorded')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    v-if="shiftStore.isShiftOpen"
    type="button"
    data-test="cash-movement-entry"
    :class="variant === 'sidebar' ? 'entry-sidebar' : 'entry-drawer'"
    @click="openSheet"
  >
    <span class="entry-icon" aria-hidden="true">⇄</span>
    <span>حركة نقدية</span>
  </button>

  <Teleport to="body">
    <div v-if="showSheet" class="cm-backdrop" dir="rtl" @click.self="showSheet = false">
      <RecordCashMovementSheet
        class="cm-sheet"
        :live-drawer-usd="drawerUsd"
        :live-drawer-syp="drawerSyp"
        @record="onRecord"
        @close="showSheet = false"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.entry-sidebar {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 12px; border-radius: 0.75rem; cursor: pointer;
  font-family: inherit; font-size: 0.8125rem; font-weight: 700;
  color: #93C5FD; background: rgba(26, 86, 219, 0.10);
  border: 1px solid rgba(26, 86, 219, 0.28);
  transition: background 0.15s, border-color 0.15s;
}
.entry-sidebar:hover { background: rgba(26, 86, 219, 0.18); border-color: rgba(26, 86, 219, 0.5); }

.entry-drawer {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 0.75rem; cursor: pointer;
  font-family: inherit; font-size: 0.8125rem; font-weight: 800; color: #fff;
  background: #1A56DB; border: 1px solid #1A56DB;
}
.entry-drawer:hover { background: #1E4FC4; }
.entry-icon { font-size: 1rem; }

.cm-backdrop {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px);
}
@media (min-width: 640px) { .cm-backdrop { align-items: center; } }
.cm-sheet { width: 100%; max-width: 28rem; }
</style>
