<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCustomers } from '@/features/customers/composables/useCustomers'
import type { Customer } from '@/features/customers/customer.types'

const emit = defineEmits<{
  (e: 'select', customer: Customer): void
  (e: 'cancel'): void
}>()

const { customers, load, search, save } = useCustomers()
const query      = ref('')
const showAddNew = ref(false)
const newName    = ref('')
const saving     = ref(false)
const results    = ref<Customer[]>([])

onMounted(async () => {
  await load()
  results.value = customers.value
})

async function handleSearch(q: string) {
  query.value = q
  if (q.trim()) {
    results.value = await search(q.trim())
  } else {
    results.value = customers.value
  }
}

async function handleQuickAdd() {
  if (!newName.value.trim()) return
  saving.value = true
  try {
    const id = await save({ name: newName.value.trim() })
    await load()
    const created = customers.value.find(c => c.id === id)
    if (created) emit('select', created)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center"
      style="background: rgb(0 0 0 / 0.6)"
      data-testid="backdrop"
      @click.self="emit('cancel')"
    >
      <div
        class="bg-bg-void border-t border-border-glass rounded-t-2xl w-full max-w-lg p-5 shadow-xl max-h-[80dvh] flex flex-col"
        dir="rtl"
      >
        <div class="w-9 h-1 bg-text-muted/30 rounded-full mx-auto mb-4 flex-shrink-0"></div>
        <h2 class="text-base font-semibold text-text-primary mb-3 flex-shrink-0">اختر الزبون</h2>

        <!-- Search -->
        <input
          :value="query"
          data-testid="search-input"
          type="text"
          placeholder="ابحث باسم الزبون..."
          class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
                 focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm mb-3 flex-shrink-0"
          @input="handleSearch(($event.target as HTMLInputElement).value)"
        />

        <!-- Results -->
        <div class="flex-1 overflow-y-auto flex flex-col gap-1 mb-3">
          <button
            v-for="c in results"
            :key="c.id"
            type="button"
            :data-testid="`customer-${c.id}`"
            class="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-surface-raised transition-colors text-right"
            @click="emit('select', c)"
          >
            <span class="text-sm font-medium text-text-primary">{{ c.name }}</span>
            <span v-if="c.phone" class="text-xs text-text-muted">{{ c.phone }}</span>
          </button>

          <div v-if="results.length === 0" class="text-center py-6 text-text-muted text-sm">
            لا توجد نتائج
          </div>
        </div>

        <!-- Add new -->
        <div class="flex-shrink-0 border-t border-border-glass pt-3">
          <div v-if="!showAddNew">
            <button
              type="button"
              data-testid="add-new-btn"
              class="w-full text-sm text-gold-primary font-medium py-2"
              @click="showAddNew = true"
            >+ إضافة زبون جديد</button>
          </div>

          <div v-else data-testid="quick-add-form" class="flex gap-2">
            <input
              v-model="newName"
              data-testid="quick-add-name"
              type="text"
              placeholder="اسم الزبون"
              class="flex-1 border border-border-glass rounded-xl px-3 py-2 bg-surface-raised text-text-primary
                     focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
              @keydown.enter="handleQuickAdd"
            />
            <button
              type="button"
              data-testid="quick-add-save"
              :disabled="saving || !newName.trim()"
              class="h-10 px-4 rounded-xl text-sm font-semibold text-bg-void disabled:opacity-40"
              style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
              @click="handleQuickAdd"
            >{{ saving ? '...' : 'إضافة' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
