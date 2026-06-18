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
  margin: 8px 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  background: rgba(255,255,255,0.03);
  opacity: 0.72;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}
.rli-row--selected {
  opacity: 1;
  background: rgba(26, 86, 219, 0.10);
  border-color: rgba(26, 86, 219, 0.32);
}
.rli-check {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 5px;
  border: 1px solid rgba(96,165,250,0.45);
  background: rgba(255,255,255,0.04);
  display: grid;
  place-items: center;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.rli-check::after {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(135deg, #60A5FA, #1A56DB);
  transform: scale(0);
  transition: transform 0.12s ease;
}

.rli-check:checked {
  border-color: rgba(96,165,250,0.9);
  background: rgba(26,86,219,0.20);
}

.rli-check:checked::after {
  transform: scale(1);
}

.rli-check:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(26,86,219,0.24);
}

.rli-check:disabled {
  opacity: 0.45;
  cursor: default;
}
.rli-info { flex: 1; }
.rli-name { font-size: 14px; font-weight: 600; color: #E8EDF5; }
.rli-sub  { font-size: 12px; color: #637285; margin-top: 2px; }
.rli-returned { color: #F59E0B; }
.rli-qty { display: flex; align-items: center; gap: 6px; }
.rli-qty-btn {
  width: 28px; height: 28px; border-radius: 6px;
  background: rgba(26,86,219,0.22);
  border: 1px solid rgba(26,86,219,0.34);
  color: #E8EDF5;
  font-size: 16px;
  cursor: pointer;
}
.rli-qty-btn:disabled { opacity: 0.35; cursor: default; }
.rli-qty-val { color: #E8EDF5; font-size: 15px; font-weight: 700; min-width: 20px; text-align: center; }
.rli-restock { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.rli-restock-label { font-size: 10px; color: #637285; }
.rli-toggle {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: 1px solid rgba(96,165,250,0.28);
  cursor: pointer;
  display: flex; align-items: center; padding: 2px;
  background: rgba(51,65,85,0.85);
  transition: background 0.2s, border-color 0.2s;
}

.rli-toggle--on {
  background: linear-gradient(135deg, rgba(96,165,250,0.85), rgba(26,86,219,0.90));
  border-color: rgba(96,165,250,0.75);
}
.rli-toggle-dot {
  width: 18px; height: 18px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,0.3);
  /* margin-inline-start: auto is direction-aware, so the knob slides to the
     correct side in RTL (translateX was hard-coded LTR and pushed it off-edge). */
  transition: margin 0.2s;
}
.rli-toggle--on .rli-toggle-dot { margin-inline-start: auto; }

@media (max-width: 420px) {
  .rli-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
  }

  .rli-qty,
  .rli-restock {
    grid-column: 2;
    justify-self: end;
  }
}
</style>
