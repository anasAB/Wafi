<script setup lang="ts">
/**
 * FormField — the single label/validation wrapper for form inputs.
 *
 *  - BUG-006: one required-field marker (red asterisk) applied consistently.
 *  - BUG-007: error text is rendered in one place with one style, so screens
 *             stop inventing their own phrasings/markup.
 *  - Optional "(اختياري)" hint for clearly-optional fields.
 *
 * Presentational only: the caller supplies the actual <input>/<textarea> via
 * the default slot and owns its v-model. Pair the control with `class="form-input"`
 * so it inherits the global focus ring (see style.css).
 */
defineProps<{
  label:     string
  required?: boolean
  optional?: boolean
  error?:    string
}>()
</script>

<template>
  <div class="field-group">
    <label class="field-label">
      {{ label }}
      <span v-if="required" class="field-required" aria-hidden="true">*</span>
      <span v-else-if="optional" class="field-optional">(اختياري)</span>
    </label>

    <slot />

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.field-group { display: flex; flex-direction: column; margin-bottom: 1rem; }

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  margin-bottom: 6px;
  display: block;
}
.field-required { color: #EF4444; margin-inline-start: 0.15rem; }
.field-optional {
  color: #3D4F6B;
  font-weight: 400;
  margin-inline-start: 0.25rem;
}

.field-error {
  font-size: 0.75rem;
  color: #EF4444;
  margin-top: 0.375rem;
}
</style>
