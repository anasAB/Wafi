<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = useRouter()

onMounted(() => {
  if (window.matchMedia('(min-width: 1024px)').matches) {
    router.replace('/products')
  }
})

const modules = [
  { key: 'products',  label: 'المنتجات',  description: 'إدارة المخزون والأسعار', route: '/products',  active: true  },
  { key: 'customers', label: 'الزبائن',   description: 'الديون والمدفوعات',       route: '/customers', active: true  },
  { key: 'reports',   label: 'التقارير',  description: 'الأرباح والمبيعات',       route: null,         active: false },
  { key: 'expenses',  label: 'المصاريف', description: 'تتبع مصاريف المحل',       route: null,         active: false },
  { key: 'shifts',    label: 'الكاشيرات', description: 'الورديات والصلاحيات',     route: null,         active: false },
]

function handleTile(mod: typeof modules[number]) {
  if (mod.route) router.push(mod.route)
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-bg-void" dir="rtl">
    <AppHeader title="الإدارة" />

    <main class="flex-1 px-4 py-8 max-w-4xl mx-auto w-full">

      <!-- Active modules -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <button
          v-for="mod in modules.filter(m => m.active)"
          :key="mod.key"
          type="button"
          :data-testid="`tile-${mod.key}`"
          class="glass-md p-6 flex items-center gap-4 text-right cursor-pointer active:scale-[0.98] hover:bg-surface-raised transition-all rounded-2xl"
          style="border-color: var(--color-border-gold)"
          @click="handleTile(mod)"
        >
          <div class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
               style="background: rgb(201 168 76 / 0.12)">
            <svg v-if="mod.key === 'products'" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-gold-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            <svg v-if="mod.key === 'customers'" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-gold-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <div>
            <p class="text-base font-semibold text-text-primary">{{ mod.label }}</p>
            <p class="text-xs text-text-muted mt-0.5">{{ mod.description }}</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted mr-auto rtl:ml-auto rtl:mr-0 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <!-- Coming soon -->
      <div class="mb-8">
        <p class="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3 px-1">قريباً</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div
            v-for="mod in modules.filter(m => !m.active)"
            :key="mod.key"
            :data-testid="`tile-${mod.key}`"
            class="glass-sm p-4 flex items-center gap-3 opacity-40 rounded-2xl"
          >
            <div class="w-9 h-9 rounded-lg bg-surface-raised flex items-center justify-center flex-shrink-0">
              <svg v-if="mod.key === 'reports'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <svg v-if="mod.key === 'expenses'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              <svg v-if="mod.key === 'shifts'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <span class="text-sm text-text-muted">{{ mod.label }}</span>
          </div>
        </div>
      </div>

      <!-- Settings row (mobile only — desktop reaches settings via sidebar) -->
      <button
        type="button"
        class="w-full flex items-center gap-3 px-4 py-3.5 glass-sm rounded-2xl text-sm text-text-muted hover:bg-surface-glass hover:text-text-primary transition-all"
        @click="router.push('/settings')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span class="flex-1 text-right">الإعدادات</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

    </main>
  </div>
</template>
