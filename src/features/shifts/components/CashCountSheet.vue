<script setup lang="ts">
import { ref } from 'vue'

const emit      = defineEmits<{ confirm: [usd: number, syp: number] }>()
const usdAmount = ref('')
const sypAmount = ref('')

function confirm() {
  emit('confirm', parseFloat(usdAmount.value) || 0, parseFloat(sypAmount.value) || 0)
}
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-end justify-center z-40" dir="rtl">
    <div class="bg-[#0D1828] rounded-t-3xl p-6 w-full max-w-lg">
      <h2 class="text-white text-xl font-bold mb-2 text-center">عدّ الصندوق</h2>
      <p class="text-[#637285] text-sm text-center mb-6">كم موجود في الصندوق الآن؟</p>

      <div class="flex flex-col gap-4 mb-6">
        <div class="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-3">
          <span class="text-[#637285] text-sm">دولار $</span>
          <input v-model="usdAmount" type="number" min="0" step="0.01"
            class="bg-transparent text-white text-xl w-full outline-none text-left"
            placeholder="0.00" dir="ltr" />
        </div>
        <div class="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-3">
          <span class="text-[#637285] text-sm">ليرة ل.س</span>
          <input v-model="sypAmount" type="number" min="0" step="1"
            class="bg-transparent text-white text-xl w-full outline-none text-left"
            placeholder="0" dir="ltr" />
        </div>
      </div>

      <button @click="confirm"
        class="w-full py-4 rounded-2xl bg-[#1A56DB] hover:bg-blue-600 text-white font-semibold text-lg transition-all">
        التالي — عرض التقرير
      </button>
    </div>
  </div>
</template>
