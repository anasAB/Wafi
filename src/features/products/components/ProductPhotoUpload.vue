<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  (e: 'change', blobUrl: string | null): void
  (e: 'error', message: string): void
}>()

defineProps<{ modelValue?: string | null }>()

const fileInput = ref<HTMLInputElement | null>(null)
const MAX_BYTES = 200 * 1024

async function compressToWebP(file: File): Promise<Blob> {
  const img = new Image()
  const objectUrl = URL.createObjectURL(file)
  img.src = objectUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('load'))
  })
  URL.revokeObjectURL(objectUrl)

  const canvas = document.createElement('canvas')
  const MAX_SIDE = 800
  let { width, height } = img
  if (width > MAX_SIDE || height > MAX_SIDE) {
    if (width >= height) { height = Math.round(height * MAX_SIDE / width); width = MAX_SIDE }
    else                 { width  = Math.round(width  * MAX_SIDE / height); height = MAX_SIDE }
  }
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)

  let quality = 0.85
  let blob!: Blob
  do {
    blob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/webp', quality))
    quality -= 0.1
  } while (blob.size > MAX_BYTES && quality >= 0.1)

  return blob
}

async function handleFile(file: File) {
  try {
    const blob = await compressToWebP(file)
    if (blob.size > MAX_BYTES) {
      emit('error', 'تعذّر ضغط الصورة — حاول بصورة أخرى')
      return
    }
    emit('change', URL.createObjectURL(blob))
  } catch {
    emit('error', 'تعذّر ضغط الصورة — حاول بصورة أخرى')
  }
}

function handleInputChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
}

function clear() {
  emit('change', null)
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div class="photo-root">
    <!-- Thumbnail when photo exists -->
    <div v-if="modelValue" class="photo-preview">
      <img :src="modelValue" alt="صورة المنتج" class="preview-img" />
      <button
        type="button"
        class="remove-btn"
        aria-label="حذف الصورة"
        @click="clear"
      >✕</button>
    </div>

    <!-- Upload area when no photo -->
    <label
      v-else
      class="upload-area"
    >
      <svg class="upload-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
      </svg>
      <span class="upload-label">اضغط لإضافة صورة</span>
      <span class="upload-hint">PNG, JPG, WebP</span>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        data-testid="photo-input"
        @change="handleInputChange"
      />
    </label>
  </div>
</template>

<style scoped>
.photo-root {
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Upload area ─────────────────────────────────── */
.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 24px;
  border-radius: 0.75rem;
  background: rgba(26,86,219,0.06);
  border: 1.5px dashed rgba(26,86,219,0.35);
  color: #637285;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.upload-area:hover {
  background: rgba(26,86,219,0.10);
  border-color: rgba(26,86,219,0.55);
  color: #60A5FA;
}

.upload-icon {
  width: 32px;
  height: 32px;
}

.upload-label {
  font-size: 14px;
  font-weight: 600;
}

.upload-hint {
  font-size: 12px;
  color: #3D4F6B;
}

.upload-area:hover .upload-hint {
  color: #637285;
}

/* ── Photo preview ───────────────────────────────── */
.photo-preview {
  position: relative;
  width: 112px;
  height: 112px;
  border-radius: 0.75rem;
  overflow: hidden;
  border: 1px solid rgba(26,86,219,0.25);
  box-shadow: 0 4px 16px rgba(26,86,219,0.12);
}

.preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ── Remove button ───────────────────────────────── */
.remove-btn {
  position: absolute;
  top: 6px;
  inset-inline-end: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #E8EDF5;
  background: rgba(0,0,0,0.65);
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
}

.remove-btn:hover {
  opacity: 0.80;
}
</style>
