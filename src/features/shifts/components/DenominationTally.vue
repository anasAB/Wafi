<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  label:         string
  denominations: number[]
  /** SYP counts are whole notes; USD steps by 0.01 in manual mode. */
  isSyp:         boolean
}>()

// Two independent inputs live side by side: tally mode's per-denomination
// counts, and manual mode's single total. Switching modes clears the other
// (WAFI-103 edge case) so the stored breakdown never contradicts the total.
const mode   = ref<'tally' | 'manual'>('tally')
const counts = ref<Record<string, number>>(
  Object.fromEntries(props.denominations.map(d => [String(d), 0]))
)
const manualTotal = ref('')

const tallyTotal = computed(() =>
  props.denominations.reduce((sum, d) => sum + d * (counts.value[String(d)] || 0), 0)
)

const total = computed(() => mode.value === 'tally' ? tallyTotal.value : (parseFloat(manualTotal.value) || 0))

// Emitted breakdown is null in manual mode (no evidence contradicting the
// manually-entered total); an object (possibly all-zero) in tally mode.
const breakdown = computed<Record<string, number> | null>(() =>
  mode.value === 'tally' ? { ...counts.value } : null
)

const emit = defineEmits<{ (e: 'change', payload: { total: number; breakdown: Record<string, number> | null }): void }>()

watch([total, breakdown], () => emit('change', { total: total.value, breakdown: breakdown.value }), { immediate: true })

function setMode(next: 'tally' | 'manual') {
  if (mode.value === next) return
  mode.value = next
  if (next === 'tally') {
    manualTotal.value = ''
  } else {
    counts.value = Object.fromEntries(props.denominations.map(d => [String(d), 0]))
  }
}

function increment(d: number) {
  const key = String(d)
  counts.value[key] = (counts.value[key] || 0) + 1
}

function decrement(d: number) {
  const key = String(d)
  counts.value[key] = Math.max(0, (counts.value[key] || 0) - 1)
}
</script>

<template>
  <div class="tally-card" dir="rtl">
    <div class="tally-header">
      <span class="tally-label">{{ label }}</span>
      <div class="mode-toggle">
        <button type="button" class="mode-btn" :class="{ active: mode === 'tally' }" @click="setMode('tally')">عدّ الفئات</button>
        <button type="button" class="mode-btn" :class="{ active: mode === 'manual' }" @click="setMode('manual')">إدخال المبلغ</button>
      </div>
    </div>

    <div v-if="mode === 'tally'" class="denom-list">
      <div v-for="d in denominations" :key="d" class="denom-row" :data-testid="`denom-row-${isSyp ? 'syp' : 'usd'}-${d}`">
        <span class="denom-value" dir="ltr">{{ d.toLocaleString('en-US') }}</span>
        <div class="stepper">
          <button type="button" class="step-btn" @click="decrement(d)">−</button>
          <input
            v-model.number="counts[String(d)]"
            type="number"
            min="0"
            class="step-input"
            dir="ltr"
          />
          <button type="button" class="step-btn" @click="increment(d)">+</button>
        </div>
      </div>
      <div class="tally-total-row">
        <span>الإجمالي</span>
        <span dir="ltr" class="tally-total-value">{{ tallyTotal.toLocaleString('en-US') }}</span>
      </div>
    </div>

    <div v-else class="manual-input-wrap">
      <input
        v-model="manualTotal"
        type="number"
        min="0"
        :step="isSyp ? 1 : 0.01"
        class="manual-input"
        placeholder="0"
        dir="ltr"
      />
    </div>
  </div>
</template>

<style scoped>
.tally-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 1rem;
  padding: 0.75rem 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.tally-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem; flex-wrap: wrap; gap: 0.5rem; }

.tally-label { font-size: 0.8125rem; font-weight: 700; color: #9FB0C7; }

.mode-toggle { display: flex; gap: 0.35rem; }

.mode-btn {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.3rem 0.6rem;
  border-radius: 0.5rem;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.14);
  color: #9FB0C7;
  cursor: pointer;
  font-family: inherit;
}

.mode-btn.active { background: rgba(26,86,219,0.22); border-color: rgba(26,86,219,0.5); color: #60A5FA; }

.denom-list { display: flex; flex-direction: column; gap: 0.4rem; }

.denom-row { display: flex; align-items: center; justify-content: space-between; }

.denom-value { font-size: 0.85rem; font-weight: 600; color: #E8EDF5; }

.stepper { display: flex; align-items: center; gap: 0.35rem; }

.step-btn {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.5rem;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.16);
  color: #E8EDF5;
  font-size: 1rem;
  cursor: pointer;
  font-family: inherit;
}

.step-input {
  width: 3rem;
  text-align: center;
  background: transparent;
  border: none;
  outline: none;
  color: #E8EDF5;
  font-size: 0.9rem;
  font-weight: 700;
  font-family: inherit;
}

.tally-total-row {
  display: flex;
  justify-content: space-between;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255,255,255,0.1);
  font-size: 0.85rem;
  font-weight: 700;
  color: #22C55E;
}

.manual-input-wrap { padding-top: 0.25rem; }

.manual-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: #E8EDF5;
  font-size: 1.5rem;
  font-weight: 700;
  font-family: inherit;
  padding: 0;
}

.manual-input::placeholder { color: #3D4F6B; }
</style>
