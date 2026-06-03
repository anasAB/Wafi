<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import CustomerForm from './components/CustomerForm.vue'
import { useCustomers } from './composables/useCustomers'

const router = useRouter()
const { customers, load } = useCustomers()
const showAddForm = ref(false)
const toast = ref<{ message: string; type: 'success' | 'error' } | null>(null)

onMounted(load)

async function handleSaved() {
  showAddForm.value = false
  toast.value = { message: 'تم إضافة الزبون', type: 'success' }
  await load()
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader title="الزبائن" />

    <main class="flex-1 px-4 py-4 max-w-2xl mx-auto w-full pb-20">
      <p class="text-xs text-text-muted mb-4 px-1">{{ customers.length }} زبون</p>

      <div class="flex flex-col gap-2">
        <button
          v-for="c in customers"
          :key="c.id"
          type="button"
          :data-testid="`customer-row-${c.id}`"
          class="w-full glass-sm p-4 flex items-center justify-between rounded-2xl text-right hover:bg-surface-raised transition-colors active:scale-[0.99]"
          @click="router.push(`/customers/${c.id}`)"
        >
          <div>
            <p class="text-sm font-semibold text-text-primary">{{ c.name }}</p>
            <p v-if="c.phone" class="text-xs text-text-muted mt-0.5">{{ c.phone }}</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted rtl:rotate-180 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div v-if="customers.length === 0" class="text-center py-16 text-text-muted text-sm">
          لا يوجد زبائن بعد — أضف أول زبون
        </div>
      </div>
    </main>

    <!-- Mobile FAB -->
    <button
      type="button"
      data-testid="add-customer-fab"
      class="lg:hidden fixed bottom-20 start-6 w-14 h-14 rounded-full text-bg-void text-2xl shadow-lg
             active:scale-95 transition-all flex items-center justify-center z-20"
      style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to)); box-shadow: 0 0 24px var(--color-gold-subtle)"
      aria-label="إضافة زبون"
      @click="showAddForm = true"
    >+</button>

    <!-- Desktop add button -->
    <div class="hidden lg:block fixed bottom-8 start-8">
      <button
        type="button"
        class="btn-gold px-6 h-11 text-sm"
        @click="showAddForm = true"
      >+ إضافة زبون</button>
    </div>
  </div>

  <!-- Add customer sheet -->
  <Teleport v-if="showAddForm" to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      @click.self="showAddForm = false"
    >
      <div class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-6 shadow-xl" dir="rtl">
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-5"></div>
        <h2 class="text-base font-semibold text-text-primary mb-4">إضافة زبون جديد</h2>
        <CustomerForm @saved="handleSaved" @cancel="showAddForm = false" />
      </div>
    </div>
  </Teleport>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>
