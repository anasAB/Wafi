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
  <div class="form-root" dir="rtl">
    <!-- Name -->
    <div class="field">
      <label class="field-label">الاسم *</label>
      <input
        v-model="name"
        data-testid="name-input"
        type="text"
        placeholder="اسم الزبون أو المحل"
        class="field-input"
        :class="{ 'field-input--error': errors['name'] }"
        @input="delete errors['name']"
      />
      <p v-if="errors['name']" data-testid="error-name" class="field-error">{{ errors['name'] }}</p>
    </div>

    <!-- Landline -->
    <div class="field">
      <label class="field-label">هاتف ثابت</label>
      <input
        v-model="phone"
        data-testid="phone-input"
        type="tel"
        placeholder="011XXXXXXX"
        class="field-input"
      />
    </div>

    <!-- Mobile -->
    <div class="field">
      <label class="field-label">جوال</label>
      <input
        v-model="mobile"
        data-testid="mobile-input"
        type="tel"
        placeholder="09XXXXXXXX"
        class="field-input"
      />
    </div>

    <!-- Address -->
    <div class="field">
      <label class="field-label">العنوان</label>
      <input
        v-model="address"
        data-testid="address-input"
        type="text"
        placeholder="الحي أو المنطقة"
        class="field-input"
      />
    </div>

    <!-- Buttons -->
    <div class="actions">
      <button
        type="button"
        data-testid="save-btn"
        :disabled="saving"
        class="btn-primary"
        @click="handleSave"
      >{{ saving ? '...' : (initial ? 'حفظ التغييرات' : 'إضافة زبون') }}</button>

      <button
        type="button"
        data-testid="cancel-btn"
        class="btn-ghost"
        @click="emit('cancel')"
      >إلغاء</button>
    </div>
  </div>
</template>

<style scoped>
/* ── Root ────────────────────────────────────────────────── */
.form-root {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Field ───────────────────────────────────────────────── */
.field { display: flex; flex-direction: column; }

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  margin-bottom: 6px;
  display: block;
}

.field-input {
  width: 100%;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: inherit;
  height: 44px;
}

.field-input::placeholder { color: #3D4F6B; }

.field-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

.field-input--error {
  border-color: rgba(239,68,68,0.8) !important;
}

.field-error {
  font-size: 0.75rem;
  color: #EF4444;
  margin-top: 0.25rem;
}

/* ── Actions ─────────────────────────────────────────────── */
.actions {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.5rem;
}

/* ── Primary button ──────────────────────────────────────── */
.btn-primary {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
  transition: opacity 0.15s, box-shadow 0.15s, transform 0.1s;
  font-family: inherit;
}

.btn-primary:hover { opacity: 0.88; box-shadow: 0 6px 24px rgba(26,86,219,0.55); }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Ghost button ────────────────────────────────────────── */
.btn-ghost {
  height: 44px;
  padding-inline: 1.25rem;
  border-radius: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.18);
  color: #E8EDF5;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.12s;
  font-family: inherit;
}

.btn-ghost:hover { background: rgba(255,255,255,0.06); }
</style>
