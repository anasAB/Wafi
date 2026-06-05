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
  <div class="page-root" dir="rtl">
    <AppHeader title="الإدارة" />

    <main class="page-main">

      <!-- Active modules -->
      <div class="section-label">الأقسام</div>
      <div class="nav-list">
        <button
          v-for="mod in modules.filter(m => m.active)"
          :key="mod.key"
          type="button"
          :data-testid="`tile-${mod.key}`"
          class="nav-item"
          @click="handleTile(mod)"
        >
          <!-- Icon -->
          <div class="nav-icon-wrap">
            <svg v-if="mod.key === 'products'" xmlns="http://www.w3.org/2000/svg" class="nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            <svg v-if="mod.key === 'customers'" xmlns="http://www.w3.org/2000/svg" class="nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <!-- Text -->
          <div class="nav-text">
            <p class="nav-title">{{ mod.label }}</p>
            <p class="nav-desc">{{ mod.description }}</p>
          </div>
          <!-- Arrow -->
          <svg xmlns="http://www.w3.org/2000/svg" class="nav-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <!-- Coming soon -->
      <div class="coming-soon-section">
        <div class="section-label">قريباً</div>
        <div class="coming-soon-grid">
          <div
            v-for="mod in modules.filter(m => !m.active)"
            :key="mod.key"
            :data-testid="`tile-${mod.key}`"
            class="coming-soon-item"
          >
            <div class="coming-icon-wrap">
              <svg v-if="mod.key === 'reports'" xmlns="http://www.w3.org/2000/svg" class="coming-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <svg v-if="mod.key === 'expenses'" xmlns="http://www.w3.org/2000/svg" class="coming-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              <svg v-if="mod.key === 'shifts'" xmlns="http://www.w3.org/2000/svg" class="coming-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <span class="coming-label">{{ mod.label }}</span>
          </div>
        </div>
      </div>

      <!-- Settings row -->
      <button
        type="button"
        class="settings-row"
        @click="router.push('/settings')"
      >
        <div class="settings-icon-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" class="settings-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <span class="settings-label">الإعدادات</span>
        <svg xmlns="http://www.w3.org/2000/svg" class="settings-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

    </main>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.page-main {
  flex: 1;
  padding: 1.5rem 1rem 80px;
  max-width: 56rem;
  margin-inline: auto;
  width: 100%;
}

/* Section label */
.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.625rem;
  padding-inline-start: 0.25rem;
}

/* Nav list */
.nav-list {
  display: flex;
  flex-direction: column;
  border-radius: 1rem;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  margin-bottom: 1.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 14px 16px;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  cursor: pointer;
  text-align: right;
  transition: background 0.15s;
  width: 100%;
}

.nav-item:last-child {
  border-bottom: none;
}

.nav-item:hover {
  background: rgba(26, 86, 219, 0.06);
}

.nav-item:active {
  transform: scale(0.99);
}

.nav-icon-wrap {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  background: rgba(26, 86, 219, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-icon {
  width: 1.375rem;
  height: 1.375rem;
  color: #60A5FA;
}

.nav-text {
  flex: 1;
  min-width: 0;
}

.nav-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: #E8EDF5;
  line-height: 1.3;
}

.nav-desc {
  font-size: 0.75rem;
  color: #637285;
  margin-top: 0.125rem;
}

.nav-arrow {
  width: 1rem;
  height: 1rem;
  color: #3D4F6B;
  flex-shrink: 0;
  /* RTL: arrow points left (toward start) */
  transform: rotate(180deg);
}

/* Coming soon section */
.coming-soon-section {
  margin-bottom: 1.5rem;
}

.coming-soon-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.625rem;
}

@media (min-width: 640px) {
  .coming-soon-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.coming-soon-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.08), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(26, 86, 219, 0.18);
  opacity: 0.40;
}

.coming-icon-wrap {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.coming-icon {
  width: 1.125rem;
  height: 1.125rem;
  color: #637285;
}

.coming-label {
  font-size: 0.875rem;
  color: #637285;
}

/* Settings row */
.settings-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.08), rgba(255, 255, 255, 0.03));
  border: 1px solid rgba(26, 86, 219, 0.18);
  cursor: pointer;
  transition: background 0.15s;
}

.settings-row:hover {
  background: rgba(26, 86, 219, 0.06);
}

.settings-icon-wrap {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: rgba(26, 86, 219, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.settings-icon {
  width: 1.125rem;
  height: 1.125rem;
  color: #60A5FA;
}

.settings-label {
  flex: 1;
  text-align: right;
  font-size: 0.875rem;
  color: #E8EDF5;
}

.settings-arrow {
  width: 1rem;
  height: 1rem;
  color: #3D4F6B;
  flex-shrink: 0;
  transform: rotate(180deg);
}
</style>
