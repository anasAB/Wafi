<script setup lang="ts">
import type { ReturnLine } from '../returns.types'

const props = defineProps<{ line: ReturnLine }>()
const emit  = defineEmits<{
  (e: 'update:line', val: ReturnLine): void
}>()

const maxQty = props.line.originalQty - props.line.alreadyReturnedQty

function toggle() {
  emit('update:line', { ...props.line, selected: !props.line.selected })
}

function setQty(delta: number) {
  const next = Math.min(Math.max(1, props.line.qtyToReturn + delta), maxQty)
  emit('update:line', { ...props.line, qtyToReturn: next })
}

function toggleRestock() {
  emit('update:line', { ...props.line, restock: !props.line.restock })
}
</script>

<template>
  <div class="rli-row" :class="{ 'rli-row--selected': line.selected }">
    <input
      type="checkbox"
      class="rli-check"
      :checked="line.selected"
      :disabled="maxQty === 0"
      @change="toggle"
    />
    <div class="rli-info">
      <div class="rli-name">{{ line.productName }}</div>
      <div class="rli-sub">
        تم بيع {{ line.originalQty }} × ${{ line.unitPriceUsd.toFixed(2) }}
        <span v-if="line.alreadyReturnedQty > 0" class="rli-returned">
          (تم إرجاع {{ line.alreadyReturnedQty }})
        </span>
      </div>
    </div>

    <template v-if="line.selected">
      <div class="rli-qty">
        <button type="button" class="rli-qty-btn" :disabled="line.qtyToReturn <= 1" @click="setQty(-1)">−</button>
        <span class="rli-qty-val">{{ line.qtyToReturn }}</span>
        <button type="button" class="rli-qty-btn" :disabled="line.qtyToReturn >= maxQty" @click="setQty(1)">+</button>
      </div>
      <div class="rli-restock">
        <span class="rli-restock-label">مخزون</span>
        <button
          type="button"
          class="rli-toggle"
          :class="{ 'rli-toggle--on': line.restock }"
          @click="toggleRestock"
        >
          <span class="rli-toggle-dot" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rli-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  opacity: 0.55;
  transition: opacity 0.15s, background 0.15s;
}
.rli-row--selected { opacity: 1; background: rgba(26, 86, 219, 0.07); }
.rli-check { width: 18px; height: 18px; accent-color: #1A56DB; flex-shrink: 0; cursor: pointer; }
.rli-info { flex: 1; }
.rli-name { font-size: 14px; font-weight: 600; color: #E8EDF5; }
.rli-sub  { font-size: 12px; color: #637285; margin-top: 2px; }
.rli-returned { color: #F59E0B; }
.rli-qty { display: flex; align-items: center; gap: 6px; }
.rli-qty-btn {
  width: 28px; height: 28px; border-radius: 6px;
  background: #1e3a5f; color: #E8EDF5; border: none; font-size: 16px; cursor: pointer;
}
.rli-qty-btn:disabled { opacity: 0.35; cursor: default; }
.rli-qty-val { color: #E8EDF5; font-size: 15px; font-weight: 700; min-width: 20px; text-align: center; }
.rli-restock { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.rli-restock-label { font-size: 10px; color: #637285; }
.rli-toggle {
  width: 36px; height: 20px; border-radius: 10px; border: none; cursor: pointer;
  display: flex; align-items: center; padding: 2px;
  background: #334155; transition: background 0.2s;
}
.rli-toggle--on { background: #1A56DB; }
.rli-toggle-dot {
  width: 16px; height: 16px; border-radius: 8px; background: white;
  transition: transform 0.2s; transform: translateX(0);
}
.rli-toggle--on .rli-toggle-dot { transform: translateX(16px); }
</style>
