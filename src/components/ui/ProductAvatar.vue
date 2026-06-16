<script setup lang="ts">
/**
 * ProductAvatar — image-or-initial fallback for product thumbnails.
 *
 * When a product has no photo, instead of a generic grey icon (or nothing),
 * render a colored square with the product's first letter. The color is derived
 * deterministically from the name, so a given product always looks the same.
 * Fills its container (the call site controls size). (BUG-015 new list.)
 */
import { computed } from 'vue'

const props = defineProps<{
  name:      string
  photoUrl?: string | null
}>()

// On-brand tint + matching text color pairs.
const PALETTE: [string, string][] = [
  ['rgba(26,86,219,0.18)',  '#60A5FA'],
  ['rgba(34,197,94,0.16)',  '#34D399'],
  ['rgba(245,158,11,0.16)', '#FBBF24'],
  ['rgba(168,85,247,0.16)', '#C084FC'],
  ['rgba(236,72,153,0.16)', '#F472B6'],
  ['rgba(20,184,166,0.16)', '#2DD4BF'],
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Spread handles Arabic/emoji surrogate pairs correctly.
const initial = computed(() => {
  const trimmed = (props.name ?? '').trim()
  return trimmed ? [...trimmed][0] : '؟'
})

const colors = computed(() => PALETTE[hash(props.name ?? '') % PALETTE.length])
</script>

<template>
  <img v-if="photoUrl" :src="photoUrl" :alt="name" class="pa-img" />
  <span
    v-else
    class="pa-initial"
    :style="{ background: colors[0], color: colors[1] }"
    aria-hidden="true"
  >{{ initial }}</span>
</template>

<style scoped>
.pa-img { width: 100%; height: 100%; object-fit: cover; }
.pa-initial {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Tajawal', system-ui, sans-serif;
  font-weight: 700;
  font-size: 1rem;
}
</style>
