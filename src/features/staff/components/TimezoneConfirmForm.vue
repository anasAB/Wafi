<script setup lang="ts">
import { ref } from 'vue'
import { COMMON_TIMEZONE_OPTIONS, type ConfirmTimezoneResult } from '@/features/staff/composables/useShopTimezone'

const props = defineProps<{
  initialTimezone: string
  confirming: boolean
  skippable: boolean
}>()

const emit = defineEmits<{
  confirm: [timezone: string]
  skip: []
}>()

const selected = ref(props.initialTimezone)

function submit() {
  emit('confirm', selected.value)
}
</script>

<template>
  <div class="timezone-confirm" dir="rtl">
    <p class="timezone-confirm__hint">
      حدد المنطقة الزمنية لمتجرك — هذا يضمن أن تقارير الصحة اليومية تُحسب على اليوم الصحيح.
    </p>
    <select v-model="selected" class="timezone-confirm__select" :disabled="confirming">
      <option v-for="opt in COMMON_TIMEZONE_OPTIONS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <div class="timezone-confirm__actions">
      <button type="button" class="timezone-confirm__confirm-btn" :disabled="confirming" @click="submit">
        {{ confirming ? 'جارٍ الحفظ...' : 'تأكيد' }}
      </button>
      <button v-if="skippable" type="button" class="timezone-confirm__skip-btn" :disabled="confirming" @click="emit('skip')">
        لاحقًا
      </button>
    </div>
  </div>
</template>

<style scoped>
.timezone-confirm {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
}
.timezone-confirm__hint {
  margin: 0;
  font-size: 13px;
  color: #A8B3C7;
  text-align: center;
}
.timezone-confirm__select {
  height: 42px;
  border-radius: 10px;
  padding: 0 0.75rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  background: rgba(255, 255, 255, 0.04);
  color: #E8EDF5;
  border: 1px solid rgba(26, 86, 219, 0.30);
}
.timezone-confirm__actions {
  display: flex;
  gap: 0.5rem;
}
.timezone-confirm__confirm-btn {
  flex: 1;
  height: 42px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: none;
  color: white;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
}
.timezone-confirm__confirm-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.timezone-confirm__skip-btn {
  height: 42px;
  padding: 0 1rem;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #60A5FA;
  background: rgba(26, 86, 219, 0.12);
  border: 1px solid rgba(26, 86, 219, 0.30);
}
</style>
