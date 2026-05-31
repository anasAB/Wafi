<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()

const modules = [
  { key: 'products', label: 'المنتجات', icon: '📦', route: '/products', active: true },
  { key: 'reports',  label: 'التقارير',  icon: '📊', route: null, active: false },
  { key: 'expenses', label: 'المصاريف', icon: '💰', route: null, active: false },
  { key: 'shifts',   label: 'الكاشيرات', icon: '👥', route: null, active: false },
]

function handleTile(mod: typeof modules[number]) {
  if (mod.route) router.push(mod.route)
}
</script>

<template>
  <div class="flex flex-col min-h-dvh" dir="rtl">
    <AppHeader title="الإدارة الخلفية" :show-back-office="false" />

    <main class="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
      <div class="grid grid-cols-2 gap-4">
        <button
          v-for="mod in modules"
          :key="mod.key"
          type="button"
          :data-testid="`tile-${mod.key}`"
          :disabled="!mod.active"
          class="rounded-2xl p-6 flex flex-col items-center gap-2 text-center transition-all"
          :class="mod.active
            ? 'bg-blue-600 text-white shadow-md active:scale-95'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'"
          @click="handleTile(mod)"
        >
          <span class="text-3xl">{{ mod.icon }}</span>
          <span class="text-sm font-semibold">{{ mod.label }}</span>
          <span v-if="!mod.active" class="text-xs opacity-60">قريباً</span>
        </button>
      </div>
    </main>
  </div>
</template>
