<script setup lang="ts">
import { ref, computed } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useExpenses } from '@/features/expenses/composables/useExpenses'
import ExpenseCategoryChips from './ExpenseCategoryChips.vue'
import ProductPhotoUpload from '@/features/products/components/ProductPhotoUpload.vue'
import AuditHistory from '@/features/audit/components/AuditHistory.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import AppDatePicker from '@/components/ui/AppDatePicker.vue'
import type { NewExpense, Expense } from '@/features/expenses/expense.types'

const props = defineProps<{ initialExpense?: Expense }>()

const emit = defineEmits<{
  (e: 'saved'):  void
  (e: 'cancel'): void
}>()

const { currentRate } = useExchangeRate()
const { save, updateExpense } = useExpenses()

const amount      = ref<number | ''>(props.initialExpense?.amount ?? '')
const currency    = ref<'USD' | 'SYP'>(props.initialExpense?.currency ?? 'USD')
const category    = ref(props.initialExpense?.category ?? '')
const expenseDate = ref(props.initialExpense?.expenseDate ?? new Date().toISOString().slice(0, 10))
const isRecurringMonthly = ref(!!props.initialExpense?.isRecurringMonthly)
const recurringStartDate = ref(props.initialExpense?.recurringStartDate ?? '')
const recurringEndDate   = ref(props.initialExpense?.recurringEndDate ?? '')
const notes       = ref(props.initialExpense?.notes ?? '')
const photoUrl    = ref<string | null>(props.initialExpense?.photoUrl ?? null)
const photoError  = ref<string | null>(null)
const paidInCash  = ref(props.initialExpense?.paidInCash ?? true)
const saving      = ref(false)
const errors      = ref<Record<string, string>>({})

const chipsRef = ref<InstanceType<typeof ExpenseCategoryChips> | null>(null)

const usdEquivalent = computed(() => {
  if (currency.value !== 'SYP' || !currentRate.value || !amount.value) return null
  return (Number(amount.value) / currentRate.value).toFixed(2)
})

function isoToDate(value: string): Date | null {
  if (!value) return null
  const d = new Date(value + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

function dateToIso(value: Date | null): string {
  if (!value) return ''
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const expenseDateModel = computed<Date | null>({
  get: () => isoToDate(expenseDate.value),
  set: (v) => { expenseDate.value = dateToIso(v) },
})

const recurringStartDateModel = computed<Date | null>({
  get: () => isoToDate(recurringStartDate.value),
  set: (v) => {
    recurringStartDate.value = dateToIso(v)
    delete errors.value['recurringStartDate']
  },
})

const recurringEndDateModel = computed<Date | null>({
  get: () => isoToDate(recurringEndDate.value),
  set: (v) => {
    recurringEndDate.value = dateToIso(v)
    delete errors.value['recurringEndDate']
  },
})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!amount.value || Number(amount.value) <= 0) e['amount']   = 'أدخل المبلغ'
  if (!category.value.trim())                     e['category'] = 'اختر فئة'
  if (isRecurringMonthly.value) {
    if (!recurringStartDate.value) e['recurringStartDate'] = 'حدد تاريخ البداية'
    if (!recurringEndDate.value)   e['recurringEndDate']   = 'حدد تاريخ النهاية'
    if (recurringStartDate.value && recurringEndDate.value && recurringEndDate.value < recurringStartDate.value) {
      e['recurringEndDate'] = 'تاريخ النهاية يجب أن يكون بعد البداية'
    }
  }
  errors.value = e
  return Object.keys(e).length === 0
}

function showPhotoError(message: string) {
  photoError.value = message
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
      expenseDate: isRecurringMonthly.value ? (recurringStartDate.value || expenseDate.value) : expenseDate.value,
      notes:       notes.value.trim() || undefined,
      photoUrl:    photoUrl.value ?? undefined,
      paidInCash:  paidInCash.value,
      isRecurringMonthly: isRecurringMonthly.value,
      recurringStartDate: isRecurringMonthly.value ? recurringStartDate.value : undefined,
      recurringEndDate:   isRecurringMonthly.value ? recurringEndDate.value : undefined,
    }

    if (props.initialExpense) {
      await updateExpense(props.initialExpense.id, data)
    } else {
      await save(data)
    }
    chipsRef.value?.persistCustom(data.category)

    if (addAnother) {
      amount.value   = ''
      category.value = ''
      notes.value    = ''
      photoUrl.value = null
      photoError.value = null
      isRecurringMonthly.value = false
      recurringStartDate.value = ''
      recurringEndDate.value = ''
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
  <BaseModal
    :title="initialExpense ? 'تعديل مصروف' : 'إضافة مصروف'"
    @close="emit('cancel')"
  >
      <div class="sheet-body" dir="rtl">

        <!-- Amount row -->
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

        <!-- Date (single expense only). Recurring uses start/end date range. -->
        <div v-if="!isRecurringMonthly" class="field-group">
          <label class="field-label">تاريخ المصروف</label>
          <AppDatePicker
            v-model="expenseDateModel"
            input-id="expense-date"
            data-testid="expense-date"
            date-format="yy-mm-dd"
            placeholder="اختر التاريخ"
            show-icon
            icon-display="input"
            :max-date="new Date()"
            append-to="self"
            class="expense-date-picker"
            :input-class="'form-input date-input prime-date-input'"
          />
        </div>

        <div class="field-group recurring-wrap">
          <label class="recurring-toggle-row">
            <input
              v-model="isRecurringMonthly"
              type="checkbox"
              class="recurring-check"
            />
            <span class="field-label recurring-label">مصروف متكرر شهريًا</span>
          </label>

          <div v-if="isRecurringMonthly" class="recurring-dates-row">
            <div class="recurring-date-field">
              <label class="field-label">من تاريخ</label>
              <AppDatePicker
                v-model="recurringStartDateModel"
                date-format="yy-mm-dd"
                placeholder="اختر تاريخ البداية"
                show-icon
                icon-display="input"
                append-to="self"
                class="expense-date-picker"
                :input-class="['form-input date-input prime-date-input', errors['recurringStartDate'] ? 'input-error' : '']"
              />
              <p v-if="errors['recurringStartDate']" class="field-error">{{ errors['recurringStartDate'] }}</p>
            </div>

            <div class="recurring-date-field">
              <label class="field-label">إلى تاريخ</label>
              <AppDatePicker
                v-model="recurringEndDateModel"
                date-format="yy-mm-dd"
                placeholder="اختر تاريخ النهاية"
                show-icon
                icon-display="input"
                append-to="self"
                :min-date="isoToDate(recurringStartDate) ?? undefined"
                class="expense-date-picker"
                :input-class="['form-input date-input prime-date-input', errors['recurringEndDate'] ? 'input-error' : '']"
              />
              <p v-if="errors['recurringEndDate']" class="field-error">{{ errors['recurringEndDate'] }}</p>
            </div>
          </div>
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

        <!-- Receipt photo (optional) -->
        <div class="field-group">
          <label class="field-label">
            صورة الإيصال
            <span class="label-optional">(اختياري)</span>
          </label>
          <ProductPhotoUpload
            :model-value="photoUrl"
            @change="(v) => { photoUrl = v; photoError = null }"
            @error="showPhotoError"
          />
          <p v-if="photoError" class="field-error">{{ photoError }}</p>
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
  </BaseModal>
</template>

<style scoped>
.sheet-body {
  padding: 0;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Field groups ──────────────────────────────────── */
.field-group {
  margin-bottom: 1rem;
}

.recurring-wrap {
  border: 1px solid rgba(26, 86, 219, 0.18);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  padding: 0.75rem;
}

.recurring-toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.recurring-label {
  margin-bottom: 0;
  color: #C8D5E8;
}

.recurring-check {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid rgba(96,165,250,0.45);
  background: rgba(255,255,255,0.04);
  display: grid;
  place-items: center;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.recurring-check::after {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(135deg, #60A5FA, #1A56DB);
  transform: scale(0);
  transition: transform 0.12s ease;
}

.recurring-check:checked {
  border-color: rgba(96,165,250,0.9);
  background: rgba(26,86,219,0.20);
}

.recurring-check:checked::after { transform: scale(1); }

.recurring-dates-row {
  margin-top: 0.75rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.625rem;
}

.recurring-date-field {
  min-width: 0;
}

@media (max-width: 560px) {
  .recurring-dates-row {
    grid-template-columns: 1fr;
  }
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

.date-input {
  height: 40px;
  min-height: 40px;
  padding-inline-end: 2.75rem;
  padding-inline-start: 0.875rem;
  color-scheme: dark;
  line-height: 1.2;
}

.prime-date-input {
  font-variant-numeric: tabular-nums;
}

.expense-date-picker {
  width: 100%;
}

.expense-date-picker :deep(.p-inputtext),
.expense-date-picker :deep(input.p-datepicker-input) {
  background: rgba(255, 255, 255, 0.07) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  color: #E8EDF5 !important;
}

.expense-date-picker :deep(.p-inputtext:enabled:hover),
.expense-date-picker :deep(input.p-datepicker-input:enabled:hover) {
  border-color: rgba(26, 86, 219, 0.45) !important;
}

.expense-date-picker :deep(.p-inputtext:enabled:focus),
.expense-date-picker :deep(input.p-datepicker-input:enabled:focus) {
  border-color: rgba(26, 86, 219, 0.8) !important;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15) !important;
}

.expense-date-picker :deep(.p-datepicker-input) {
  height: 40px !important;
  min-height: 40px !important;
  line-height: 1.2;
  box-sizing: border-box;
  padding-inline-start: 0.875rem !important;
  padding-inline-end: 2.75rem !important;
  /* Physical fallback to avoid RTL inconsistencies across engines. */
  padding-right: 0.875rem !important;
  padding-left: 2.75rem !important;
  text-align: right;
}

.expense-date-picker :deep(.p-inputtext::placeholder) {
  color: #3D4F6B;
  opacity: 1;
}

.expense-date-picker :deep(.p-datepicker-input-icon-container) {
  position: absolute;
  inset-inline-end: 0.75rem;
  inset-block: 0;
  margin: auto;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  padding: 0;
  background: transparent;
  border: none;
  pointer-events: none;
}

.expense-date-picker :deep(.p-datepicker-input-icon) {
  font-size: 0.95rem;
  line-height: 1;
}

.expense-date-picker :deep(.p-datepicker-dropdown) {
  display: none;
}

.expense-date-picker :deep(.p-datepicker-panel) {
  margin-top: 6px;
  border-radius: 12px;
  border: 1px solid rgba(26,86,219,0.30);
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(180deg, rgba(13,24,40,0.97), rgba(7,11,20,0.97));
  box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 4px 18px rgba(26,86,219,0.16);
  color: #E8EDF5;
}

.expense-date-picker :deep(.p-datepicker-calendar-container),
.expense-date-picker :deep(.p-datepicker-calendar),
.expense-date-picker :deep(.p-datepicker-month-view),
.expense-date-picker :deep(.p-datepicker-year-view) {
  background: transparent !important;
}

.expense-date-picker :deep(.p-datepicker-header) {
  background: transparent;
  border-bottom: 1px solid rgba(26,86,219,0.20);
  color: #E8EDF5;
}

.expense-date-picker :deep(.p-datepicker-title button),
.expense-date-picker :deep(.p-datepicker-prev),
.expense-date-picker :deep(.p-datepicker-next) {
  color: #C8D5E8;
}

.expense-date-picker :deep(.p-datepicker-title button:hover),
.expense-date-picker :deep(.p-datepicker-prev:hover),
.expense-date-picker :deep(.p-datepicker-next:hover) {
  background: rgba(26, 86, 219, 0.16) !important;
}

.expense-date-picker :deep(.p-datepicker-day),
.expense-date-picker :deep(.p-datepicker-month),
.expense-date-picker :deep(.p-datepicker-year) {
  color: #C8D5E8;
}

.expense-date-picker :deep(.p-datepicker-day:hover) {
  background: rgba(26,86,219,0.16);
}

.expense-date-picker :deep(.p-datepicker-day-selected) {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #FFFFFF;
}

.expense-date-picker :deep(.p-datepicker-select-month),
.expense-date-picker :deep(.p-datepicker-select-year),
.expense-date-picker :deep(.p-select),
.expense-date-picker :deep(.p-select-label),
.expense-date-picker :deep(.p-select-dropdown) {
  background: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(26, 86, 219, 0.28) !important;
  color: #E8EDF5 !important;
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
