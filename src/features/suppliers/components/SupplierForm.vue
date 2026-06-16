<script setup lang="ts">
import { ref, computed } from 'vue'
import type { NewSupplier } from '../supplier.types'

const props = defineProps<{ initial?: Partial<NewSupplier> }>()
const emit = defineEmits<{ submit: [NewSupplier]; cancel: [] }>()

const name          = ref(props.initial?.name ?? '')
const phone         = ref(props.initial?.phone ?? '')
const contactPerson = ref(props.initial?.contactPerson ?? '')
const address       = ref(props.initial?.address ?? '')
const notes         = ref(props.initial?.notes ?? '')

const canSubmit = computed(() => name.value.trim().length > 0)

function onSubmit() {
  if (!canSubmit.value) return
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
    <label>الاسم
      <input data-test="name" v-model="name" type="text" required />
    </label>
    <label>الهاتف
      <input data-test="phone" v-model="phone" type="tel" inputmode="tel" />
    </label>
    <label>الشخص المسؤول
      <input data-test="contact" v-model="contactPerson" type="text" />
    </label>
    <label>العنوان
      <input data-test="address" v-model="address" type="text" />
    </label>
    <label>ملاحظات
      <textarea data-test="notes" v-model="notes" rows="2"></textarea>
    </label>
    <div class="actions">
      <button type="button" class="btn-ghost" @click="emit('cancel')">إلغاء</button>
      <button data-test="submit" type="submit" class="btn-primary" :disabled="!canSubmit" @click.prevent="onSubmit">حفظ</button>
    </div>
  </form>
</template>

<style scoped>
.supplier-form { display: flex; flex-direction: column; gap: 0.75rem; }
.supplier-form label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
.supplier-form input, .supplier-form textarea {
  padding: 0.6rem; border-radius: 0.5rem; border: 1px solid #2A3A52;
  background: #0D1828; color: #fff; font-size: 1rem;
}
.actions { display: flex; gap: 0.5rem; justify-content: flex-start; margin-top: 0.5rem; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; }
.btn-primary:disabled { opacity: 0.5; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; padding: 0.6rem 1.2rem; }
</style>
