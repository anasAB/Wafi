<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{ message: string; type?: 'info' | 'error' | 'success'; actionLabel?: string; autoDismiss?: boolean }>(),
  { autoDismiss: true }
)
const emit  = defineEmits<{ (e: 'dismiss'): void; (e: 'action'): void }>()

let timer: ReturnType<typeof setTimeout>
onMounted(() => {
  if (props.autoDismiss) {
    timer = setTimeout(() => emit('dismiss'), 4000)
  }
})
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    class="toast"
    :class="[`toast--${props.type ?? 'info'}`]"
  >
    <div class="toast-inner">
      <span class="toast-message">{{ message }}</span>
      <button
        v-if="props.actionLabel"
        type="button"
        data-testid="toast-action"
        class="toast-action"
        @click="emit('action')"
      >{{ props.actionLabel }}</button>
      <button
        type="button"
        class="toast-close"
        aria-label="إغلاق"
        @click="emit('dismiss')"
      >×</button>
    </div>
  </div>
</template>

<style scoped>
/* ── Base Toast ──────────────────────────────────────── */
.toast {
  position: fixed;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  width: calc(100% - 2rem);
  max-width: 20rem;
  border-radius: 0.75rem;
  padding: 12px 16px;
  backdrop-filter: blur(20px) saturate(180%);
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.875rem;
  color: #E8EDF5;
  animation: toast-slide-up 0.25s ease-out;
}

@media (min-width: 640px) {
  .toast {
    bottom: 1.5rem;
    width: 20rem;
  }
}

/* ── Slide-up animation ──────────────────────────────── */
@keyframes toast-slide-up {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* ── Inner layout ────────────────────────────────────── */
.toast-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.toast-message {
  font-weight: 500;
  line-height: 1.4;
  flex: 1;
}

/* ── Close button ────────────────────────────────────── */
.toast-close {
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  line-height: 1;
  cursor: pointer;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.65;
  border-radius: 0.25rem;
  transition: opacity 0.15s;
}

.toast-close:hover {
  opacity: 1;
}

.toast-action {
  flex-shrink: 0;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.20);
  color: inherit;
  border-radius: 0.5rem;
  padding: 4px 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-size: 0.8125rem; font-weight: 700;
  cursor: pointer;
}
.toast-action:hover { background: rgba(255,255,255,0.18); }

/* ── Success variant ─────────────────────────────────── */
.toast--success {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.14), rgba(34, 197, 94, 0.06));
  border: 1px solid rgba(34, 197, 94, 0.35);
  box-shadow:
    0 4px 20px rgba(34, 197, 94, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
  color: #E8EDF5;
}

/* ── Error variant ───────────────────────────────────── */
.toast--error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.06));
  border: 1px solid rgba(239, 68, 68, 0.35);
  box-shadow:
    0 4px 20px rgba(239, 68, 68, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
  color: #E8EDF5;
}

/* ── Info variant ────────────────────────────────────── */
.toast--info {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.40);
  box-shadow:
    0 4px 20px rgba(26, 86, 219, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
  color: #E8EDF5;
}
</style>
