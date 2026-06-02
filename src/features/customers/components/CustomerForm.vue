<script setup lang="ts">
import { ref } from 'vue'
import { useCustomers } from '@/features/customers/composables/useCustomers'
import type { Customer, NewCustomer } from '@/features/customers/customer.types'

const props = defineProps<{ initial?: Customer }>()
const emit  = defineEmits<{ (e: 'saved', id: string): void; (e: 'cancel'): void }>()

const { save, update } = useCustomers()

const name    = ref(props.initial?.name    ?? '')
const phone   = ref(props.initial?.phone   ?? '')
const mobile  = ref(props.initial?.mobile  ?? '')
const address = ref(props.initial?.address ?? '')
const saving  = ref(false)
const errors  = ref<Record<string, string>>({})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!name.value.trim()) e['name'] = 'الاسم مطلوب'
  errors.value = e
  return Object.keys(e).length === 0
}

async function handleSave() {
  if (!validate()) return
  saving.value = true
  try {
    const data: NewCustomer = {
      name:    name.value.trim(),
      phone:   phone.value.trim()   || undefined,
      mobile:  mobile.value.trim()  || undefined,
      address: address.value.trim() || undefined,
    }
    if (props.initial) {
      await update(props.initial.id, data)
      emit('saved', props.initial.id)
    } else {
      const id = await save(data)
      emit('saved', id)
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" dir="rtl">
    <!-- Name -->
    <div>
      <label class="block text-sm text-text-muted mb-1">الاسم *</label>
      <input
        v-model="name"
        data-testid="name-input"
        type="text"
        placeholder="اسم الزبون أو المحل"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
        :class="errors['name'] ? 'border-red-500' : ''"
        @input="delete errors['name']"
      />
      <p v-if="errors['name']" data-testid="error-name" class="text-xs text-red-500 mt-1">{{ errors['name'] }}</p>
    </div>

    <!-- Phone -->
    <div>
      <label class="block text-sm text-text-muted mb-1">الهاتف</label>
      <input
        v-model="phone"
        data-testid="phone-input"
        type="tel"
        placeholder="09XXXXXXXX"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
      />
    </div>

    <!-- Mobile -->
    <div>
      <label class="block text-sm text-text-muted mb-1">الجوال</label>
      <input
        v-model="mobile"
        data-testid="mobile-input"
        type="tel"
        placeholder="09XXXXXXXX"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
      />
    </div>

    <!-- Address -->
    <div>
      <label class="block text-sm text-text-muted mb-1">العنوان</label>
      <input
        v-model="address"
        data-testid="address-input"
        type="text"
        placeholder="الحي أو المنطقة"
        class="w-full border border-border-glass rounded-xl px-4 py-3 bg-surface-raised text-text-primary
               focus:outline-none focus:ring-2 focus:ring-gold-primary/40 text-sm"
      />
    </div>

    <!-- Buttons -->
    <div class="flex gap-2 pt-2">
      <button
        type="button"
        data-testid="save-btn"
        :disabled="saving"
        class="flex-1 h-11 rounded-xl text-sm font-semibold text-bg-void disabled:opacity-50 transition-colors"
        style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
        @click="handleSave"
      >{{ saving ? '...' : (initial ? 'حفظ التغييرات' : 'إضافة زبون') }}</button>

      <button
        type="button"
        data-testid="cancel-btn"
        class="h-11 px-5 rounded-xl text-sm text-text-muted border border-border-glass"
        @click="emit('cancel')"
      >إلغاء</button>
    </div>
  </div>
</template>
