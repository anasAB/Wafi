<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useCustomerIntelligence } from '../composables/useCustomerIntelligence'
import { useSendChurnReminder } from '@/features/messaging/useSendChurnReminder'
import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'

const props = defineProps<{ expanded: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()
const router = useRouter()
const { data, state, load } = useCustomerIntelligence()
const { prepare, send } = useSendChurnReminder()
const { settings: receiptSettings, load: loadReceiptSettings } = useReceiptSettings()

async function reload() {
  await Promise.all([load(), loadReceiptSettings()])
}

defineExpose({ reload })

const headline = computed(() =>
  data.value ? t('dashboard2.customer.headline', { count: data.value.inactiveCount }) : ''
)

function reminderPhone(row: { phone?: string | null; mobile?: string | null }): string | null {
  const prepared = prepare({ customerName: '', shopName: '', phoneRaw: row.phone || row.mobile || undefined })
  return prepared.phone
}

function sendReminder(row: { customerName: string; phone?: string | null; mobile?: string | null }) {
  const prepared = prepare({
    customerName: row.customerName,
    shopName: receiptSettings.value.shopName || 'المحل',
    phoneRaw: row.phone || row.mobile || undefined,
  })
  if (prepared.phone) send(prepared.phone, prepared.text)
}
</script>

<template>
  <IntelligenceCard :state="state" :expanded="props.expanded" @toggle="emit('toggle')" @retry="reload">
    <template #headline>{{ headline }}</template>

    <ul v-if="data" class="cust-list">
      <li v-for="row in data.inactiveCustomers" :key="row.customerId" class="cust-row">
        <div class="cust-row-main">
          <span>{{ row.customerName }}</span>
          <span class="cust-row-days" dir="ltr">{{ t('dashboard2.customer.lastPurchase', { days: row.daysSincePurchase }) }}</span>
        </div>
        <div class="cust-row-actions">
          <button
            v-if="reminderPhone(row)"
            type="button"
            :data-testid="`send-reminder-${row.customerId}`"
            class="cust-action-link"
            @click="sendReminder(row)"
          >
            {{ t('dashboard2.customer.sendReminder') }}
          </button>
          <button
            type="button"
            :data-testid="`view-detail-${row.customerId}`"
            class="cust-action-link"
            @click="router.push(`/customers/${row.customerId}`)"
          >
            {{ t('dashboard2.customer.viewDetail') }}
          </button>
        </div>
      </li>
    </ul>
  </IntelligenceCard>
</template>

<style scoped>
.cust-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.cust-row { border-bottom: 1px solid rgba(255,255,255,.05); padding-bottom: 8px; }
.cust-row-main { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #E8EDF5; }
.cust-row-days { color: #637285; }
.cust-row-actions { display: flex; gap: 12px; margin-top: 4px; }
.cust-action-link { border: none; background: transparent; color: #60A5FA; font-size: 11px; cursor: pointer; padding: 0; }
</style>
