<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { useLowStockAlerts } from '@/features/products/composables/useLowStockAlerts'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

const router       = useRouter()
const device       = useDeviceStore()
const { currentRate, loadRate } = useExchangeRate()
const { hasDraft, loadDraft, restoreDraft, clearDraft } = useSaleDraft()

const { count: lowStockCount, top3: lowStockTop3, allClear, load: loadAlerts } = useLowStockAlerts()

const todaySalesUsd = ref<number | null>(null)
const showDraftDialog = ref(false)

onMounted(async () => {
  try {
    await Promise.all([loadRate(), loadDraft(), loadAlerts()])
    if (hasDraft.value) showDraftDialog.value = true
    await loadTodaySales()
  } catch {
    if (todaySalesUsd.value === null) todaySalesUsd.value = 0
  }
})

async function loadTodaySales() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const result = await db.execute(
    `SELECT COALESCE(SUM(total_usd), 0) as total FROM sales WHERE shop_id = ? AND created_at >= ?`,
    [device.shopId, todayStart.toISOString()]
  )
  todaySalesUsd.value = ((result as any).rows._array[0] as any).total ?? 0
}

async function handleRestoreDraft() {
  await restoreDraft()
  showDraftDialog.value = false
  router.push('/pos')
}

async function handleDiscardDraft() {
  await clearDraft()
  showDraftDialog.value = false
}

const canStartSale = computed(() => currentRate.value !== null)

const arabicDate = new Intl.DateTimeFormat('ar-SY', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
}).format(new Date())
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-bg-void">
    <AppHeader title="وافي" :show-exchange-rate="true" />

    <main class="flex-1 px-4 py-6 max-w-lg mx-auto w-full">

      <!-- Date + greeting -->
      <p class="font-display-ar text-sm text-gold-primary opacity-60 mb-1">{{ arabicDate }}</p>
      <h1 class="font-display text-2xl font-light text-text-primary mb-6">مرحباً</h1>

      <!-- Today sales card -->
      <div
        class="glass-md p-5 mb-4 relative overflow-hidden"
        style="border: 1px solid rgb(201 168 76 / 0.25)"
      >
        <p class="text-sm text-text-muted mb-1">مبيعات اليوم</p>
        <p v-if="todaySalesUsd !== null" class="font-display text-4xl text-text-primary">
          <span class="text-platinum">$</span>
          <span class="text-gold-primary">{{ todaySalesUsd.toFixed(2) }}</span>
        </p>
        <p v-else class="text-text-muted text-sm">جارٍ التحميل...</p>
      </div>

      <!-- Low-stock card -->
      <RouterLink
        to="/products?filter=low-stock"
        class="block bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 mb-4 no-underline"
        data-testid="low-stock-card"
      >
        <div class="flex items-center justify-between">
          <div>
            <p v-if="allClear" class="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ كل المنتجات متوفرة
            </p>
            <template v-else>
              <p class="text-sm text-yellow-600 dark:text-yellow-400 font-semibold mb-1">
                ⚠ مخزون منخفض ({{ lowStockCount }})
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ lowStockTop3.map(p => p.nameAr).join('، ') }}
              </p>
            </template>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-400 rtl:rotate-180" fill="none"
            viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </div>
      </RouterLink>

      <!-- No rate warning -->
      <div
        v-if="!currentRate"
        id="no-rate-warning"
        class="rounded-xl p-4 mb-4 text-sm flex gap-3 items-start"
        style="background: rgb(251 191 36 / 0.08); border: 1px solid rgb(251 191 36 / 0.30); color: rgb(253 224 132)"
      >
        <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
        </svg>
        <span>حدد سعر صرف الدولار من الأعلى قبل البدء في البيع.</span>
      </div>

      <!-- New sale button -->
      <button
        type="button"
        :disabled="!canStartSale"
        aria-describedby="no-rate-warning"
        class="btn-gold w-full mb-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        @click="router.push('/pos')"
      >
        بيع جديد
      </button>

      <!-- History button -->
      <button
        type="button"
        class="btn-ghost w-full"
        @click="router.push('/history')"
      >
        آخر المبيعات
      </button>

    </main>
  </div>

  <!-- Draft recovery dialog (unchanged) -->
  <AppDialog
    v-if="showDraftDialog"
    title="بيع غير مكتمل"
    message="يوجد بيع لم يتم تأكيده. هل تريد المتابعة؟"
    confirm-label="متابعة"
    cancel-label="تجاهل"
    @confirm="handleRestoreDraft"
    @cancel="handleDiscardDraft"
  />
</template>
