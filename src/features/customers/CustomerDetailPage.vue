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
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader
      :title="customer?.name ?? '...'"
      :show-back="true"
      @back="router.back()"
    />

    <main v-if="customer" class="flex-1 px-4 py-4 max-w-lg mx-auto w-full pb-6">

      <!-- Profile -->
      <div class="glass-sm p-4 rounded-2xl mb-4">
        <div class="flex items-start justify-between mb-3">
          <div>
            <h2 class="text-base font-bold text-text-primary">{{ customer.name }}</h2>
            <p v-if="customer.phone"   class="text-xs text-text-muted mt-0.5">📱 {{ customer.phone }}</p>
            <p v-if="customer.mobile"  class="text-xs text-text-muted mt-0.5">📱 {{ customer.mobile }}</p>
            <p v-if="customer.address" class="text-xs text-text-muted mt-0.5">🏠 {{ customer.address }}</p>
          </div>
          <button
            type="button"
            class="text-xs text-text-muted underline"
            @click="showEdit = true"
          >تعديل</button>
        </div>

        <!-- Balance -->
        <div class="text-center py-4 border-t border-border-glass">
          <p v-if="isSettled" class="text-lg font-bold text-green-400">مسوّى ✓</p>
          <template v-else>
            <p class="text-3xl font-bold text-amber-400">${{ balanceUsd.toFixed(2) }}</p>
            <p class="text-xs text-text-muted mt-1">إجمالي المديونية</p>
          </template>
        </div>

        <!-- Pay button -->
        <button
          type="button"
          data-testid="record-payment-btn"
          :disabled="isSettled"
          class="w-full h-11 rounded-xl text-sm font-semibold text-bg-void mt-3 disabled:opacity-30 transition-colors"
          style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
          @click="showPayment = true"
        >تسجيل دفعة</button>
      </div>

      <!-- Open invoices -->
      <div v-if="openInvoices.length > 0" class="mb-4">
        <p class="text-xs font-semibold text-text-muted uppercase tracking-widest mb-2 px-1">فواتير مفتوحة</p>
        <div class="flex flex-col gap-2">
          <div
            v-for="inv in openInvoices"
            :key="inv.saleId"
            :data-testid="`open-invoice-${inv.saleId}`"
            class="glass-sm p-3 rounded-xl flex items-center justify-between"
            style="border-color: rgba(245,158,11,0.25)"
          >
            <div>
              <p class="text-sm font-semibold text-text-primary">{{ inv.displayNumber }}</p>
              <p class="text-xs text-text-muted">{{ formatDate(inv.saleDate) }}</p>
              <p class="text-xs text-text-muted truncate max-w-[180px]">{{ inv.itemsSummary }}</p>
            </div>
            <div class="text-left">
              <p class="text-sm font-bold text-amber-400">${{ inv.remainingUsd.toFixed(2) }}</p>
              <p class="text-xs text-text-muted">من ${{ inv.totalUsd.toFixed(2) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Payment history -->
      <div v-if="payments.length > 0" class="mb-6">
        <p class="text-xs font-semibold text-text-muted uppercase tracking-widest mb-2 px-1">سجل الدفعات</p>
        <div class="flex flex-col gap-1">
          <div
            v-for="p in payments"
            :key="p.id"
            class="flex justify-between items-center px-3 py-2 rounded-lg glass-sm text-xs"
          >
            <span class="text-text-muted">{{ formatDate(p.paidAt) }}</span>
            <span class="font-semibold text-green-400">+${{ p.amountUsd.toFixed(2) }}</span>
          </div>
        </div>
      </div>

      <!-- Danger zone -->
      <button
        type="button"
        class="text-xs text-red-500 underline mt-2"
        @click="showDelete = true"
      >حذف الزبون</button>

    </main>

    <div v-else class="flex-1 flex items-center justify-center text-text-muted text-sm">جارٍ التحميل...</div>
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
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      @click.self="showEdit = false"
    >
      <div class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-6 shadow-xl" dir="rtl">
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-5"></div>
        <h2 class="text-base font-semibold text-text-primary mb-4">تعديل بيانات الزبون</h2>
        <CustomerForm :initial="customer" @saved="handleEditSaved" @cancel="showEdit = false" />
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
