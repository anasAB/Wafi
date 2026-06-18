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
    class="period-toggle toggle-container"
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
      :aria-selected="period === opt.value"
      class="pt-btn toggle-btn"
      :class="period === opt.value ? 'active' : 'inactive'"
      @click="setPeriod(opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.period-toggle,
.toggle-container {
  font-family: 'Tajawal', system-ui, sans-serif;
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}

.pt-btn,
.toggle-btn {
  font-family: 'Tajawal', system-ui, sans-serif;
  flex: 1;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  line-height: 1;
  white-space: nowrap;
}

.pt-btn.active,
.toggle-btn.active {
  background: #1A56DB;
  color: #ffffff;
  font-weight: 700;
}

.pt-btn.inactive,
.toggle-btn.inactive {
  background: transparent;
  color: #637285;
}

.pt-btn:hover:not(.active),
.toggle-btn:hover:not(.active) {
  color: #C8D5E8;
}
</style>
