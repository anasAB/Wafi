<script setup lang="ts">
import { ref } from 'vue'
import LockScreen from '@/features/shifts/components/LockScreen.vue'

// One trigger + overlay reused on every surface that offers "switch operator"
// (desktop sidebar, phone dashboard). The overlay is LockScreen in switch mode:
// pick a face, enter that person's PIN — no shift change. `variant` only styles
// the trigger; the overlay behaviour is identical everywhere.
withDefaults(defineProps<{ variant?: 'sidebar' | 'compact' }>(), { variant: 'compact' })

const open = ref(false)
</script>

<template>
  <!-- Sidebar variant: matches the other bottom nav actions. -->
  <button
    v-if="variant === 'sidebar'"
    type="button"
    class="nav-item nav-item-idle switch-btn"
    @click="open = true"
  >
    <span class="nav-icon-wrap nav-icon-idle">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-9L21 3m0 0l-4.5-4.5M21 3H7.5" transform="translate(0 4.5)" />
      </svg>
    </span>
    <span class="nav-text">تبديل المستخدم</span>
  </button>

  <!-- Compact variant: a small icon button for a page header. -->
  <button
    v-else
    type="button"
    class="compact-btn"
    aria-label="تبديل المستخدم"
    @click="open = true"
  >
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  </button>

  <Teleport to="body">
    <LockScreen
      v-if="open"
      mode="switch"
      @done="open = false"
      @cancel="open = false"
    />
  </Teleport>
</template>

<style scoped>
/* Sidebar variant reuses the sidebar's nav-item look (defined locally so the
   component is self-contained rather than depending on AppSidebar's styles). */
.switch-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  width: 100%;
  font-family: 'Tajawal', system-ui, sans-serif;
  transition: background 0.15s, border-color 0.15s;
}
.switch-btn:hover {
  background: rgba(26,86,219,0.08);
  border-color: rgba(26,86,219,0.14);
}
.nav-icon-wrap {
  width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.nav-icon-idle { background: rgba(255,255,255,0.05); color: #637285; }
.switch-btn:hover .nav-icon-idle { background: rgba(26,86,219,0.12); color: #93B4F0; }
.nav-text { font-size: 14px; font-weight: 500; flex: 1; min-width: 0; color: #637285; }
.switch-btn:hover .nav-text { color: #C8D5E8; }

/* Compact icon button for a page header. */
.compact-btn {
  width: 38px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(26,86,219,0.25);
  color: #93B4F0; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.compact-btn:hover {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.4);
}
</style>
