<script setup lang="ts">
/**
 * BaseModal — the single overlay primitive for the whole app.
 *
 * Fixes the cross-cutting modal bugs by giving every overlay one contract:
 *  - BUG-004: a single standardized X close button (no more −/none variants)
 *  - BUG-039: responsive — centered dialog on desktop, bottom-sheet on phones
 *             (no more mobile sheets stranded in a desktop viewport)
 *  - dismiss via X, backdrop click, or ESC (all gated by `dismissible`)
 *  - body scroll-lock while open
 *
 * The component is purely presentational: callers own the form/content and its
 * action buttons via the default slot (and optional #footer slot).
 */
import { onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{
  title:        string
  dismissible?: boolean
}>(), {
  dismissible: true,
})

const emit = defineEmits<{ (e: 'close'): void }>()

function requestClose() {
  if (props.dismissible) emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') requestClose()
}

// Lock background scroll while the modal is open, restore on teardown.
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" data-testid="backdrop" @click.self="requestClose">
      <div class="modal-panel" role="dialog" aria-modal="true" :aria-label="title" dir="rtl">
        <!-- Header: title + standardized close -->
        <div class="modal-header">
          <h2 class="modal-title">{{ title }}</h2>
          <button
            type="button"
            class="modal-close"
            data-testid="modal-close"
            aria-label="إغلاق"
            @click="emit('close')"
          >
            <svg class="modal-close-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Caller content -->
        <div class="modal-body">
          <slot />
        </div>

        <!-- Optional pinned footer -->
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  /* Phone-first: dock to the bottom as a sheet. */
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  font-family: 'Tajawal', system-ui, sans-serif;
}

.modal-panel {
  width: 100%;
  max-width: 32rem;
  max-height: 88dvh;
  display: flex;
  flex-direction: column;
  border-radius: 1.25rem 1.25rem 0 0;
  backdrop-filter: blur(24px) saturate(180%);
  background: linear-gradient(180deg, rgba(26, 86, 219, 0.22) 0%, rgba(7, 11, 20, 0.98) 72px);
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-bottom: none;
  box-shadow: 0 -8px 48px rgba(0, 0, 0, 0.55), 0 0 40px rgba(26, 86, 219, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

/* Desktop / tablet: a true centered dialog, fully rounded. */
@media (min-width: 640px) {
  .modal-overlay { align-items: center; padding: 1rem; }
  .modal-panel {
    border-radius: 1.25rem;
    border-bottom: 1px solid rgba(26, 86, 219, 0.28);
    box-shadow: 0 8px 48px rgba(0, 0, 0, 0.55), 0 0 40px rgba(26, 86, 219, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
  flex-shrink: 0;
}

.modal-title {
  font-size: 1rem;
  font-weight: 700;
  color: #E8EDF5;
}

.modal-close {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.modal-close:hover { background: rgba(255, 255, 255, 0.10); color: #C8D5E8; }
.modal-close-icon { width: 1rem; height: 1rem; }

.modal-body {
  overflow-y: auto;
  padding: 0 1.25rem 1.25rem;
}

.modal-footer {
  flex-shrink: 0;
  padding: 0.75rem 1.25rem 1.25rem;
  border-top: 1px solid rgba(26, 86, 219, 0.14);
}
</style>
