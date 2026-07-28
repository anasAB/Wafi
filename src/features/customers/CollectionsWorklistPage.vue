<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import RecordPaymentSheet from './components/RecordPaymentSheet.vue'
import { WhatsAppPreviewSheet, useSendStatement } from '@/features/messaging'
import { useCollectionsWorklist } from './composables/useCollectionsWorklist'
import type { CollectionsSortOption } from './composables/useCollectionsWorklist'
import { useCustomerBalance } from './composables/useCustomerBalance'
import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'
import type { CollectionsWorklistRow, OpenInvoice } from './customer.types'

const router = useRouter()
const { debtorRows, creditRows, sort, load, markReminded } = useCollectionsWorklist()
const { settings: receiptSettings, load: loadReceiptSettings } = useReceiptSettings()
const sendStatement = useSendStatement()

const toast = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const payingRow = ref<CollectionsWorklistRow | null>(null)
const payingInvoices = ref<OpenInvoice[]>([])
const remindingId = ref<string | null>(null)
const showStatement = ref(false)
const statementPreview = ref<{ text: string; phone: string | null; imageDataUrl: string | null } | null>(null)
const statementForRow = ref<CollectionsWorklistRow | null>(null)

onMounted(async () => {
  await Promise.all([load(), loadReceiptSettings()])
})

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

function setSort(value: CollectionsSortOption) {
  sort.value = value
}

function buildPeriodLabel(): string {
  const today = new Intl.DateTimeFormat('ar-SY', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date())
  return `كشف حساب حتى ${today}`
}

async function openPayment(row: CollectionsWorklistRow) {
  const { openInvoices, load: loadBalance } = useCustomerBalance(row.customerId)
  await loadBalance()
  payingInvoices.value = openInvoices.value
  payingRow.value = row
}

async function handlePaymentSaved() {
  payingRow.value = null
  toast.value = { message: 'تم تسجيل الدفعة', type: 'success' }
  await load()
}

async function openReminder(row: CollectionsWorklistRow) {
  if (!row.phone) return
  remindingId.value = row.customerId
  try {
    const { openInvoices, load: loadBalance } = useCustomerBalance(row.customerId)
    await loadBalance()
    const preview = await sendStatement.prepareWithImage({
      customerName: row.customerName,
      shopName:     receiptSettings.value.shopName || 'المحل',
      periodLabel:  buildPeriodLabel(),
      balanceUsd:   row.balanceUsd,
      openInvoices: openInvoices.value,
      phoneRaw:     row.phone,
    })
    statementPreview.value = preview
    statementForRow.value = row
    showStatement.value = true
  } catch {
    toast.value = { message: 'تعذر تحضير رسالة التذكير', type: 'error' }
  } finally {
    remindingId.value = null
  }
}

async function handleStatementSent(payload: { phone: string; text: string }) {
  sendStatement.send(payload.phone, payload.text)
  if (statementForRow.value) {
    await markReminded(statementForRow.value.customerId)
  }
  showStatement.value = false
  toast.value = { message: 'تم إرسال التذكير', type: 'success' }
}

function handleStatementCancel() {
  showStatement.value = false
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="متابعة التحصيل" :show-back="true" @back="router.back()" />

    <main class="page-main">
      <RouterLink to="/customers/money-owed" data-testid="money-owed-link" class="money-owed-link">
        عرض المبالغ المستحقة (دين + أقساط) ←
      </RouterLink>

      <!-- Sort options -->
      <div class="sort-row">
        <button type="button" class="sort-chip" :class="{ active: sort === 'balance_desc' }" @click="setSort('balance_desc')">الأكبر رصيداً</button>
        <button type="button" class="sort-chip" :class="{ active: sort === 'oldest_first' }" @click="setSort('oldest_first')">الأقدم ديناً</button>
        <button type="button" class="sort-chip" :class="{ active: sort === 'last_reminded_asc' }" @click="setSort('last_reminded_asc')">آخر تذكير</button>
      </div>

      <EmptyState
        v-if="debtorRows.length === 0"
        title="لا يوجد زبائن مدينون"
        subtitle="جميع الحسابات مسوّاة حالياً"
      />

      <div v-else class="list">
        <div v-for="row in debtorRows" :key="row.customerId" class="row-card">
          <div class="row-info" @click="router.push(`/customers/${row.customerId}`)">
            <p class="row-name">{{ row.customerName }}</p>
            <p class="row-meta">
              منذ {{ row.daysOutstanding }} يوم
              <span v-if="row.lastPaymentDate"> · آخر دفعة {{ formatDate(row.lastPaymentDate) }}</span>
              <span v-if="row.lastRemindedAt"> · تم التذكير {{ formatDate(row.lastRemindedAt) }}</span>
            </p>
          </div>
          <div class="row-actions">
            <p class="row-balance" dir="ltr">${{ row.balanceUsd.toFixed(2) }}</p>
            <div class="row-buttons">
              <button
                type="button"
                :data-testid="`remind-${row.customerId}`"
                class="btn-remind"
                :disabled="!row.phone || remindingId === row.customerId"
                :title="!row.phone ? 'أضف رقم هاتف' : undefined"
                @click="openReminder(row)"
              >تذكير</button>
              <button
                type="button"
                :data-testid="`pay-${row.customerId}`"
                class="btn-pay"
                @click="openPayment(row)"
              >تسجيل دفعة</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="creditRows.length > 0" class="section credit-section">
        <p class="section-label">لهم رصيد لديك</p>
        <div class="list">
          <div v-for="row in creditRows" :key="row.customerId" class="row-card" @click="router.push(`/customers/${row.customerId}`)">
            <p class="row-name">{{ row.customerName }}</p>
            <p class="row-balance row-credit" dir="ltr">${{ Math.abs(row.balanceUsd).toFixed(2) }}</p>
          </div>
        </div>
      </div>
    </main>

    <RecordPaymentSheet
      v-if="payingRow"
      :customer-id="payingRow.customerId"
      :customer-name="payingRow.customerName"
      :open-invoices="payingInvoices"
      @saved="handlePaymentSaved"
      @cancel="payingRow = null"
    />

    <WhatsAppPreviewSheet
      v-if="showStatement && statementPreview"
      title="تذكير بالدفع"
      :text="statementPreview.text"
      :phone="statementPreview.phone"
      :image-data-url="statementPreview.imageDataUrl"
      @send="handleStatementSent"
      @cancel="handleStatementCancel"
    />

    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.page-main { flex: 1; padding: 1rem 1rem 6rem; max-width: 42rem; margin: 0 auto; width: 100%; }

.money-owed-link {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.82rem;
  font-weight: 700;
  color: #60A5FA;
  text-decoration: none;
}

.sort-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }

.sort-chip {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  color: #9FB0C7;
  cursor: pointer;
  font-family: inherit;
}

.sort-chip.active {
  background: rgba(26,86,219,0.20);
  border-color: rgba(26,86,219,0.55);
  color: #60A5FA;
}

.list { display: flex; flex-direction: column; gap: 0.6rem; }

.row-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-radius: 0.9rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
}

.row-info { cursor: pointer; min-width: 0; }

.row-name { font-size: 0.875rem; font-weight: 700; color: #E8EDF5; }

.row-meta { font-size: 0.72rem; color: #637285; margin-top: 0.2rem; }

.row-actions { text-align: left; flex-shrink: 0; }

.row-balance { font-size: 0.95rem; font-weight: 800; color: #F59E0B; }

.row-credit { color: #22C55E; }

.row-buttons { display: flex; gap: 0.4rem; margin-top: 0.4rem; }

.btn-remind, .btn-pay {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.35rem 0.65rem;
  border-radius: 0.6rem;
  cursor: pointer;
  font-family: inherit;
  border: none;
}

.btn-remind {
  background: rgba(37, 211, 102, 0.12);
  color: #25D366;
  border: 1px solid rgba(37, 211, 102, 0.30);
}

.btn-remind:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-pay {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
}

.section { margin-top: 1.5rem; }

.section-label { font-size: 0.78rem; font-weight: 700; color: #9FB0C7; margin-bottom: 0.6rem; }

.credit-section .row-card { cursor: pointer; }
</style>
