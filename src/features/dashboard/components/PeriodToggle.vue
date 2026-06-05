<script setup lang="ts">
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import type { Period } from '@/features/dashboard/composables/periodUtils'

const { period, setPeriod } = usePeriodToggle()

const options: { value: Period; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'week',  label: 'الأسبوع' },
  { value: 'month', label: 'الشهر' },
]
</script>

<template>
  <div
    class="toggle-container"
    dir="rtl"
    role="tablist"
    aria-label="اختر الفترة الزمنية"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :data-testid="`period-${opt.value}`"
      role="tab"
      :aria-selected="period.value === opt.value"
      class="toggle-btn"
      :class="period.value === opt.value ? 'active' : 'inactive'"
      @click="setPeriod(opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.toggle-container {
  font-family: 'Tajawal', system-ui, sans-serif;
  display: flex;
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.toggle-btn {
  font-family: 'Tajawal', system-ui, sans-serif;
  flex: 1;
  padding: 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
  line-height: 1.25;
}

.toggle-btn.active {
  background: #1A56DB;
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 2px 10px rgba(26, 86, 219, 0.45);
}

.toggle-btn.inactive {
  background: transparent;
  color: #637285;
}

.toggle-btn.inactive:hover {
  color: #E8EDF5;
  background: rgba(255, 255, 255, 0.06);
}
</style>
