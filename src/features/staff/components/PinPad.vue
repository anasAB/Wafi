<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const emit   = defineEmits<{ complete: [pin: string] }>()
const digits = ref<string[]>([])
const error  = ref(false)

const display = computed(() =>
  Array.from({ length: 4 }, (_, i) => digits.value[i] ? '●' : '○').join(' ')
)

function pressDigit(d: string) {
  if (digits.value.length >= 4) return
  digits.value.push(d)
  if (digits.value.length === 4) {
    emit('complete', digits.value.join(''))
    digits.value = []
  }
}

function pressBackspace() {
  digits.value.pop()
  error.value = false
}

function shake() {
  error.value  = true
  digits.value = []
  setTimeout(() => { error.value = false }, 500)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault()
    pressDigit(e.key)
  } else if (e.key === 'Backspace') {
    e.preventDefault()
    pressBackspace()
  }
}

onMounted(()   => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

defineExpose({ shake })
</script>

<template>
  <div class="pinpad">
    <div
      :class="['pinpad-display', error && 'pinpad-error']"
      dir="ltr"
    >
      {{ display }}
    </div>

    <div class="pinpad-grid">
      <button
        v-for="d in ['1','2','3','4','5','6','7','8','9']"
        :key="d"
        @click="pressDigit(d)"
        class="pin-btn"
      >{{ d }}</button>
      <div />
      <button @click="pressDigit('0')" class="pin-btn">0</button>
      <button @click="pressBackspace"  class="pin-btn pin-back">⌫</button>
    </div>

    <p class="pinpad-hint">يمكنك الكتابة من لوحة المفاتيح</p>
  </div>
</template>

<style scoped>
.pinpad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.pinpad-display {
  font-size: 28px;
  letter-spacing: 0.3em;
  font-family: monospace;
  color: #E8EDF5;
  transition: color 0.15s;
  dir: ltr;
}

.pinpad-error {
  color: #EF4444;
  animation: shake 0.4s ease;
}

.pinpad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 216px;
}

.pin-btn {
  height: 52px;
  border-radius: 12px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.10);
  color: #E8EDF5;
  font-size: 20px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s, transform 0.1s, box-shadow 0.1s;
}

.pin-btn:hover {
  background: rgba(26,86,219,0.15);
  border-color: rgba(26,86,219,0.30);
}

.pin-btn:active {
  transform: scale(0.94);
  background: rgba(26,86,219,0.22);
}

.pin-back {
  font-size: 18px;
  color: #637285;
}

.pinpad-hint {
  font-size: 11px;
  color: #3D4F6B;
  text-align: center;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
</style>
