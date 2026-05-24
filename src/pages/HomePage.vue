<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useExchangeRate } from '@/features/exchange-rate'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

const router       = useRouter()
const device       = useDeviceStore()
const { currentRate, loadRate } = useExchangeRate()
const { hasDraft, loadDraft, restoreDraft, clearDraft } = useSaleDraft()

const todaySalesUsd = ref<number | null>(null)
const showDraftDialog = ref(false)

onMounted(async () => {
  await Promise.all([loadRate(), loadDraft()])
  if (hasDraft.value) showDraftDialog.value = true
  await loadTodaySales()
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
  <div class="flex flex-col min-h-dvh">
    <AppHeader title="وافي" :show-exchange-rate="true" />

    <main class="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">{{ arabicDate }}</p>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">مرحباً 👋</h1>

      <!-- Today sales card -->
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 mb-4">
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-1">مبيعات اليوم</p>
        <p v-if="todaySalesUsd !== null" class="text-3xl font-bold text-gray-900 dark:text-white">
          ${{ todaySalesUsd.toFixed(2) }}
        </p>
        <p v-else class="text-gray-400 text-sm">جارٍ التحميل...</p>
      </div>

      <!-- No rate warning -->
      <div
        v-if="!currentRate"
        class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-xl p-4 mb-4 text-sm text-yellow-800 dark:text-yellow-200"
      >
        حدد سعر صرف الدولار من الأعلى قبل البدء في البيع.
      </div>

      <!-- New sale button -->
      <button
        type="button"
        :disabled="!canStartSale"
        class="w-full h-14 rounded-2xl text-lg font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        @click="router.push('/pos')"
      >
        بيع جديد
      </button>

      <button
        type="button"
        class="w-full mt-3 h-12 rounded-2xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        @click="router.push('/history')"
      >
        آخر المبيعات
      </button>
    </main>
  </div>

  <!-- Draft recovery dialog -->
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
