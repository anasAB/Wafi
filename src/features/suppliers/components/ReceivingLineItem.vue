<script setup lang="ts">
import { computed } from 'vue'
import type { ReceivingLine } from '../receiving.types'

const props = defineProps<{ line: ReceivingLine }>()
const emit = defineEmits<{ remove: [] }>()

const costDiffers = computed(() => props.line.unitCostUsd !== props.line.currentCostUsd)
</script>

<template>
  <div class="line" dir="rtl">
    <div class="row">
      <span class="name">{{ line.productName }}</span>
      <button class="btn-ghost" @click="emit('remove')">حذف</button>
    </div>
    <div class="inputs">
      <label>الكمية
        <input v-model.number="line.qtyReceived" type="number" min="1" step="1" />
      </label>
      <label>سعر التكلفة ($)
        <input v-model.number="line.unitCostUsd" type="number" min="0" step="0.01" />
      </label>
    </div>
    <label v-if="costDiffers" class="cost-toggle">
      <input v-model="line.updateCost" type="checkbox" />
      تحديث سعر التكلفة؟ {{ line.currentCostUsd }}$ ← {{ line.unitCostUsd }}$
    </label>
  </div>
</template>

<style scoped>
.line { background: #0D1828; border-radius: 0.75rem; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.row { display: flex; justify-content: space-between; align-items: center; }
.name { font-weight: 600; }
.inputs { display: flex; gap: 0.5rem; }
.inputs label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; flex: 1; }
.inputs input { padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.cost-toggle { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #9CB3D0; }
.btn-ghost { background: transparent; color: #E06A6A; border: none; }
</style>
