<script setup lang="ts">
import { onMounted } from 'vue'
import { useExchangeRate } from './useExchangeRate'

const emit = defineEmits<{ (e: 'open-editor'): void }>()
const { currentRate, loadRate } = useExchangeRate()

onMounted(loadRate)
</script>

<template>
  <button
    type="button"
    :class="['rate-btn', currentRate ? '' : 'rate-btn-warn']"
    :aria-label="currentRate
      ? `سعر الصرف: ${currentRate.toLocaleString()} ل.س`
      : 'سعر الصرف غير محدد — انقر للإضافة'"
    @click="emit('open-editor')"
  >
    <!-- Rate icon -->
    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
    </svg>

    <span v-if="currentRate" class="rate-value">{{ currentRate.toLocaleString() }} ل.س</span>
    <span v-else class="rate-warn-text">حدد السعر</span>

    <!-- Edit pencil -->
    <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" class="edit-icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
    </svg>
  </button>
</template>

<style scoped>
.rate-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  background: rgba(26, 86, 219, 0.13);
  border: 1px solid rgba(26, 86, 219, 0.30);
  color: #60A5FA;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.rate-btn:hover {
  background: rgba(26, 86, 219, 0.22);
  border-color: rgba(26, 86, 219, 0.52);
  box-shadow: 0 2px 12px rgba(26, 86, 219, 0.20);
}

.rate-btn-warn {
  background: rgba(245, 158, 11, 0.10);
  border-color: rgba(245, 158, 11, 0.35);
  color: #FCD34D;
  animation: warn-pulse 2s ease-in-out infinite;
}

.rate-btn-warn:hover {
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(245, 158, 11, 0.55);
  box-shadow: 0 2px 12px rgba(245, 158, 11, 0.16);
}

@keyframes warn-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.60; }
}

.rate-value {
  font-variant-numeric: tabular-nums;
}

.rate-warn-text {
  font-size: 12px;
}

.edit-icon {
  opacity: 0.55;
  flex-shrink: 0;
}
</style>
