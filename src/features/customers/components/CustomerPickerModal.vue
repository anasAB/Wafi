<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCustomers } from '@/features/customers/composables/useCustomers'
import { useSettingsStore } from '@/features/settings'
import type { Customer } from '@/features/customers/customer.types'

const emit = defineEmits<{
  (e: 'select', customer: Customer): void
  (e: 'cancel'): void
}>()

const { customers, load, search, save } = useCustomers()
const settings   = useSettingsStore()
const query      = ref('')
const showAddNew = ref(false)
const newName    = ref('')
const saving     = ref(false)
const results    = ref<Customer[]>([])

// WAFI-126: each customer row already carries its outstanding balance —
// useCustomers.load() computes balance_usd in the list query (WAFI-104), so
// the picker reuses it directly; no second query, search speed untouched.
onMounted(async () => {
  await load()
  results.value = customers.value
})

function balanceClass(c: Customer): string {
  const b = c.balanceUsd ?? 0
  if (b < -0.001) return 'balance-chip balance-chip--credit'
  if (b > settings.creditWarnThresholdUsd) return 'balance-chip balance-chip--over'
  if (b > 0.001) return 'balance-chip balance-chip--normal'
  return 'balance-chip balance-chip--zero'
}

function balanceLabel(c: Customer): string {
  const b = c.balanceUsd ?? 0
  if (b < -0.001) return `له رصيد $${Math.abs(b).toFixed(2)}`
  if (b > 0.001) return `عليه $${b.toFixed(2)}`
  return ''
}

async function handleSearch(q: string) {
  query.value = q
  if (q.trim()) {
    results.value = await search(q.trim())
  } else {
    results.value = customers.value
  }
}

async function handleQuickAdd() {
  if (!newName.value.trim()) return
  saving.value = true
  try {
    const id = await save({ name: newName.value.trim() })
    await load()
    const created = customers.value.find(c => c.id === id)
    if (created) emit('select', created)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="modal-overlay"
      data-testid="backdrop"
      @click.self="emit('cancel')"
    >
      <div class="modal-sheet" dir="rtl">
        <!-- Handle -->
        <div class="sheet-handle"></div>

        <!-- Title -->
        <div class="sheet-header">
          <h2 class="sheet-title">اختر الزبون</h2>
          <button type="button" class="close-btn" @click="emit('cancel')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Search -->
        <div class="search-wrap">
          <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            :value="query"
            data-testid="search-input"
            type="text"
            placeholder="ابحث باسم الزبون..."
            class="search-input"
            @input="handleSearch(($event.target as HTMLInputElement).value)"
          />
        </div>

        <!-- Results list -->
        <div class="results-list">
          <button
            v-for="c in results"
            :key="c.id"
            type="button"
            :data-testid="`customer-${c.id}`"
            class="result-item"
            @click="emit('select', c)"
          >
            <span class="result-name">{{ c.name }}</span>
            <span class="result-meta">
              <span v-if="balanceLabel(c)" :class="balanceClass(c)" :data-testid="`balance-${c.id}`">{{ balanceLabel(c) }}</span>
              <span v-if="c.phone" class="result-phone">{{ c.phone }}</span>
            </span>
          </button>

          <div v-if="results.length === 0" class="empty-state">
            لا توجد نتائج
          </div>
        </div>

        <!-- Add new footer -->
        <div class="add-footer">
          <div v-if="!showAddNew">
            <button
              type="button"
              data-testid="add-new-btn"
              class="add-new-btn"
              @click="showAddNew = true"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              إضافة زبون جديد
            </button>
          </div>

          <div v-else data-testid="quick-add-form" class="quick-add-row">
            <input
              v-model="newName"
              data-testid="quick-add-name"
              type="text"
              placeholder="اسم الزبون"
              class="quick-add-input"
              @keydown.enter="handleQuickAdd"
            />
            <button
              type="button"
              data-testid="quick-add-save"
              :disabled="saving || !newName.trim()"
              class="quick-add-save"
              @click="handleQuickAdd"
            >{{ saving ? '...' : 'إضافة' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay ─────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Sheet container ─────────────────────────────────────── */
.modal-sheet {
  width: 100%;
  max-width: 32rem;
  max-height: 80dvh;
  display: flex;
  flex-direction: column;
  border-radius: 1.25rem 1.25rem 0 0;
  backdrop-filter: blur(24px) saturate(180%);
  background: linear-gradient(180deg, rgba(26,86,219,0.22) 0%, rgba(7,11,20,0.98) 72px);
  border: 1px solid rgba(26,86,219,0.28);
  border-bottom: none;
  box-shadow: 0 -8px 48px rgba(0,0,0,0.55), 0 0 40px rgba(26,86,219,0.14), inset 0 1px 0 rgba(255,255,255,0.07);
  overflow: hidden;
}

/* ── Handle ──────────────────────────────────────────────── */
.sheet-handle {
  width: 2.25rem;
  height: 0.25rem;
  background: rgba(255,255,255,0.20);
  border-radius: 9999px;
  margin: 0.75rem auto 0;
  flex-shrink: 0;
}

/* ── Header ──────────────────────────────────────────────── */
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.25rem 0.5rem;
  flex-shrink: 0;
}

.sheet-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
}

.close-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  background: rgba(255,255,255,0.06);
  border: none;
  cursor: pointer;
  transition: background 0.12s;
}

.close-btn:hover { background: rgba(255,255,255,0.10); }

/* ── Search ──────────────────────────────────────────────── */
.search-wrap {
  position: relative;
  padding: 0 1.25rem 0.75rem;
  flex-shrink: 0;
}

.search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 2rem;
  margin: auto;
  margin-bottom: 0.75rem;
  width: 1rem;
  height: 1rem;
  color: #637285;
  pointer-events: none;
}

.search-input {
  width: 100%;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 2.5rem 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
  height: 44px;
}

.search-input::placeholder { color: #3D4F6B; }

.search-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

/* ── Results list ────────────────────────────────────────── */
.results-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 0.75rem;
}

.result-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 0.75rem;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: right;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  transition: background 0.12s;
  font-family: inherit;
}

.result-item:last-child { border-bottom: none; }

.result-item:hover { background: rgba(26,86,219,0.12); }

.result-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

.result-phone {
  font-size: 0.75rem;
  color: #637285;
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* WAFI-126: outstanding-balance chip, color-coded by state */
.balance-chip {
  font-size: 0.6875rem;
  font-weight: 700;
  border-radius: 9999px;
  padding: 2px 8px;
  white-space: nowrap;
}
.balance-chip--normal { color: #FBBF24; background: rgba(120, 80, 8, 0.22); border: 1px solid rgba(251, 191, 36, 0.30); }
.balance-chip--over   { color: #FCA5A5; background: rgba(127, 29, 29, 0.26); border: 1px solid rgba(239, 68, 68, 0.38); }
.balance-chip--credit { color: #4ADE80; background: rgba(22, 101, 52, 0.22); border: 1px solid rgba(34, 197, 94, 0.32); }
.balance-chip--zero   { display: none; }

/* ── Empty state ─────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 1.5rem;
  font-size: 0.875rem;
  color: #637285;
}

/* ── Add footer ──────────────────────────────────────────── */
.add-footer {
  flex-shrink: 0;
  padding: 0.75rem 1.25rem 1.25rem;
  border-top: 1px solid rgba(26,86,219,0.14);
}

.add-new-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem;
  border-radius: 0.75rem;
  background: rgba(26,86,219,0.10);
  border: 1px solid rgba(26,86,219,0.25);
  color: #60A5FA;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
  font-family: inherit;
}

.add-new-btn:hover { background: rgba(26,86,219,0.18); }

/* ── Quick add row ───────────────────────────────────────── */
.quick-add-row {
  display: flex;
  gap: 0.5rem;
}

.quick-add-input {
  flex: 1;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem;
  padding: 0.5rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
  height: 40px;
}

.quick-add-input::placeholder { color: #3D4F6B; }

.quick-add-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

.quick-add-save {
  height: 40px;
  padding-inline: 1rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
  transition: opacity 0.15s;
  font-family: inherit;
}

.quick-add-save:hover { opacity: 0.88; }
.quick-add-save:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
