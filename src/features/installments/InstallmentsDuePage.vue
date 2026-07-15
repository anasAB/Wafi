<!-- src/features/installments/InstallmentsDuePage.vue -->
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useInstallmentsDueAlert } from '@/features/installments/composables/useInstallmentsDueAlert'

const router = useRouter()
const { items, count, allClear, load } = useInstallmentsDueAlert()

onMounted(load)
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="الأقساط المستحقة" :show-back="true" @back="router.push('/')" />

    <div class="page-body">
      <div v-if="allClear" class="empty-card">
        <p class="empty-title">لا أقساط مستحقة</p>
      </div>

      <ul v-else class="due-list">
        <li v-for="item in items" :key="item.dueId" class="due-row">
          <RouterLink :to="`/customers/${item.customerId}`" class="due-link">
            <div class="due-main">
              <span class="due-customer">{{ item.customerName }}</span>
              <span class="due-date">{{ item.dueDate }}</span>
            </div>
            <span class="due-amount">${{ (item.amountDueUsd - item.amountPaidUsd).toFixed(2) }}</span>
          </RouterLink>
        </li>
      </ul>

      <p class="summary-count">{{ count }} قسط مستحق أو متأخر</p>
    </div>
  </div>
</template>

<style scoped>
.page-root { min-height: 100dvh; background: #06090F; color: #E8EDF5; font-family: 'Tajawal', system-ui, sans-serif; }
.page-body { padding: 16px; }
.empty-card { text-align: center; padding: 40px 16px; color: #637285; }
.empty-title { font-weight: 700; }
.due-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.due-row { border-radius: 12px; background: rgba(26, 86, 219, 0.08); border: 1px solid rgba(26, 86, 219, 0.18); }
.due-link { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; color: inherit; text-decoration: none; }
.due-main { display: flex; flex-direction: column; gap: 2px; }
.due-customer { font-weight: 700; }
.due-date { font-size: 12px; color: #637285; }
.due-amount { font-weight: 800; color: #60A5FA; }
.summary-count { margin-top: 12px; font-size: 13px; color: #637285; text-align: center; }
</style>
