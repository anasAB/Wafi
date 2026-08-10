<!-- src/features/dashboard/components/IntelligenceCard.vue -->
<!-- WAFI-146: presentation-only shell shared by all 5 intelligence cards.
     Deliberately owns no domain data shape — see design spec's "Shared
     card shell" section for why Inventory/Staff/Customer don't fit a
     single comparison-shaped interface. -->
<script setup lang="ts">
defineProps<{
  state: 'loading' | 'ready' | 'error' | 'placeholder'
  expanded: boolean
}>()
const emit = defineEmits<{ toggle: []; retry: [] }>()
</script>

<template>
  <div class="ic-card">
    <button type="button" data-testid="ic-header" class="ic-header" @click="emit('toggle')">
      <div class="ic-headline"><slot name="headline" /></div>
      <svg class="ic-chevron" :class="{ 'ic-chevron--open': expanded }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <div v-if="state === 'error'" data-testid="ic-error" class="ic-error">
      <slot name="error">
        <span>حدث خطأ في التحميل</span>
      </slot>
      <button type="button" data-testid="ic-retry" class="ic-retry-btn" @click="emit('retry')">إعادة المحاولة</button>
    </div>
    <div v-else-if="expanded" class="ic-body">
      <div v-if="state === 'loading'" class="ic-loading">…</div>
      <div v-else-if="state === 'placeholder'" data-testid="ic-placeholder" class="ic-placeholder">
        <slot name="placeholder" />
      </div>
      <div v-else>
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ic-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.25);
  border-radius: 14px;
  overflow: hidden;
}
.ic-header {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 16px 18px; background: transparent; border: none; cursor: pointer;
  font-family: 'Tajawal', sans-serif; text-align: right;
}
.ic-headline { flex: 1; color: #E8EDF5; }
.ic-chevron { color: #637285; transition: transform .2s; flex-shrink: 0; }
.ic-chevron--open { transform: rotate(180deg); }
.ic-body { padding: 0 18px 16px; }
.ic-loading { color: #637285; font-size: 12px; text-align: center; padding: 12px 0; }
.ic-error { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 18px; color: #EF4444; font-size: 12px; }
.ic-retry-btn {
  border: 1px solid rgba(239,68,68,0.4); background: rgba(239,68,68,0.12); color: #EF4444;
  border-radius: 8px; padding: 5px 12px; font-size: 11px; font-weight: 700; cursor: pointer;
}
.ic-placeholder { color: #637285; font-size: 12px; text-align: center; padding: 12px 0; }
</style>
