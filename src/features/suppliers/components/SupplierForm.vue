<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import FormField from '@/components/ui/FormField.vue'
import type { NewSupplier } from '../supplier.types'

const props = defineProps<{ initial?: Partial<NewSupplier> }>()
const emit = defineEmits<{ submit: [NewSupplier]; cancel: [] }>()

const { t } = useI18n()

const name          = ref(props.initial?.name ?? '')
const phone         = ref(props.initial?.phone ?? '')
const contactPerson = ref(props.initial?.contactPerson ?? '')
const address       = ref(props.initial?.address ?? '')
const notes         = ref(props.initial?.notes ?? '')

const errors  = ref<Record<string, string>>({})
const canSubmit = computed(() => name.value.trim().length > 0)

function validate(): boolean {
  const e: Record<string, string> = {}
  // Was silently ignored before — now gives explicit feedback (BUG-028).
  if (!name.value.trim()) e['name'] = t('validation.required')
  errors.value = e
  return Object.keys(e).length === 0
}

function onSubmit() {
  if (!validate()) return
  emit('submit', {
    name: name.value.trim(),
    phone: phone.value.trim() || undefined,
    contactPerson: contactPerson.value.trim() || undefined,
    address: address.value.trim() || undefined,
    notes: notes.value.trim() || undefined,
  })
}
</script>

<template>
  <form class="supplier-form" dir="rtl" @submit.prevent="onSubmit">
    <FormField label="الاسم" required :error="errors['name']">
      <input
        data-test="name"
        v-model="name"
        type="text"
        placeholder="اسم المورّد أو الشركة"
        class="form-input"
        :class="{ 'input-error': errors['name'] }"
        @input="delete errors['name']"
      />
    </FormField>

    <FormField label="الهاتف" optional>
      <input
        data-test="phone"
        v-model="phone"
        type="tel"
        inputmode="tel"
        placeholder="09XXXXXXXX"
        class="form-input"
      />
    </FormField>

    <FormField label="الشخص المسؤول" optional>
      <input
        data-test="contact"
        v-model="contactPerson"
        type="text"
        placeholder="اسم جهة الاتصال"
        class="form-input"
      />
    </FormField>

    <FormField label="العنوان" optional>
      <input
        data-test="address"
        v-model="address"
        type="text"
        placeholder="المدينة أو المنطقة"
        class="form-input"
      />
    </FormField>

    <FormField label="ملاحظات" optional>
      <textarea
        data-test="notes"
        v-model="notes"
        rows="2"
        placeholder="ملاحظات إضافية..."
        class="form-input form-textarea"
      ></textarea>
    </FormField>

    <!-- Standard action order: primary leads (rightmost in RTL), cancel trails (BUG-005) -->
    <div class="actions">
      <button data-test="submit" type="button" class="btn-primary" :disabled="!canSubmit" @click="onSubmit">حفظ</button>
      <button type="button" class="btn-ghost" @click="emit('cancel')">إلغاء</button>
    </div>
  </form>
</template>

<style scoped>
.supplier-form { display: flex; flex-direction: column; }

/* Shared input look; the global :focus-visible ring (style.css) handles focus. */
.form-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}
.form-input::placeholder { color: #3D4F6B; }
.form-textarea { resize: none; min-height: 64px; line-height: 1.6; }
.input-error { border-color: #EF4444 !important; }

.actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }

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
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.1s;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary:not(:disabled):hover { opacity: 0.88; }
.btn-primary:not(:disabled):active { transform: scale(0.98); }

.btn-ghost {
  height: 44px;
  padding-inline: 1.25rem;
  border-radius: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #E8EDF5;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-ghost:hover { background: rgba(255, 255, 255, 0.06); }
</style>
