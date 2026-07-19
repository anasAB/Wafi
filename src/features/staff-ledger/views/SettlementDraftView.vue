<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'
import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'
import { useStaffActivity } from '@/features/staff-ledger/composables/useStaffActivity'
import { ledgerEntryTypeLabel } from '@/features/staff-ledger/staff-ledger.types'
import type { StaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

const props = defineProps<{ staffId: string; periodMonth: string }>()

const { createDraft, applyLedgerEntry, finalize } = useStaffSettlement()
const { getOutstandingEntries } = useStaffLedger()
const { getPosActivityDays } = useStaffActivity()

const settlementId = ref<string | null>(null)
const resumedNotice = ref(false)
const usdEntries = ref<StaffLedgerEntry[]>([])
const sypEntries = ref<StaffLedgerEntry[]>([])
const activityDays = ref<string[]>([])
const applied = ref<Record<string, number>>({}) // ledgerEntryId -> applyAmountUsd
const settlementCurrency = ref<'usd' | 'syp' | null>(null)
const settlementRate = ref<number | ''>('')
const baseSalaryUsd = ref<number | null>(null)
const notes = ref('')
const showFinalizeConfirm = ref(false)
const alreadyFinalizedNotice = ref(false)
const finalizeError = ref<string | null>(null)
const finalizing = ref(false)

onMounted(async () => {
  const { settlement, resumed } = await createDraft(props.staffId, props.periodMonth)
  settlementId.value = settlement.id
  resumedNotice.value = resumed
  const { usd, syp } = await getOutstandingEntries(props.staffId)
  usdEntries.value = usd
  sypEntries.value = syp
  activityDays.value = await getPosActivityDays(props.staffId, props.periodMonth)
})

const canFinalize = computed(() => {
  if (settlementCurrency.value === null) return false
  if (settlementCurrency.value === 'syp') return Number(settlementRate.value) > 0
  return true
})

const applyErrors = ref<Record<string, string>>({}) // ledgerEntryId -> inline error message

// Matches SQLite's "UNIQUE constraint failed: ..." wording (see src/data/powersync/ops.ts
// for the equivalent Postgres/PostgREST convention) plus finalize()'s own pre-check message
// ("settlement ... already finalized ...") — both mean another device closed this
// staff+month settlement first.
const CONFLICT_ERROR_PATTERN = /unique|already finalized/i

function toggleApply(entry: StaffLedgerEntry, amount: number) {
  // applyLedgerEntry throws when amount exceeds the entry's remaining amount.
  // Catch it here so an over-limit input surfaces an inline error instead of
  // throwing uncaught out of the @change handler.
  try {
    applyLedgerEntry(entry, amount)
    applied.value[entry.id] = amount
    delete applyErrors.value[entry.id]
  } catch (err) {
    applyErrors.value[entry.id] = err instanceof Error ? err.message : String(err)
  }
}

async function onConfirmFinalize() {
  finalizing.value = true
  try {
    await finalize(settlementId.value!, props.staffId, {
      settlementCurrency: settlementCurrency.value!,
      baseSalaryUsd: baseSalaryUsd.value ?? 0,
      notes: notes.value || null,
      applications: Object.entries(applied.value).map(([ledgerEntryId, applyAmountUsd]) => ({ ledgerEntryId, applyAmountUsd })),
      ...(settlementCurrency.value === 'syp' ? { settlementRate: Number(settlementRate.value) } : {}),
    })
    showFinalizeConfirm.value = false
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    finalizeError.value = message
    // Offline-conflict path: a unique-constraint violation (or an "already
    // finalized" guard from finalize()) means another device closed this
    // staff+month settlement first. Anything else (validation, network,
    // unrelated bugs) gets an honest generic failure message instead.
    alreadyFinalizedNotice.value = CONFLICT_ERROR_PATTERN.test(message)
    showFinalizeConfirm.value = false
  } finally {
    finalizing.value = false
  }
}
</script>

<template>
  <div dir="rtl" class="settlement-draft-view">
    <p v-if="resumedNotice" class="info-notice">استئناف المسودة الحالية لهذا الشهر</p>
    <p v-if="alreadyFinalizedNotice" class="error-notice" data-testid="conflict-notice">
      تم إغلاق هذه التسوية بالفعل على جهاز آخر
    </p>
    <p v-else-if="finalizeError" class="error-notice" data-testid="finalize-error-notice">
      تعذر إنهاء التسوية، حاول مرة أخرى
    </p>

    <div
      v-if="!usdEntries.length && !sypEntries.length && !activityDays.length"
      class="empty-state"
    >
      لا توجد حركات مالية لهذا الشهر
    </div>

    <template v-else>
      <section v-if="usdEntries.length" class="ledger-section">
        <h3 class="section-title">بالدولار</h3>
        <ul class="ledger-list">
          <li v-for="entry in usdEntries" :key="entry.id" class="ledger-row">
            <span class="entry-label">{{ ledgerEntryTypeLabel(entry.entryType) }}</span>
            <span class="entry-amount">${{ entry.amountUsd.toFixed(2) }}</span>
            <input
              type="number"
              class="apply-input"
              :max="entry.amountUsd"
              min="0"
              step="0.01"
              @change="toggleApply(entry, Number(($event.target as HTMLInputElement).value))"
            />
            <span v-if="applyErrors[entry.id]" class="apply-error" :data-testid="`apply-error-${entry.id}`">
              المبلغ يتجاوز الرصيد المتبقي
            </span>
          </li>
        </ul>
      </section>

      <section v-if="sypEntries.length" class="ledger-section">
        <h3 class="section-title">بالليرة السورية</h3>
        <ul class="ledger-list">
          <li v-for="entry in sypEntries" :key="entry.id" class="ledger-row">
            <span class="entry-label">{{ ledgerEntryTypeLabel(entry.entryType) }}</span>
            <span class="entry-amount">${{ entry.amountUsd.toFixed(2) }}</span>
            <input
              type="number"
              class="apply-input"
              :max="entry.amountUsd"
              min="0"
              step="0.01"
              @change="toggleApply(entry, Number(($event.target as HTMLInputElement).value))"
            />
            <span v-if="applyErrors[entry.id]" class="apply-error" :data-testid="`apply-error-${entry.id}`">
              المبلغ يتجاوز الرصيد المتبقي
            </span>
          </li>
        </ul>
      </section>

      <section v-if="activityDays.length" class="ledger-section">
        <h3 class="section-title">أيام العمل هذا الشهر</h3>
        <p class="activity-count">{{ activityDays.length }} يوم</p>
      </section>
    </template>

    <div class="field-group">
      <label class="field-label">الراتب الأساسي</label>
      <input
        v-model.number="baseSalaryUsd"
        type="number" min="0" step="0.01"
        class="form-input"
      />
    </div>

    <div class="field-group">
      <label class="field-label">عملة التسوية <span class="label-required">*</span></label>
      <div class="currency-toggle">
        <button
          type="button"
          data-testid="currency-usd"
          :class="['currency-btn', settlementCurrency === 'usd' ? 'currency-active' : 'currency-idle']"
          @click="settlementCurrency = 'usd'"
        >دولار</button>
        <button
          type="button"
          data-testid="currency-syp"
          :class="['currency-btn', settlementCurrency === 'syp' ? 'currency-active' : 'currency-idle']"
          @click="settlementCurrency = 'syp'"
        >ليرة سورية</button>
      </div>
    </div>

    <div v-if="settlementCurrency === 'syp'" class="field-group">
      <label class="field-label">سعر الصرف <span class="label-required">*</span></label>
      <input
        v-model.number="settlementRate"
        data-testid="settlement-rate-input"
        type="number" min="0" step="0.01"
        placeholder="0.00"
        class="form-input"
      />
    </div>

    <div class="field-group">
      <label class="field-label">ملاحظات <span class="label-optional">(اختياري)</span></label>
      <textarea v-model="notes" rows="2" class="form-input form-textarea" placeholder="ملاحظات التسوية" />
    </div>

    <button
      type="button"
      data-testid="finalize-button"
      class="btn-primary"
      :disabled="!canFinalize"
      @click="showFinalizeConfirm = true"
    >
      إنهاء التسوية
    </button>

    <div v-if="showFinalizeConfirm" role="dialog" class="confirm-overlay">
      <div class="confirm-box">
        <p class="confirm-message">لا يمكن التعديل عليها لاحقاً. هل تريد المتابعة؟</p>
        <div class="action-row">
          <button type="button" class="btn-ghost" @click="showFinalizeConfirm = false">إلغاء</button>
          <button
            type="button"
            data-testid="confirm-finalize-button"
            class="btn-primary"
            :disabled="finalizing"
            @click="onConfirmFinalize"
          >{{ finalizing ? 'جاري الإنهاء...' : 'تأكيد' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settlement-draft-view {
  font-family: 'Tajawal', system-ui, sans-serif;
}

.empty-state {
  padding: 2rem 1rem;
  text-align: center;
  color: #637285;
  font-size: 0.875rem;
}

.info-notice {
  padding: 0.625rem 0.875rem;
  border-radius: 0.625rem;
  background: rgba(26, 86, 219, 0.12);
  color: #60A5FA;
  font-size: 0.8125rem;
  margin-bottom: 0.75rem;
}

.error-notice {
  padding: 0.625rem 0.875rem;
  border-radius: 0.625rem;
  background: rgba(239, 68, 68, 0.12);
  color: #F87171;
  font-size: 0.8125rem;
  margin-bottom: 0.75rem;
}

.ledger-section { margin-bottom: 1rem; }

.section-title {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #637285;
  margin-bottom: 0.5rem;
}

.activity-count {
  color: #C8D5E8;
  font-size: 0.875rem;
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
  gap: 0.5rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.625rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
}

.entry-label { color: #C8D5E8; flex: 1; }
.entry-amount { font-weight: 700; font-variant-numeric: tabular-nums; }

.apply-error {
  color: #F87171;
  font-size: 0.75rem;
  flex-basis: 100%;
}

.apply-input {
  width: 5.5rem;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.5rem;
  padding: 0.375rem 0.5rem;
  color: #E8EDF5;
  font-size: 0.8125rem;
}

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
  box-sizing: border-box;
}
.form-textarea { resize: none; min-height: 64px; line-height: 1.6; }

.currency-toggle {
  display: flex;
  border-radius: 0.75rem;
  padding: 0.25rem;
  gap: 0.25rem;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.currency-btn {
  flex: 1;
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

.btn-primary {
  width: 100%;
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

.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 1rem;
}
.confirm-box {
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.875rem;
  padding: 1.25rem;
  max-width: 24rem;
  width: 100%;
}
.confirm-message {
  color: #E8EDF5;
  font-size: 0.875rem;
  line-height: 1.6;
  margin: 0 0 1rem;
}

.action-row {
  display: flex;
  gap: 0.5rem;
}

.btn-ghost {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  background: transparent;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: 1px solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
}
.btn-ghost:hover { background: rgba(255, 255, 255, 0.05); }
</style>
