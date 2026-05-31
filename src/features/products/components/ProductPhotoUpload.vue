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
  } while (blob.size > MAX_BYTES && quality > 0.1)

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
  <div>
    <div
      v-if="modelValue"
      class="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700"
    >
      <img :src="modelValue" alt="صورة المنتج" class="w-full h-full object-cover" />
      <button
        type="button"
        class="absolute top-1 left-1 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs"
        aria-label="حذف الصورة"
        @click="clear"
      >✕</button>
    </div>

    <label
      v-else
      class="flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed
             border-gray-300 dark:border-gray-600 rounded-xl p-6 cursor-pointer
             hover:border-blue-400 transition-colors text-gray-400 dark:text-gray-500"
    >
      <span class="text-2xl">📷</span>
      <span class="text-sm">اضغط لإضافة صورة</span>
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
