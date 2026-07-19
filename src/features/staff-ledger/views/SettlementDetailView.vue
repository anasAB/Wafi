<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { db } from '@/data/powersync/db'
import { useStaffSettlement, rowToSettlement, type StaffSettlementRow } from '@/features/staff-ledger/composables/useStaffSettlement'
import type { StaffSettlement } from '@/features/staff-ledger/staff-ledger.types'

const props = defineProps<{ settlementId: string; staffId: string }>()
const { markPaid } = useStaffSettlement()
const settlement = ref<StaffSettlement | null>(null)
const showPaidConfirm = ref(false)
const paymentMethod = ref<'cash' | 'bank' | 'other'>('cash')

async function reload() {
  // NOTE: db.getOptional returns the raw snake_case DB row shape (e.g.
  // final_amount_usd, staff_name_snapshot) — it must go through the shared
  // rowToSettlement() mapper (same one useStaffSettlement.ts uses internally)
  // to become the camelCase StaffSettlement the template reads. A raw
  // `as StaffSettlement` cast here would be a type-lie: every camelCase
  // field the template binds to would be undefined at runtime.
  const row = await db.getOptional<StaffSettlementRow>(
    `SELECT * FROM staff_settlements WHERE id = ?`,
    [props.settlementId],
  )
  settlement.value = row ? rowToSettlement(row) : null
}
onMounted(reload)

async function onConfirmPaid() {
  await markPaid(props.settlementId, props.staffId, { paymentMethod: paymentMethod.value })
  showPaidConfirm.value = false
  await reload()
}

const statusLabel: Record<string, string> = {
  draft: 'مسودة',
  finalized: 'نهائية',
  paid: 'مدفوعة',
}
</script>

<template>
  <div v-if="settlement" dir="rtl" class="settlement-detail-view">
    <h2 class="settlement-title">{{ settlement.settlementNumber }} — {{ settlement.staffNameSnapshot }}</h2>
    <p class="status-row">الحالة: {{ statusLabel[settlement.status] ?? settlement.status }}</p>
    <p class="amount-row">المبلغ النهائي: ${{ settlement.finalAmountUsd?.toFixed(2) ?? '0.00' }}</p>
    <p v-if="settlement.notes" class="notes-row">{{ settlement.notes }}</p>

    <button
      v-if="settlement.status === 'finalized'"
      type="button"
      data-testid="mark-paid-button"
      class="btn-primary"
      @click="showPaidConfirm = true"
    >
      تسجيل كمدفوع
    </button>

    <div v-if="showPaidConfirm" role="dialog" class="confirm-overlay">
      <div class="confirm-box">
        <label class="field-label">طريقة الدفع</label>
        <select v-model="paymentMethod" class="form-input">
          <option value="cash">نقدي</option>
          <option value="bank">تحويل بنكي</option>
          <option value="other">أخرى</option>
        </select>
        <div class="action-row">
          <button type="button" class="btn-ghost" @click="showPaidConfirm = false">إلغاء</button>
          <button type="button" data-testid="confirm-paid-button" class="btn-primary" @click="onConfirmPaid">
            تأكيد الدفع
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settlement-detail-view {
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
}

.settlement-title { font-size: 1rem; font-weight: 700; margin: 0 0 0.5rem; }
.status-row, .amount-row, .notes-row { font-size: 0.875rem; color: #C8D5E8; margin: 0.25rem 0; }
.amount-row { font-weight: 700; font-variant-numeric: tabular-nums; }

.btn-primary {
  width: 100%;
  height: 44px;
  margin-top: 1rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
}

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

.field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  margin-bottom: 6px;
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
  box-sizing: border-box;
}

.action-row { display: flex; gap: 0.5rem; margin-top: 1rem; }

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
</style>
