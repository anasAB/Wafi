<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { ledgerEntryTypeLabel, type StaffLedgerEntry, type StaffLedgerEntryType } from '@/features/staff-ledger/staff-ledger.types'
import { useExchangeRate } from '@/features/exchange-rate'
import BaseModal from '@/components/ui/BaseModal.vue'

const props = defineProps<{ staffId: string }>()

const { getOutstandingEntries, addLedgerEntry } = useStaffLedger()
const { currentRate } = useExchangeRate()

const usdEntries = ref<StaffLedgerEntry[]>([])
const sypEntries = ref<StaffLedgerEntry[]>([])
const loading = ref(false)

const showAddSheet = ref(false)
const saving = ref(false)
const errors = ref<Record<string, string>>({})

// Manual entry types only — carry_forward is system-generated and never
// offered here.
const addableEntryTypes: Exclude<StaffLedgerEntryType, 'carry_forward'>[] = [
  'advance', 'bonus', 'penalty', 'write_off', 'correction',
]

const entryType = ref<Exclude<StaffLedgerEntryType, 'carry_forward'>>('advance')
const amount    = ref<number | ''>('')
const currency  = ref<'usd' | 'syp'>('usd')
const note      = ref('')

const usdEquivalent = computed(() => {
  if (currency.value !== 'syp' || !currentRate.value || !amount.value) return null
  return (Number(amount.value) / currentRate.value).toFixed(2)
})

async function reload() {
  loading.value = true
  try {
    const { usd, syp } = await getOutstandingEntries(props.staffId)
    usdEntries.value = usd
    sypEntries.value = syp
  } finally {
    loading.value = false
  }
}

function openAddSheet() {
  entryType.value = 'advance'
  amount.value = ''
  currency.value = 'usd'
  note.value = ''
  errors.value = {}
  showAddSheet.value = true
}

function closeAddSheet() {
  showAddSheet.value = false
}

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!amount.value || Number(amount.value) <= 0) e['amount'] = 'أدخل المبلغ'
  if (currency.value === 'syp' && !(currentRate.value && currentRate.value > 0)) {
    e['amount'] = 'لا يوجد سعر صرف محدد'
  }
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave() {
  if (!validate()) return
  saving.value = true
  try {
    await addLedgerEntry({
      staffId: props.staffId,
      entryType: entryType.value,
      amount: Number(amount.value),
      currency: currency.value,
      lockedRate: currency.value === 'syp' ? currentRate.value! : undefined,
      note: note.value.trim() || undefined,
    })
    showAddSheet.value = false
    await reload()
  } finally {
    saving.value = false
  }
}

onMounted(reload)

defineExpose({ reload })
</script>

<template>
  <div dir="rtl" class="staff-ledger-view">
    <div v-if="!loading && !usdEntries.length && !sypEntries.length" class="empty-state">
      لا توجد حركات مالية
    </div>

    <template v-else>
      <section v-if="usdEntries.length" class="ledger-section">
        <h3 class="section-title">بالدولار</h3>
        <ul class="ledger-list">
          <li v-for="entry in usdEntries" :key="entry.id" class="ledger-row">
            <span class="entry-label">{{ ledgerEntryTypeLabel(entry.entryType) }}</span>
            <span class="entry-amount">${{ entry.amountUsd.toFixed(2) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="sypEntries.length" class="ledger-section">
        <h3 class="section-title">بالليرة السورية</h3>
        <ul class="ledger-list">
          <li v-for="entry in sypEntries" :key="entry.id" class="ledger-row">
            <span class="entry-label">{{ ledgerEntryTypeLabel(entry.entryType) }}</span>
            <span class="entry-amount">{{ (entry.amountUsd * (entry.lockedRate ?? 1)).toLocaleString() }} ل.س</span>
          </li>
        </ul>
      </section>
    </template>

    <button type="button" data-testid="add-entry-btn" class="btn-add" @click="openAddSheet">
      + إضافة حركة
    </button>

    <BaseModal
      v-if="showAddSheet"
      title="إضافة حركة مالية"
      @close="closeAddSheet"
    >
      <div class="sheet-body" dir="rtl">
        <!-- Entry type -->
        <div class="field-group">
          <label class="field-label">نوع الحركة <span class="label-required">*</span></label>
          <select v-model="entryType" data-testid="entry-type-select" class="form-input">
            <option v-for="t in addableEntryTypes" :key="t" :value="t">
              {{ ledgerEntryTypeLabel(t) }}
            </option>
          </select>
        </div>

        <!-- Amount row (reuses the expenses feature's amount/currency-entry pattern) -->
        <div class="field-group">
          <label class="field-label">المبلغ <span class="label-required">*</span></label>
          <div class="amount-row">
            <div class="amount-input-wrap">
              <input
                v-model="amount"
                data-testid="amount-input"
                type="number" min="0" step="0.01"
                placeholder="0.00"
                class="form-input amount-input"
                :class="{ 'input-error': errors['amount'] }"
                autofocus
                @input="delete errors['amount']"
              />
            </div>
            <div class="currency-toggle">
              <button
                type="button"
                data-testid="currency-usd"
                :class="['currency-btn', currency === 'usd' ? 'currency-active' : 'currency-idle']"
                @click="currency = 'usd'"
              >USD</button>
              <button
                type="button"
                data-testid="currency-syp"
                :class="['currency-btn', currency === 'syp' ? 'currency-active' : 'currency-idle']"
                @click="currency = 'syp'"
              >SYP</button>
            </div>
          </div>
          <p v-if="errors['amount']" data-testid="error-amount" class="field-error">
            {{ errors['amount'] }}
          </p>
          <p v-if="usdEquivalent" data-testid="usd-equivalent" class="field-hint">
            ≈ ${{ usdEquivalent }}
          </p>
        </div>

        <!-- Note -->
        <div class="field-group">
          <label class="field-label">
            ملاحظات
            <span class="label-optional">(اختياري)</span>
          </label>
          <textarea
            v-model="note"
            data-testid="note-input"
            rows="2"
            placeholder="وصف الحركة..."
            class="form-input form-textarea"
          />
        </div>

        <div class="action-row">
          <button
            type="button"
            data-testid="save-btn"
            :disabled="saving"
            class="btn-primary"
            @click="handleSave"
          >{{ saving ? 'جاري الحفظ...' : 'حفظ' }}</button>

          <button
            type="button"
            data-testid="cancel-btn"
            class="btn-ghost"
            @click="closeAddSheet"
          >إلغاء</button>
        </div>
      </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.staff-ledger-view {
  font-family: 'Tajawal', system-ui, sans-serif;
}

.empty-state {
  padding: 2rem 1rem;
  text-align: center;
  color: #637285;
  font-size: 0.875rem;
}

.ledger-section {
  margin-bottom: 1rem;
}

.section-title {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #637285;
  margin-bottom: 0.5rem;
}

.ledger-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.ledger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.625rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
}

.entry-label { color: #C8D5E8; }
.entry-amount { font-weight: 700; font-variant-numeric: tabular-nums; }

.btn-add {
  width: 100%;
  height: 44px;
  margin-top: 0.75rem;
  border-radius: 0.75rem;
  background: rgba(26, 86, 219, 0.12);
  color: #60A5FA;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: 1px solid rgba(26, 86, 219, 0.30);
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}
.btn-add:hover { background: rgba(26, 86, 219, 0.20); }
.btn-add:active { transform: scale(0.98); }

/* ── Add-sheet fields (mirrors ExpenseForm.vue conventions) ────────── */
.sheet-body { padding: 0; }

.field-group { margin-bottom: 1rem; }

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  margin-bottom: 6px;
}
.label-required { color: #EF4444; }
.label-optional {
  color: #3D4F6B;
  font-weight: 400;
  margin-inline-start: 0.25rem;
}

.amount-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}
.amount-input-wrap { flex: 1; }

.form-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}
.form-input::placeholder { color: #3D4F6B; }
.form-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

.amount-input {
  font-size: 1.25rem;
  font-weight: 700;
  padding-block: 0.75rem;
}
.input-error { border-color: #EF4444 !important; }

.form-textarea {
  resize: none;
  min-height: 64px;
  line-height: 1.6;
}

.currency-toggle {
  display: flex;
  border-radius: 0.75rem;
  padding: 0.25rem;
  gap: 0.25rem;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.currency-btn {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.currency-active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  box-shadow: 0 2px 8px rgba(26,86,219,0.35);
}
.currency-idle { background: transparent; color: #637285; }
.currency-idle:hover { color: #E8EDF5; }

.field-error { font-size: 0.75rem; color: #EF4444; margin-top: 0.375rem; }
.field-hint { font-size: 0.75rem; color: #637285; margin-top: 0.375rem; }

.action-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.25rem;
}

.btn-primary {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.15s;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary:not(:disabled):active { transform: scale(0.97); }

.btn-ghost {
  height: 44px;
  padding-inline: 1rem;
  border-radius: 0.75rem;
  background: transparent;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: 1px solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}
.btn-ghost:hover { background: rgba(255, 255, 255, 0.05); }
.btn-ghost:active { transform: scale(0.97); }
</style>
