<!-- src/features/customers/components/InstallmentPlanSection.vue -->
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useInstallmentPlan } from '@/features/installments/composables/useInstallmentPlan'
import { useSendInstallmentReminder, WhatsAppPreviewSheet } from '@/features/messaging'
import { dueBucket } from '@/features/installments/installment.types'
import type { InstallmentPlan, InstallmentDue } from '@/features/installments/installment.types'

const props = defineProps<{
  customerId:    string
  customerName:  string
  customerPhone: string | null
  shopName:      string
}>()

const { loadActivePlanForCustomer, recordDuePayment, cancelPlan } = useInstallmentPlan()
const sendReminder = useSendInstallmentReminder()

const plan = ref<InstallmentPlan | null>(null)
const dues = ref<InstallmentDue[]>([])
const loading = ref(false)
const payingDueId = ref<string | null>(null)
const payAmountStr = ref('')
const error = ref<string | null>(null)
const showReminderSheet = ref(false)
const reminderPreview = ref<{ text: string; phone: string | null } | null>(null)
const showCancelConfirm = ref(false)

const today = new Date().toISOString().slice(0, 10)

const dueRows = computed(() =>
  dues.value.map(d => ({ ...d, bucket: dueBucket(d, today) })),
)

const nextPendingDue = computed(() =>
  dueRows.value.find(d => d.bucket !== 'paid' && d.bucket !== 'voided') ?? null,
)

const remainingUsd = computed(() =>
  dues.value.reduce((s, d) => s + (d.amountDueUsd - d.amountPaidUsd), 0),
)

async function reload() {
  loading.value = true
  try {
    const result = await loadActivePlanForCustomer(props.customerId)
    plan.value = result?.plan ?? null
    dues.value = result?.dues ?? []
  } finally {
    loading.value = false
  }
}

onMounted(reload)

function startPayment(dueId: string) {
  payingDueId.value = dueId
  payAmountStr.value = ''
  error.value = null
}

async function confirmPayment() {
  if (!payingDueId.value) return
  const amount = parseFloat(payAmountStr.value)
  if (isNaN(amount) || amount <= 0) {
    error.value = 'المبلغ غير صحيح'
    return
  }
  try {
    await recordDuePayment(payingDueId.value, amount)
    payingDueId.value = null
    await reload()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'تعذر تسجيل الدفعة'
  }
}

function openReminder() {
  if (!nextPendingDue.value) return
  const prepared = sendReminder.prepare({
    customerName: props.customerName,
    shopName: props.shopName,
    amountDueUsd: nextPendingDue.value.amountDueUsd - nextPendingDue.value.amountPaidUsd,
    dueDate: nextPendingDue.value.dueDate,
    remainingUsd: remainingUsd.value,
    phoneRaw: props.customerPhone ?? undefined,
  })
  reminderPreview.value = prepared
  showReminderSheet.value = true
}

function handleReminderSend(payload: { phone: string; text: string }) {
  sendReminder.send(payload.phone, payload.text)
  showReminderSheet.value = false
}

async function confirmCancelPlan() {
  if (!plan.value) return
  await cancelPlan(plan.value.planId)
  showCancelConfirm.value = false
  await reload()
}
</script>

<template>
  <div v-if="plan" class="installment-section" dir="rtl">
    <div class="section-hdr">
      <span class="section-title">خطة التقسيط</span>
      <button type="button" class="cancel-link" @click="showCancelConfirm = true">إلغاء الخطة</button>
    </div>

    <p class="plan-summary">
      الإجمالي ${{ plan.totalAmountUsd.toFixed(2) }} — دفعة أولى ${{ plan.downPaymentUsd.toFixed(2) }} —
      المتبقي ${{ remainingUsd.toFixed(2) }}
    </p>

    <button
      v-if="nextPendingDue"
      type="button"
      class="reminder-btn"
      @click="openReminder"
    >إرسال تذكير</button>

    <ul class="due-list">
      <li v-for="due in dueRows" :key="due.dueId" class="due-row" :class="`due-${due.bucket}`">
        <div class="due-info">
          <span class="due-date">{{ due.dueDate }}</span>
          <span class="due-amount">${{ due.amountDueUsd.toFixed(2) }}</span>
          <span class="due-badge">
            {{ due.bucket === 'paid' ? 'مدفوع' : due.bucket === 'voided' ? 'ملغى' : due.bucket === 'overdue' ? 'متأخر' : due.bucket === 'due' ? 'مستحق اليوم' : 'قادم' }}
          </span>
        </div>
        <button
          v-if="due.bucket !== 'paid' && due.bucket !== 'voided'"
          type="button"
          class="pay-btn"
          @click="startPayment(due.dueId)"
        >تسجيل دفعة</button>
      </li>
    </ul>

    <div v-if="payingDueId" class="pay-form">
      <input v-model="payAmountStr" type="number" inputmode="decimal" min="0" class="pay-input" placeholder="المبلغ" />
      <button type="button" class="pay-confirm-btn" @click="confirmPayment">تأكيد</button>
      <button type="button" class="pay-cancel-btn" @click="payingDueId = null">إلغاء</button>
    </div>
    <p v-if="error" class="section-error">{{ error }}</p>
  </div>

  <WhatsAppPreviewSheet
    v-if="showReminderSheet && reminderPreview"
    title="تذكير بالقسط"
    :text="reminderPreview.text"
    :phone="reminderPreview.phone"
    @send="handleReminderSend"
    @cancel="showReminderSheet = false"
  />

  <AppDialog
    v-if="showCancelConfirm"
    title="إلغاء خطة التقسيط"
    message="سيتم إلغاء كل الدفعات المتبقية غير المدفوعة. هل أنت متأكد؟"
    confirm-label="نعم، إلغاء"
    :danger="true"
    @confirm="confirmCancelPlan"
    @cancel="showCancelConfirm = false"
  />
</template>

<style scoped>
.installment-section {
  margin-bottom: 16px;
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.10), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(26, 86, 219, 0.24);
  font-family: 'Tajawal', system-ui, sans-serif;
}
.section-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.section-title { font-weight: 700; color: #E8EDF5; font-size: 15px; }
.cancel-link { background: none; border: none; color: #EF4444; font-size: 12px; cursor: pointer; }
.plan-summary { font-size: 13px; color: #C8D5E8; margin: 0 0 10px; }
.reminder-btn {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.12);
  color: #22C55E;
  font-weight: 700;
  cursor: pointer;
  margin-bottom: 10px;
}
.due-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.due-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}
.due-info { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #C8D5E8; }
.due-amount { font-weight: 700; color: #E8EDF5; }
.due-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); }
.due-overdue .due-badge { color: #EF4444; }
.due-due .due-badge { color: #F59E0B; }
.due-upcoming .due-badge { color: #637285; }
.due-paid .due-badge { color: #22C55E; }
.pay-btn {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(26, 86, 219, 0.30);
  background: rgba(26, 86, 219, 0.12);
  color: #60A5FA;
  font-size: 12px;
  cursor: pointer;
}
.pay-form { display: flex; gap: 8px; margin-top: 10px; }
.pay-input {
  flex: 1;
  height: 40px;
  border-radius: 8px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #E8EDF5;
}
.pay-confirm-btn, .pay-cancel-btn {
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  border: none;
}
.pay-confirm-btn { background: #1A56DB; color: #fff; }
.pay-cancel-btn { background: rgba(255,255,255,0.08); color: #C8D5E8; }
.section-error { color: #EF4444; font-size: 12px; margin-top: 8px; }
</style>
