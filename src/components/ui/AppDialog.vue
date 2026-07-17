<script setup lang="ts">
defineProps<{
  title:         string
  message:       string
  confirmLabel?: string
  cancelLabel?:  string
  danger?:       boolean
}>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'):  void
}>()
</script>

<template>
  <!-- Backdrop -->
  <div
    class="dialog-overlay"
    @click.self="emit('cancel')"
    @keydown.esc="emit('cancel')"
  >
    <!-- Dialog panel -->
    <div
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'dialog-title'"
      class="dialog-panel"
    >
      <!-- Header -->
      <div class="dialog-header">
        <h2 id="dialog-title" class="dialog-title">{{ title }}</h2>
        <p class="dialog-message">{{ message }}</p>
      </div>

      <!-- Divider -->
      <div class="dialog-divider"></div>

      <!-- Actions -->
      <div class="dialog-actions">
        <button
          type="button"
          class="btn-ghost"
          @click="emit('cancel')"
        >{{ cancelLabel ?? 'إلغاء' }}</button>

        <button
          type="button"
          data-testid="dialog-confirm"
          class="btn-confirm"
          :class="danger ? 'btn-danger' : 'btn-primary'"
          @click="emit('confirm')"
        >{{ confirmLabel ?? 'تأكيد' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Overlay ────────────────────────────────────────── */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-inline: 1rem;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
}

/* ── Panel ──────────────────────────────────────────── */
.dialog-panel {
  width: 100%;
  max-width: 24rem;
  border-radius: 1.25rem;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.45);
  box-shadow:
    0 8px 48px rgba(26, 86, 219, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.09);
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Header ─────────────────────────────────────────── */
.dialog-header {
  padding: 1.5rem 1.5rem 1rem;
  text-align: right;
}

.dialog-title {
  font-size: 1rem;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0 0 0.5rem;
  line-height: 1.4;
}

.dialog-message {
  font-size: 0.875rem;
  color: #637285;
  line-height: 1.6;
  margin: 0;
}

/* ── Divider ─────────────────────────────────────────── */
.dialog-divider {
  height: 1px;
  background: rgba(26, 86, 219, 0.14);
}

/* ── Actions ─────────────────────────────────────────── */
.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.625rem;
  padding: 1rem 1.5rem;
}

/* ── Ghost / Cancel Button ───────────────────────────── */
.btn-ghost {
  height: 44px;
  padding-inline: 1.25rem;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #E8EDF5;
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.30);
}

/* ── Confirm Button base ─────────────────────────────── */
.btn-confirm {
  height: 44px;
  padding-inline: 1.5rem;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  border: none;
  color: #fff;
  transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
}

.btn-confirm:active {
  transform: scale(0.96);
}

/* ── Primary variant ─────────────────────────────────── */
.btn-primary {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
}

.btn-primary:hover {
  opacity: 0.88;
  box-shadow: 0 6px 24px rgba(26, 86, 219, 0.55);
}

/* ── Danger variant ──────────────────────────────────── */
.btn-danger {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.08));
  border: 1px solid rgba(239, 68, 68, 0.40);
  color: #EF4444;
  box-shadow: none;
}

.btn-danger:hover {
  opacity: 0.88;
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);
}
</style>
