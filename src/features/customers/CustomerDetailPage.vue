<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import CustomerForm from './components/CustomerForm.vue'
import RecordPaymentSheet from './components/RecordPaymentSheet.vue'
import { useCustomers } from './composables/useCustomers'
import { useCustomerBalance } from './composables/useCustomerBalance'
import type { Customer } from './customer.types'

const router = useRouter()
const route  = useRoute()
const customerId = route.params.id as string

const { customers, load: loadCustomers, softDelete } = useCustomers()
const { balanceUsd, openInvoices, payments, load: loadBalance } = useCustomerBalance(customerId)

const customer    = ref<Customer | undefined>(undefined)
const showPayment = ref(false)
const showEdit    = ref(false)
const showDelete  = ref(false)
const toast       = ref<{ message: string; type: 'success' | 'error' } | null>(null)

onMounted(async () => {
  await Promise.all([loadCustomers(), loadBalance()])
  customer.value = customers.value.find(c => c.id === customerId)
})

const isSettled = computed(() => balanceUsd.value <= 0.001)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

async function handlePaymentSaved() {
  showPayment.value = false
  toast.value = { message: 'تم تسجيل الدفعة', type: 'success' }
  await loadBalance()
}

async function handleEditSaved() {
  showEdit.value = false
  toast.value = { message: 'تم حفظ التغييرات', type: 'success' }
  await loadCustomers()
  customer.value = customers.value.find(c => c.id === customerId)
}

async function handleDelete() {
  await softDelete(customerId)
  router.push('/customers')
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader
      :title="customer?.name ?? '...'"
      :show-back="true"
      @back="router.back()"
    />

    <main v-if="customer" class="page-main">
      <div class="content-grid">

        <!-- LEFT COLUMN: Profile card + delete -->
        <div class="left-col">

          <!-- Profile card -->
          <div class="profile-card">
            <!-- Name + edit -->
            <div class="profile-top">
              <div class="profile-info">
                <h2 class="profile-name">{{ customer.name }}</h2>
                <div v-if="customer.phone" class="contact-row">
                  <svg class="contact-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  <span class="contact-text">{{ customer.phone }}</span>
                </div>
                <div v-if="customer.mobile" class="contact-row">
                  <svg class="contact-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                  </svg>
                  <span class="contact-text">{{ customer.mobile }}</span>
                </div>
                <div v-if="customer.address" class="contact-row">
                  <svg class="contact-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <span class="contact-text">{{ customer.address }}</span>
                </div>
              </div>
              <button type="button" class="edit-btn" @click="showEdit = true">تعديل</button>
            </div>

            <!-- Balance -->
            <div class="balance-section">
              <p v-if="isSettled" class="balance-settled">مسوّى ✓</p>
              <template v-else>
                <p class="balance-amount" dir="ltr">${{ balanceUsd.toFixed(2) }}</p>
                <p class="balance-label">إجمالي المديونية</p>
              </template>
            </div>

            <!-- Pay button -->
            <div class="pay-section">
              <button
                type="button"
                data-testid="record-payment-btn"
                :disabled="isSettled"
                class="btn-primary btn-pay"
                @click="showPayment = true"
              >تسجيل دفعة</button>
            </div>
          </div>

          <!-- Delete link -->
          <button type="button" class="delete-link" @click="showDelete = true">حذف الزبون</button>
        </div>

        <!-- RIGHT COLUMN: invoices + payments -->
        <div class="right-col">

          <!-- Open invoices -->
          <div v-if="openInvoices.length > 0" class="section">
            <p class="section-label">فواتير مفتوحة</p>
            <div class="items-list">
              <div
                v-for="inv in openInvoices"
                :key="inv.saleId"
                :data-testid="`open-invoice-${inv.saleId}`"
                class="invoice-card"
              >
                <div>
                  <p class="invoice-number">{{ inv.displayNumber }}</p>
                  <p class="item-muted">{{ formatDate(inv.saleDate) }}</p>
                  <p class="item-muted truncate" style="max-width: 180px">{{ inv.itemsSummary }}</p>
                </div>
                <div style="text-align: left">
                  <p class="invoice-amount">{{ inv.remainingUsd.toFixed(2) }}$</p>
                  <p class="item-muted">من ${{ inv.totalUsd.toFixed(2) }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Payment history -->
          <div v-if="payments.length > 0" class="section">
            <p class="section-label">سجل الدفعات</p>
            <div class="items-list">
              <div
                v-for="p in payments"
                :key="p.id"
                class="payment-row"
              >
                <span class="item-muted">{{ formatDate(p.paidAt) }}</span>
                <span class="payment-amount">+${{ p.amountUsd.toFixed(2) }}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </main>

    <div v-else class="loading-state">جارٍ التحميل...</div>
  </div>

  <RecordPaymentSheet
    v-if="showPayment && customer"
    :customer-id="customerId"
    :customer-name="customer.name"
    :open-invoices="openInvoices"
    @saved="handlePaymentSaved"
    @cancel="showPayment = false"
  />

  <Teleport v-if="showEdit && customer" to="body">
    <div class="modal-overlay" @click.self="showEdit = false">
      <div class="modal-sheet" dir="rtl">
        <div class="sheet-handle"></div>
        <div class="modal-inner">
          <h2 class="modal-title">تعديل بيانات الزبون</h2>
          <CustomerForm :initial="customer" @saved="handleEditSaved" @cancel="showEdit = false" />
        </div>
      </div>
    </div>
  </Teleport>

  <AppDialog
    v-if="showDelete"
    title="حذف الزبون"
    message="سيتم حذف الزبون ولن يظهر في القائمة. سجلات الديون والمبيعات ستبقى."
    confirm-label="حذف"
    cancel-label="إلغاء"
    :danger="true"
    @confirm="handleDelete"
    @cancel="showDelete = false"
  />

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>

<style scoped>
/* ── Page shell ─────────────────────────────────────────── */
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.page-main {
  flex: 1;
  padding: 1rem 1rem 1.5rem;
  width: 100%;
}

@media (min-width: 1024px) {
  .page-main { padding: 1.25rem 1.5rem 1.5rem; }
}

/* ── Content grid ────────────────────────────────────────── */
.content-grid {
  max-width: 56rem;
  margin: 0 auto;
}

@media (min-width: 1024px) {
  .content-grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 1.5rem;
    align-items: start;
    max-width: none;
    margin: 0;
  }
}

/* ── Left column ─────────────────────────────────────────── */
.left-col {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

/* ── Profile card ────────────────────────────────────────── */
.profile-card {
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
  margin-bottom: 1rem;
}

.profile-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 1rem;
}

.profile-info { flex: 1; min-width: 0; }

.profile-name {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.375rem;
}

.contact-icon {
  width: 0.875rem;
  height: 0.875rem;
  color: #637285;
  flex-shrink: 0;
}

.contact-text { font-size: 0.75rem; color: #637285; }

.edit-btn {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.375rem 0.75rem;
  border-radius: 0.5rem;
  color: #60A5FA;
  background: rgba(26,86,219,0.12);
  border: 1px solid rgba(26,86,219,0.25);
  cursor: pointer;
  flex-shrink: 0;
  margin-inline-start: 0.75rem;
  transition: background 0.12s;
  font-family: inherit;
}

.edit-btn:hover { background: rgba(26,86,219,0.20); }

/* ── Balance section ─────────────────────────────────────── */
.balance-section {
  text-align: center;
  padding: 1.25rem 1rem;
  border-top: 1px solid rgba(26,86,219,0.14);
}

.balance-settled {
  font-size: 1.125rem;
  font-weight: 700;
  color: #22C55E;
}

.balance-amount {
  font-size: 1.875rem;
  font-weight: 800;
  color: #EF4444;
}

.balance-label {
  font-size: 0.75rem;
  color: #637285;
  margin-top: 0.25rem;
}

/* ── Pay section ─────────────────────────────────────────── */
.pay-section {
  padding: 1rem;
  border-top: 1px solid rgba(26,86,219,0.14);
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 44px;
  padding-inline: 1.5rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
  transition: opacity 0.15s, box-shadow 0.15s, transform 0.1s;
  font-family: inherit;
}

.btn-primary:hover { opacity: 0.88; box-shadow: 0 6px 24px rgba(26,86,219,0.55); }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.3; cursor: not-allowed; }

.btn-pay { width: 100%; }

/* ── Delete link ─────────────────────────────────────────── */
.delete-link {
  font-size: 0.75rem;
  color: #EF4444;
  background: none;
  border: none;
  cursor: pointer;
  text-align: right;
  padding: 0.25rem 0.25rem;
  transition: color 0.12s;
  font-family: inherit;
}

.delete-link:hover { color: #f87171; }

/* ── Right column ────────────────────────────────────────── */
.right-col { display: flex; flex-direction: column; }

.section { margin-bottom: 1.5rem; }

.section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #637285;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.5rem;
  padding-inline-start: 0.25rem;
}

.items-list { display: flex; flex-direction: column; gap: 0.5rem; }

/* ── Invoice card ────────────────────────────────────────── */
.invoice-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(245,158,11,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.06);
}

.invoice-number {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

.invoice-amount {
  font-size: 0.875rem;
  font-weight: 700;
  color: #F59E0B;
}

.item-muted { font-size: 0.75rem; color: #637285; }

/* ── Payment row ─────────────────────────────────────────── */
.payment-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.625rem 0.75rem;
  border-radius: 0.75rem;
  font-size: 0.75rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(255,255,255,0.07);
}

.payment-amount {
  font-weight: 600;
  color: #22C55E;
}

/* ── Loading state ───────────────────────────────────────── */
.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  font-size: 0.875rem;
}

/* ── Modal overlay ───────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
}

/* ── Modal sheet ─────────────────────────────────────────── */
.modal-sheet {
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
  width: 2.25rem;
  height: 0.25rem;
  background: rgba(255,255,255,0.20);
  border-radius: 9999px;
  margin: 0.75rem auto 1.25rem;
}

.modal-inner { padding: 0 1.25rem 1.5rem; }

.modal-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
  margin-bottom: 1rem;
}
</style>
