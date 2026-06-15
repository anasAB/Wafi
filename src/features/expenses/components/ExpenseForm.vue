<script setup lang="ts">
import { ref, computed } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useExpenses } from '@/features/expenses/composables/useExpenses'
import ExpenseCategoryChips from './ExpenseCategoryChips.vue'
import AuditHistory from '@/features/audit/components/AuditHistory.vue'
import type { NewExpense, Expense } from '@/features/expenses/expense.types'

const props = defineProps<{ initialExpense?: Expense }>()

const emit = defineEmits<{
  (e: 'saved'):  void
  (e: 'cancel'): void
}>()

const { currentRate } = useExchangeRate()
const { save, deleteExpense } = useExpenses()

const amount      = ref<number | ''>(props.initialExpense?.amount ?? '')
const currency    = ref<'USD' | 'SYP'>(props.initialExpense?.currency ?? 'USD')
const category    = ref(props.initialExpense?.category ?? '')
const expenseDate = ref(props.initialExpense?.expenseDate ?? new Date().toISOString().slice(0, 10))
const notes       = ref(props.initialExpense?.notes ?? '')
const paidInCash  = ref(props.initialExpense?.paidInCash ?? true)
const saving      = ref(false)
const errors      = ref<Record<string, string>>({})

const chipsRef = ref<InstanceType<typeof ExpenseCategoryChips> | null>(null)

const usdEquivalent = computed(() => {
  if (currency.value !== 'SYP' || !currentRate.value || !amount.value) return null
  return (Number(amount.value) / currentRate.value).toFixed(2)
})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!amount.value || Number(amount.value) <= 0) e['amount']   = 'أدخل المبلغ'
  if (!category.value.trim())                     e['category'] = 'اختر فئة'
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave(addAnother = false) {
  if (!validate()) return
  saving.value = true
  try {
    const amountNum = Number(amount.value)
    const amountUsd = currency.value === 'USD'
      ? amountNum
      : currentRate.value ? amountNum / currentRate.value : amountNum

    const data: NewExpense = {
      amount:      amountNum,
      currency:    currency.value,
      amountUsd,
      category:    category.value.trim(),
      expenseDate: expenseDate.value,
      notes:       notes.value.trim() || undefined,
      paidInCash:  paidInCash.value,
    }

    if (props.initialExpense) {
      await deleteExpense(props.initialExpense.id)
    }
    await save(data)
    chipsRef.value?.persistCustom(data.category)

    if (addAnother) {
      amount.value   = ''
      category.value = ''
      notes.value    = ''
      errors.value   = {}
    } else {
      emit('saved')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- Backdrop -->
  <div
    class="backdrop"
    dir="rtl"
    @click.self="emit('cancel')"
  >
    <!-- Sheet panel -->
    <div class="sheet">
      <!-- Handle -->
      <div class="sheet-handle"></div>

      <div class="sheet-body">
        <!-- Title -->
        <h2 class="sheet-title">
          {{ initialExpense ? 'تعديل مصروف' : 'إضافة مصروف' }}
        </h2>

        <!-- Amount row -->
        <div class="field-group">
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
                @focus="($event.target as HTMLInputElement).style.borderColor = errors['amount'] ? '#EF4444' : 'rgba(26,86,219,0.8)'"
                @blur="($event.target as HTMLInputElement).style.borderColor = errors['amount'] ? '#EF4444' : 'rgba(255,255,255,0.18)'"
              />
            </div>
            <!-- Currency toggle -->
            <div class="currency-toggle">
              <button
                type="button"
                data-testid="currency-usd"
                :class="['currency-btn', currency === 'USD' ? 'currency-active' : 'currency-idle']"
                @click="currency = 'USD'"
              >USD</button>
              <button
                type="button"
                data-testid="currency-syp"
                :class="['currency-btn', currency === 'SYP' ? 'currency-active' : 'currency-idle']"
                @click="currency = 'SYP'"
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

        <!-- Category -->
        <div class="field-group">
          <label class="field-label">الفئة <span class="label-required">*</span></label>
          <ExpenseCategoryChips
            ref="chipsRef"
            v-model="category"
            @update:model-value="delete errors['category']"
          />
          <p v-if="errors['category']" data-testid="error-category" class="field-error">
            {{ errors['category'] }}
          </p>
        </div>

        <!-- Date -->
        <div class="field-group">
          <label class="field-label">التاريخ</label>
          <input
            v-model="expenseDate"
            data-testid="expense-date"
            type="date"
            :max="new Date().toISOString().slice(0, 10)"
            class="form-input"
            @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'"
          />
        </div>

        <!-- Payment method (cash vs non-cash) -->
        <div class="field-group">
          <label class="field-label">طريقة الدفع</label>
          <div class="currency-toggle">
            <button
              type="button"
              data-testid="paid-cash"
              :class="['currency-btn', paidInCash ? 'currency-active' : 'currency-idle']"
              @click="paidInCash = true"
            >نقدًا</button>
            <button
              type="button"
              data-testid="paid-noncash"
              :class="['currency-btn', !paidInCash ? 'currency-active' : 'currency-idle']"
              @click="paidInCash = false"
            >تحويل / بطاقة</button>
          </div>
          <p class="field-hint">المصاريف النقدية فقط تُخصم من الصندوق</p>
        </div>

        <!-- Notes -->
        <div class="field-group">
          <label class="field-label">
            ملاحظات
            <span class="label-optional">(اختياري)</span>
          </label>
          <textarea
            v-model="notes"
            data-testid="notes-input"
            rows="2"
            placeholder="وصف المصروف..."
            class="form-input form-textarea"
            @focus="($event.target as HTMLTextAreaElement).style.borderColor = 'rgba(26,86,219,0.8)'"
            @blur="($event.target as HTMLTextAreaElement).style.borderColor = 'rgba(255,255,255,0.18)'"
          />
        </div>

        <AuditHistory
          v-if="initialExpense"
          entity-type="expense"
          :entity-id="initialExpense.id"
        />

        <!-- Action buttons -->
        <div class="action-row">
          <button
            type="button"
            data-testid="save-btn"
            :disabled="saving"
            class="btn-primary"
            @click="handleSave(false)"
          >{{ saving ? 'جاري الحفظ...' : 'حفظ' }}</button>

          <button
            v-if="!initialExpense"
            type="button"
            data-testid="save-another-btn"
            :disabled="saving"
            class="btn-secondary"
            @click="handleSave(true)"
          >إضافة أخرى</button>

          <button
            type="button"
            data-testid="cancel-btn"
            class="btn-ghost"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Backdrop ──────────────────────────────────────── */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

/* ── Sheet ─────────────────────────────────────────── */
.sheet {
  width: 100%;
  max-width: 32rem;
  border-radius: 1.25rem 1.25rem 0 0;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.45);
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}

.sheet-handle {
  width: 2.5rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.20);
  margin: 0.75rem auto 1.25rem;
}

.sheet-body {
  padding: 0 1.25rem 1.5rem;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Sheet title ───────────────────────────────────── */
.sheet-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  margin-bottom: 1.25rem;
}

/* ── Field groups ──────────────────────────────────── */
.field-group {
  margin-bottom: 1rem;
}

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

/* ── Amount row ────────────────────────────────────── */
.amount-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}
.amount-input-wrap { flex: 1; }

/* ── Form inputs ───────────────────────────────────── */
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
.input-error {
  border-color: #EF4444 !important;
}

.form-textarea {
  resize: none;
  min-height: 64px;
  line-height: 1.6;
}

/* ── Currency toggle ───────────────────────────────── */
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
.currency-idle {
  background: transparent;
  color: #637285;
}
.currency-idle:hover { color: #E8EDF5; }

/* ── Field feedback ────────────────────────────────── */
.field-error {
  font-size: 0.75rem;
  color: #EF4444;
  margin-top: 0.375rem;
}
.field-hint {
  font-size: 0.75rem;
  color: #637285;
  margin-top: 0.375rem;
}

/* ── Action buttons ────────────────────────────────── */
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

.btn-secondary {
  height: 44px;
  padding-inline: 1rem;
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
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary:not(:disabled):hover { background: rgba(26, 86, 219, 0.20); }
.btn-secondary:not(:disabled):active { transform: scale(0.97); }

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
