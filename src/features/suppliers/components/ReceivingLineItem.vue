<script setup lang="ts">
import { computed } from 'vue'
import type { ReceivingLine } from '../receiving.types'

const props = defineProps<{ line: ReceivingLine }>()
const emit = defineEmits<{
  remove: []
  update: [patch: Partial<Pick<ReceivingLine, 'qtyReceived' | 'unitCostUsd' | 'updateCost'>>]
}>()

const num = (e: Event) => Number((e.target as HTMLInputElement).value)
const checked = (e: Event) => (e.target as HTMLInputElement).checked

const costDiffers = computed(() => props.line.unitCostUsd !== props.line.currentCostUsd)
</script>

<template>
  <div class="line" dir="rtl">
    <div class="row">
      <span class="name">{{ line.productName }}</span>
      <button class="delete-btn" aria-label="حذف الصنف" @click="emit('remove')">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
      </button>
    </div>
    <div class="inputs">
      <label>الكمية
        <input :value="line.qtyReceived" type="number" min="1" step="1"
               @input="emit('update', { qtyReceived: num($event) })" />
      </label>
      <label>سعر التكلفة ($)
        <input :value="line.unitCostUsd" type="number" min="0" step="0.01"
               @input="emit('update', { unitCostUsd: num($event) })" />
      </label>
    </div>
    <label v-if="costDiffers" class="cost-toggle">
      <input :checked="line.updateCost" type="checkbox"
             @change="emit('update', { updateCost: checked($event) })" />
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
.delete-btn {
  width: 28px; height: 28px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px; background: transparent; border: 1px solid transparent;
  color: #637285; cursor: pointer;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}
.delete-btn:hover { color: #EF4444; background: rgba(239,68,68,0.10); border-color: rgba(239,68,68,0.22); }
</style>
