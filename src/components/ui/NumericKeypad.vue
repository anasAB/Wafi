<script setup lang="ts">
const props = defineProps<{ confirmDisabled?: boolean; hideConfirm?: boolean }>()
const emit  = defineEmits<{
  (e: 'digit',   d: string): void
  (e: 'delete'):              void
  (e: 'confirm'):             void
}>()

const keys = ['7','8','9','4','5','6','1','2','3','.',  '0', '⌫']
</script>

<template>
  <div class="grid grid-cols-3 gap-2 p-4">
    <button
      v-for="key in keys"
      :key="key"
      type="button"
      :aria-label="key === '⌫' ? 'حذف' : key"
      :class="[
        'keypad-key',
        key === '⌫' ? 'keypad-key-delete' : '',
      ]"
      @click="key === '⌫' ? emit('delete') : emit('digit', key)"
    >{{ key }}</button>
    <button
      v-if="!props.hideConfirm"
      type="button"
      aria-label="تأكيد"
      :disabled="props.confirmDisabled"
      :class="[
        'keypad-confirm',
      ]"
      @click="emit('confirm')"
    >تأكيد</button>
  </div>
</template>

<style scoped>
.keypad-key {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 3.5rem;
  border-radius: 0.75rem;
  font-size: 1.25rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #e8edf5;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.20), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.34);
  box-shadow: 0 2px 10px rgba(26, 86, 219, 0.14);
  transition: transform 0.1s, background 0.15s, border-color 0.15s;
}

.keypad-key:hover {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.28), rgba(255, 255, 255, 0.07));
  border-color: rgba(96, 165, 250, 0.55);
}

.keypad-key:active {
  transform: scale(0.95);
}

.keypad-key-delete {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.44);
  background: linear-gradient(135deg, rgba(127, 29, 29, 0.36), rgba(255, 255, 255, 0.03));
  box-shadow: 0 2px 10px rgba(127, 29, 29, 0.20);
}

.keypad-key-delete:hover {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.56);
  background: linear-gradient(135deg, rgba(153, 27, 27, 0.46), rgba(255, 255, 255, 0.05));
}

.keypad-confirm {
  grid-column: span 3 / span 3;
  height: 3rem;
  border-radius: 0.75rem;
  border: none;
  color: #ffffff;
  font-size: 1rem;
  font-weight: 800;
  font-family: 'Tajawal', system-ui, sans-serif;
  background: linear-gradient(135deg, #1a56db, #1248b3);
  box-shadow: 0 6px 20px rgba(26, 86, 219, 0.40);
  transition: transform 0.1s, opacity 0.15s;
}

.keypad-confirm:active {
  transform: scale(0.95);
}

.keypad-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
