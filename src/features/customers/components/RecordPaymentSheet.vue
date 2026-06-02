<script setup lang="ts">
import { ref, computed } from 'vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useCustomerBalance } from '@/features/customers/composables/useCustomerBalance'
import type { OpenInvoice, PaymentAllocation } from '@/features/customers/customer.types'

const props = defineProps<{
  customerId:   string
  customerName: string
  openInvoices: OpenInvoice[]
}>()

const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>()

const { currentRate }   = useExchangeRate()
const { recordPayment } = useCustomerBalance(props.customerId)

const currency    = ref<'USD' | 'SYP'>('USD')
// Use array instead of Set for Vue 3 reactivity
const selectedIds = ref<string[]>([])
const amounts     = ref<Record<string, number>>(
  Object.fromEntries(props.openInvoices.map(inv => [inv.saleId, inv.remainingUsd]))
)
const saving = ref(false)

function isSelected(saleId: string): boolean {
  return selectedIds.value.includes(saleId)
}

function toggleInvoice(saleId: string) {
  if (isSelected(saleId)) {
    selectedIds.value = selectedIds.value.filter(id => id !== saleId)
  } else {
    selectedIds.value = [...selectedIds.value, saleId]
  }
}

const totalUsd = computed(() => {
  let total = 0
  for (const saleId of selectedIds.value) {
    const raw = amounts.value[saleId] ?? 0
    total += currency.value === 'USD' ? raw : (currentRate.value ? raw / currentRate.value : raw)
  }
  return total
})

const hasSelection = computed(() => selectedIds.value.length > 0)

async function handleConfirm() {
  if (!hasSelection.value) return
  saving.value = true
  try {
    const allocations: PaymentAllocation[] = []
    for (const saleId of selectedIds.value) {
      const raw = amounts.value[saleId] ?? 0
      const amountUsd = currency.value === 'USD'
        ? raw
        : (currentRate.value ? raw / currentRate.value : raw)
      allocations.push({
        saleId,
        amountUsd,
        currency:              currency.value,
        amountRaw:             raw,
        exchangeRateAtPayment: currentRate.value ?? undefined,
      })
    }
    await recordPayment(allocations)
    emit('saved')
  } finally {
    saving.value = false
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric' }).format(new Date(iso))
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      @click.self="emit('cancel')"
    >
      <div class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-5 shadow-xl" dir="rtl">
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-4"></div>
        <h2 class="text-base font-semibold text-text-primary mb-1">تسجيل دفعة</h2>
        <p class="text-sm text-text-muted mb-4">{{ customerName }}</p>

        <!-- Currency toggle -->
        <div class="flex bg-surface-raised rounded-xl p-1 gap-1 mb-4 w-fit">
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors"
            :class="currency === 'USD' ? 'bg-bg-void text-text-primary shadow-sm' : 'text-text-muted'"
            @click="currency = 'USD'"
          >USD</button>
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors"
            :class="currency === 'SYP' ? 'bg-bg-void text-text-primary shadow-sm' : 'text-text-muted'"
            @click="currency = 'SYP'"
          >SYP</button>
        </div>

        <!-- Invoice list -->
        <div class="flex flex-col gap-2 mb-4 max-h-52 overflow-y-auto">
          <div
            v-for="inv in openInvoices"
            :key="inv.saleId"
            :data-testid="`invoice-${inv.saleId}`"
            class="flex items-center gap-3 p-3 rounded-xl border transition-colors cursor-pointer"
            :class="isSelected(inv.saleId)
              ? 'border-gold-primary bg-surface-raised'
              : 'border-border-glass'"
            @click="toggleInvoice(inv.saleId)"
          >
            <button
              type="button"
              :data-testid="`checkbox-${inv.saleId}`"
              class="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
              :class="isSelected(inv.saleId) ? 'bg-gold-primary border-gold-primary text-bg-void' : 'border-border-glass'"
              @click.stop="toggleInvoice(inv.saleId)"
            >
              <svg v-if="isSelected(inv.saleId)" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>

            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-center">
                <span class="text-xs font-semibold text-text-primary">{{ inv.displayNumber }}</span>
                <span class="text-xs text-text-muted">{{ formatDate(inv.saleDate) }}</span>
              </div>
              <p class="text-xs text-text-muted truncate">{{ inv.itemsSummary }}</p>
            </div>

            <div class="shrink-0">
              <input
                v-if="isSelected(inv.saleId)"
                :data-testid="`amount-${inv.saleId}`"
                type="number"
                min="0.01"
                :max="inv.remainingUsd"
                step="0.01"
                :value="amounts[inv.saleId]"
                class="w-20 text-center text-sm font-semibold bg-surface-glass border border-gold-primary/40
                       rounded-lg px-2 py-1 text-text-primary focus:outline-none"
                @click.stop
                @input="amounts[inv.saleId] = parseFloat(($event.target as HTMLInputElement).value) || 0"
              />
              <span v-else class="text-xs font-semibold text-amber-400">${{ inv.remainingUsd.toFixed(2) }}</span>
            </div>
          </div>
        </div>

        <!-- Total -->
        <div class="flex justify-between items-center py-3 border-t border-border-glass mb-4">
          <span class="text-sm font-semibold text-text-primary">إجمالي الدفعة</span>
          <span class="text-base font-bold text-green-400">${{ totalUsd.toFixed(2) }}</span>
        </div>

        <!-- Buttons -->
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="confirm-btn"
            :disabled="!hasSelection || saving"
            class="flex-1 h-11 rounded-xl text-sm font-semibold text-bg-void disabled:opacity-40 transition-colors"
            style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
            @click="handleConfirm"
          >{{ saving ? '...' : 'تأكيد الدفعة' }}</button>

          <button
            type="button"
            data-testid="cancel-btn"
            class="h-11 px-5 rounded-xl text-sm text-text-muted border border-border-glass"
            @click="emit('cancel')"
          >إلغاء</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
