<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import ExpenseForm from './components/ExpenseForm.vue'
import { useExpenses } from './composables/useExpenses'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import type { Expense } from './expense.types'

const router = useRouter()
const route = useRoute()
const { expenses, load, deleteExpense } = useExpenses()
const { period, setPeriod } = usePeriodToggle()

const editingExpense = ref<Expense | null>(null)
const deleteTarget   = ref<string | null>(null)
const toast          = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const loading        = ref(false)

const periodTitle = computed(() => {
  const labels: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
  return `مصاريف ${labels[period.value] ?? ''}`
})

const periodTotal = computed(() =>
  expenses.value.reduce((sum, e) => sum + e.amountUsd, 0)
)

async function reload() {
  loading.value = true
  try {
    const { start, end } = getDateRange(period.value)
    await load(start, end)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  const p = route.query.period as string | undefined
  if (p === 'today' || p === 'week' || p === 'month') {
    setPeriod(p)
  }
  await reload()
})
watch(period, reload)

function formatDate(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await deleteExpense(deleteTarget.value)
    deleteTarget.value = null
    toast.value = { message: 'تم حذف المصروف', type: 'success' }
  } catch {
    toast.value = { message: 'فشل الحذف', type: 'error' }
  }
}

function handleExpenseSaved() {
  editingExpense.value = null
  toast.value = { message: 'تم حفظ المصروف', type: 'success' }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-gray-50 dark:bg-gray-950" dir="rtl">
    <AppHeader
      :title="periodTitle"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/')"
    />

    <!-- Period toggle -->
    <div class="px-4 pt-3 pb-2 max-w-2xl mx-auto w-full">
      <PeriodToggle />
    </div>

    <main class="flex-1 px-4 pb-6 max-w-2xl mx-auto w-full">

      <!-- Period total -->
      <div v-if="expenses.length > 0" class="text-sm font-semibold text-orange-500 dark:text-orange-400 mb-3 text-left">
        إجمالي: ${{ periodTotal.toFixed(2) }}
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center py-10">
        <div class="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin border-orange-400" />
      </div>

      <!-- Empty state -->
      <div v-else-if="expenses.length === 0" class="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
        <span class="text-4xl">💰</span>
        <p class="text-sm">لا توجد مصاريف في هذه الفترة</p>
      </div>

      <!-- Expense list — phone cards -->
      <div v-else class="flex flex-col gap-3 sm:hidden">
        <div
          v-for="e in expenses"
          :key="e.id"
          :data-testid="`expense-row-${e.id}`"
          class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
          @click="editingExpense = e"
        >
          <div class="flex-1">
            <div class="flex justify-between items-center mb-1">
              <span class="text-base font-bold text-gray-900 dark:text-white">${{ e.amountUsd.toFixed(2) }}</span>
              <span class="text-xs text-gray-400">{{ formatDate(e.createdAt) }}</span>
            </div>
            <div class="text-sm text-gray-500 dark:text-gray-400">{{ e.category }}</div>
            <div v-if="e.notes" class="text-xs text-gray-400 truncate mt-0.5">{{ e.notes }}</div>
          </div>
          <div v-if="e.photoUrl" class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
            <img :src="e.photoUrl" :alt="e.category" class="w-full h-full object-cover" />
          </div>
        </div>
      </div>

      <!-- Expense table — desktop -->
      <div class="hidden sm:block overflow-x-auto">
        <table class="w-full text-sm text-right">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500">
              <th class="py-3 px-2 font-medium">التاريخ</th>
              <th class="py-3 px-2 font-medium">الفئة</th>
              <th class="py-3 px-2 font-medium">المبلغ</th>
              <th class="py-3 px-2 font-medium">ملاحظات</th>
              <th class="py-3 px-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in expenses"
              :key="e.id"
              :data-testid="`expense-row-${e.id}`"
              class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
              @click="editingExpense = e"
            >
              <td class="py-3 px-2 text-gray-500">{{ formatDate(e.createdAt) }}</td>
              <td class="py-3 px-2 font-medium text-gray-900 dark:text-white">{{ e.category }}</td>
              <td class="py-3 px-2 font-semibold text-orange-500">${{ e.amountUsd.toFixed(2) }}</td>
              <td class="py-3 px-2 text-gray-400 truncate max-w-xs">{{ e.notes ?? '—' }}</td>
              <td class="py-3 px-2">
                <button
                  type="button"
                  class="text-xs text-gray-400 hover:text-red-500 px-2 py-1"
                  @click.stop="deleteTarget = e.id"
                >حذف</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </main>

    <!-- Delete confirmation -->
    <AppDialog
      v-if="deleteTarget"
      title="حذف المصروف"
      message="هل أنت متأكد من حذف هذا المصروف؟"
      confirm-label="حذف"
      cancel-label="إلغاء"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />

    <!-- Edit expense via existing form (pre-filled) -->
    <ExpenseForm
      v-if="editingExpense"
      :initial-expense="editingExpense"
      @saved="handleExpenseSaved"
      @cancel="editingExpense = null"
    />

    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>
