<script setup lang="ts">
/**
 * EmptyState — one consistent "nothing here yet" treatment for list pages.
 *
 * Models the Expenses page (the reference the QA called out as correct): a
 * centered icon medallion, a title, an optional subtitle, and an optional
 * primary CTA embedded right in the empty state so the next action is obvious.
 *
 *  - Pass `ctaLabel` to render the action button; it emits `cta` on click.
 *  - Override the default icon via the #icon slot.
 */
defineProps<{
  title:     string
  subtitle?: string
  ctaLabel?: string
}>()

defineEmits<{ (e: 'cta'): void }>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon-wrap">
      <slot name="icon">
        <!-- Default: a neutral "inbox / empty" glyph -->
        <svg class="empty-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
        </svg>
      </slot>
    </div>

    <div class="empty-text">
      <p class="empty-title">{{ title }}</p>
      <p v-if="subtitle" class="empty-sub">{{ subtitle }}</p>
    </div>

    <button v-if="ctaLabel" type="button" class="empty-cta" @click="$emit('cta')">
      <svg class="cta-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      {{ ctaLabel }}
    </button>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 1rem;
  gap: 1rem;
  color: #637285;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.empty-icon-wrap {
  width: 4rem;
  height: 4rem;
  border-radius: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}
.empty-icon { width: 2rem; height: 2rem; }

.empty-text { text-align: center; }
.empty-title { font-size: 0.875rem; font-weight: 600; color: #E8EDF5; margin-bottom: 0.25rem; }
.empty-sub { font-size: 0.75rem; color: #637285; }

.empty-cta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-inline: 1.25rem;
  height: 44px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.15s;
}
.empty-cta:hover { opacity: 0.9; }
.empty-cta:active { transform: scale(0.97); }
.cta-icon { width: 1rem; height: 1rem; flex-shrink: 0; }
</style>
