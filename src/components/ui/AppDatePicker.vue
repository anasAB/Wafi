<script setup lang="ts">
import DatePicker from 'primevue/datepicker'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue: Date | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Date | null): void
}>()
</script>

<template>
  <DatePicker
    v-bind="$attrs"
    :model-value="props.modelValue"
    class="app-date-picker"
    @update:model-value="emit('update:modelValue', $event as Date | null)"
  />
</template>

<style scoped>
.app-date-picker {
  width: 100%;
}

.app-date-picker :deep(.p-inputtext),
.app-date-picker :deep(.p-datepicker-input) {
  width: 100% !important;
  min-height: 40px !important;
  border-radius: 0.75rem !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  background: rgba(255, 255, 255, 0.07) !important;
  color: #e8edf5 !important;
  font-family: 'Tajawal', system-ui, sans-serif !important;
  box-sizing: border-box;
}

.app-date-picker :deep(.p-inputtext:enabled:hover),
.app-date-picker :deep(.p-datepicker-input:enabled:hover) {
  border-color: rgba(26, 86, 219, 0.45) !important;
}

.app-date-picker :deep(.p-inputtext:enabled:focus),
.app-date-picker :deep(.p-datepicker-input:enabled:focus) {
  border-color: rgba(26, 86, 219, 0.8) !important;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15) !important;
}

.app-date-picker :deep(.p-datepicker-input::placeholder),
.app-date-picker :deep(.p-inputtext::placeholder) {
  color: #3d4f6b;
  opacity: 1;
}

.app-date-picker :deep(.p-datepicker-input-icon-container) {
  color: #637285;
}

.app-date-picker :deep(.p-datepicker-panel) {
  margin-top: 6px;
  border-radius: 12px;
  border: 1px solid rgba(26, 86, 219, 0.3);
  background: linear-gradient(180deg, rgba(13, 24, 40, 0.97), rgba(7, 11, 20, 0.97));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 4px 18px rgba(26, 86, 219, 0.16);
  backdrop-filter: blur(20px) saturate(180%);
  color: #e8edf5;
}

.app-date-picker :deep(.p-datepicker-calendar-container),
.app-date-picker :deep(.p-datepicker-calendar),
.app-date-picker :deep(.p-datepicker-month-view),
.app-date-picker :deep(.p-datepicker-year-view) {
  background: transparent !important;
}

.app-date-picker :deep(.p-datepicker-header) {
  background: transparent;
  border-bottom: 1px solid rgba(26, 86, 219, 0.2);
  color: #e8edf5;
}

.app-date-picker :deep(.p-datepicker-title button),
.app-date-picker :deep(.p-datepicker-prev),
.app-date-picker :deep(.p-datepicker-next) {
  color: #c8d5e8;
}

.app-date-picker :deep(.p-datepicker-select-month),
.app-date-picker :deep(.p-datepicker-select-year) {
  background: transparent !important;
  border: none !important;
  border-radius: 0;
  color: #e8edf5 !important;
}

.app-date-picker :deep(.p-datepicker-select-month:hover),
.app-date-picker :deep(.p-datepicker-select-year:hover) {
  background: transparent !important;
  border: none !important;
}

.app-date-picker :deep(.p-datepicker-title button:hover),
.app-date-picker :deep(.p-datepicker-prev:hover),
.app-date-picker :deep(.p-datepicker-next:hover) {
  background: rgba(26, 86, 219, 0.16) !important;
}

.app-date-picker :deep(.p-datepicker-title .p-datepicker-select-month:hover),
.app-date-picker :deep(.p-datepicker-title .p-datepicker-select-year:hover) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.app-date-picker :deep(.p-datepicker-day),
.app-date-picker :deep(.p-datepicker-month),
.app-date-picker :deep(.p-datepicker-year) {
  color: #c8d5e8;
}

.app-date-picker :deep(.p-datepicker-day:hover),
.app-date-picker :deep(.p-datepicker-month:hover),
.app-date-picker :deep(.p-datepicker-year:hover) {
  background: rgba(26, 86, 219, 0.16) !important;
}

.app-date-picker :deep(.p-datepicker-day.p-datepicker-day-selected),
.app-date-picker :deep(.p-datepicker-day.p-datepicker-day-selected) {
  background: linear-gradient(135deg, #1a56db, #1248b3) !important;
  color: #ffffff !important;
  border: 1px solid rgba(26, 86, 219, 0.55) !important;
}

.app-date-picker :deep(.p-datepicker-month.p-datepicker-month-selected),
.app-date-picker :deep(.p-datepicker-year.p-datepicker-year-selected),
.app-date-picker :deep(.p-monthpicker-month.p-highlight),
.app-date-picker :deep(.p-yearpicker-year.p-highlight) {
  background: linear-gradient(135deg, #1a56db, #1248b3) !important;
  border: 1px solid rgba(26, 86, 219, 0.55) !important;
  color: #ffffff !important;
}

.app-date-picker :deep(.p-datepicker-day[data-p='today']),
.app-date-picker :deep(.p-datepicker-today > .p-datepicker-day) {
  background: rgba(26, 86, 219, 0.16) !important;
  color: #bfdbfe !important;
  border: 1px solid rgba(26, 86, 219, 0.45) !important;
  border-radius: 8px;
}

.app-date-picker :deep(.p-datepicker-day[data-p='today'][aria-selected='true']),
.app-date-picker :deep(.p-datepicker-day.p-datepicker-day-selected[data-p='today']),
.app-date-picker :deep(.p-datepicker-today > .p-datepicker-day[aria-selected='true']) {
  background: linear-gradient(135deg, #1a56db, #1248b3) !important;
  color: #ffffff !important;
  border: 1px solid rgba(26, 86, 219, 0.55) !important;
}
</style>
