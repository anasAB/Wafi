<script setup lang="ts">
import { ref, computed } from 'vue'

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

defineExpose({ shake })
</script>

<template>
  <div class="flex flex-col items-center gap-6">
    <div
      :class="['text-3xl tracking-widest font-mono text-white transition-all', error && 'text-red-400 animate-shake']"
      dir="ltr"
    >
      {{ display }}
    </div>

    <div class="grid grid-cols-3 gap-3 w-64">
      <button
        v-for="d in ['1','2','3','4','5','6','7','8','9']"
        :key="d"
        @click="pressDigit(d)"
        class="h-16 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-2xl font-semibold transition-all"
      >{{ d }}</button>
      <div />
      <button
        @click="pressDigit('0')"
        class="h-16 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-2xl font-semibold transition-all"
      >0</button>
      <button
        @click="pressBackspace"
        class="h-16 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xl transition-all"
      >⌫</button>
    </div>
  </div>
</template>

<style scoped>
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
.animate-shake { animation: shake 0.4s ease; }
</style>
