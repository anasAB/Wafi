<script setup lang="ts">
import { ref, computed }   from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n }         from 'vue-i18n'
import { useSessionStore } from '@/store/session.store'
import ZReportScreen       from '@/features/shifts/components/ZReportScreen.vue'

const route = useRoute()
const { t } = useI18n()
const session     = useSessionStore()
const showZReport = ref(false)

interface NavItem {
  key:        string
  labelKey:   string
  href:       string | null
  permission: string | null
}

// Labels are i18n keys (resolved in the template) so the nav re-renders on a
// language switch without rebuilding this list.
const allNavItems: NavItem[] = [
  { key: 'home',        labelKey: 'nav.home',       href: '/',               permission: null },
  { key: 'pos',         labelKey: 'nav.pos',        href: '/pos',            permission: null },
  { key: 'history',     labelKey: 'nav.sales',      href: '/history',        permission: null },
  { key: 'products',    labelKey: 'nav.products',   href: '/products',       permission: 'can_manage_products' },
  { key: 'expenses',    labelKey: 'nav.expenses',   href: '/expenses',       permission: 'can_view_expenses' },
  { key: 'customers',   labelKey: 'nav.customers',  href: '/customers',      permission: 'can_manage_customers' },
  { key: 'suppliers',   labelKey: 'nav.suppliers',  href: '/suppliers',      permission: 'can_manage_products' },
  { key: 'receivings',  labelKey: 'nav.receivings', href: '/receivings',     permission: 'can_manage_products' },
  { key: 'shifts',      labelKey: 'nav.shifts',     href: '/shifts/history', permission: null },
  { key: 'reports',     labelKey: 'nav.reports',    href: null,              permission: 'can_view_reports' },
]

const navItems = computed(() => {
  const perms   = session.permissions
  const isOwner = session.activeStaff?.role === 'owner'
  if (!perms || isOwner) return allNavItems.filter(i => i.href !== null)
  return allNavItems.filter(i =>
    i.href !== null && (!i.permission || (perms as any)[i.permission])
  )
})

// Same gating as the main nav, applied to the Settings entry (which lives in the
// bottom section). Shown to owners and to staff with can_manage_settings.
const canManageSettings = computed(() => {
  const perms   = session.permissions
  const isOwner = session.activeStaff?.role === 'owner'
  if (!perms || isOwner) return true
  return Boolean(perms.can_manage_settings)
})

function isActive(href: string | null): boolean {
  if (!href) return false
  if (href === '/') return route.path === '/'
  return route.path === href || route.path.startsWith(href + '/')
}
</script>

<template>
  <aside class="sidebar" dir="rtl">

    <!-- Brand -->
    <RouterLink to="/" class="brand">
      <div class="brand-icon-wrap">
        <svg width="18" height="18" fill="none" stroke="#60A5FA" stroke-width="2.2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016 2.993 2.993 0 002.25-1.016 3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
        </svg>
      </div>
      <div class="brand-text">
        <span class="brand-name">{{ session.activeStaff?.name || 'وافي' }}</span>
        <span class="brand-sub">{{ t('nav.dashboard') }}</span>
      </div>
      <div class="brand-badge">POS</div>
    </RouterLink>

    <!-- Main nav -->
    <nav class="nav-section">
      <p class="nav-label-header">{{ t('nav.menu') }}</p>

      <component
        v-for="item in navItems"
        :key="item.key"
        :is="item.href ? RouterLink : 'div'"
        v-bind="item.href ? { to: item.href } : {}"
        :class="[
          'nav-item',
          isActive(item.href) ? 'nav-item-active' : 'nav-item-idle',
        ]"
      >
        <span :class="['nav-icon-wrap', isActive(item.href) ? 'nav-icon-active' : 'nav-icon-idle']">
          <!-- Home -->
          <svg v-if="item.key === 'home'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
          <!-- POS -->
          <svg v-if="item.key === 'pos'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
          <!-- History -->
          <svg v-if="item.key === 'history'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
          <!-- Products -->
          <svg v-if="item.key === 'products'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
          <!-- Reports -->
          <svg v-if="item.key === 'reports'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <!-- Expenses -->
          <svg v-if="item.key === 'expenses'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
          <!-- Shifts -->
          <svg v-if="item.key === 'shifts'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <!-- Customers -->
          <svg v-if="item.key === 'customers'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <!-- Suppliers -->
          <svg v-if="item.key === 'suppliers'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
          <!-- Receivings -->
          <svg v-if="item.key === 'receivings'" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15M9 12l3 3m0 0l3-3m-3 3V2.25" />
          </svg>
        </span>

        <span class="nav-text">{{ t(item.labelKey) }}</span>

        <span v-if="isActive(item.href)" class="active-dot" />
      </component>
    </nav>

    <!-- Bottom actions -->
    <div class="sidebar-bottom">
      <RouterLink
        v-if="canManageSettings"
        to="/settings"
        :class="['nav-item', route.path.startsWith('/settings') ? 'nav-item-active' : 'nav-item-idle']"
      >
        <span :class="['nav-icon-wrap', route.path.startsWith('/settings') ? 'nav-icon-active' : 'nav-icon-idle']">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </span>
        <span class="nav-text">{{ t('nav.settings') }}</span>
      </RouterLink>

      <button class="close-shift-btn" @click="showZReport = true">
        <span class="nav-icon-wrap nav-icon-warn">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
        </span>
        <span class="nav-text nav-text-warn">{{ t('nav.closeShift') }}</span>
      </button>
    </div>

  </aside>

  <Teleport to="body">
    <ZReportScreen v-if="showZReport" @close="showZReport = false" />
  </Teleport>
</template>

<style scoped>
.sidebar {
  width: 230px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: sticky;
  top: 0;
  overflow-y: auto;
  background: linear-gradient(180deg,
    rgba(26,86,219,0.20) 0%,
    rgba(26,86,219,0.10) 25%,
    rgba(7,11,20,0.99)  100%
  );
  border-inline-start: 1px solid rgba(26,86,219,0.25);
  box-shadow: inset -1px 0 0 rgba(26,86,219,0.08);
}

/* ── Brand ── */
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 64px;
  flex-shrink: 0;
  text-decoration: none;
  border-bottom: 1px solid rgba(26,86,219,0.18);
  background: linear-gradient(135deg, rgba(26,86,219,0.12), transparent);
}

.brand-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(26,86,219,0.30), rgba(26,86,219,0.15));
  border: 1px solid rgba(26,86,219,0.40);
  box-shadow: 0 2px 12px rgba(26,86,219,0.20);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.brand-name {
  font-size: 14px;
  font-weight: 700;
  color: #E8EDF5;
  truncate: true;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-sub {
  font-size: 10px;
  color: #3D4F6B;
  margin-top: 1px;
}

.brand-badge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #60A5FA;
  background: rgba(26,86,219,0.15);
  border: 1px solid rgba(26,86,219,0.30);
  border-radius: 6px;
  padding: 2px 7px;
  flex-shrink: 0;
}

/* ── Nav ── */
.nav-section {
  flex: 1;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-label-header {
  font-size: 10px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 4px 10px 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  text-decoration: none;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  width: 100%;
  background: none;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.nav-item-active {
  background: linear-gradient(135deg, rgba(26,86,219,0.22), rgba(26,86,219,0.10));
  border-color: rgba(26,86,219,0.38);
  box-shadow: 0 2px 16px rgba(26,86,219,0.18), inset 0 1px 0 rgba(255,255,255,0.06);
}

.nav-item-idle:hover {
  background: rgba(26,86,219,0.08);
  border-color: rgba(26,86,219,0.14);
}

.nav-item-sub {
  margin-inline-start: 14px;
  padding-block: 5px;
  font-size: 12px;
  opacity: 0.75;
}

.nav-item-sub:hover {
  opacity: 1;
}

/* ── Nav Icon Wrap ── */
.nav-icon-wrap {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}

.nav-icon-active {
  background: rgba(26,86,219,0.22);
  color: #60A5FA;
}

.nav-icon-idle {
  background: rgba(255,255,255,0.05);
  color: #637285;
}

.nav-item-idle:hover .nav-icon-idle {
  background: rgba(26,86,219,0.12);
  color: #93B4F0;
}

/* Closing a shift is a routine end-of-day action → amber/warning, not red.
   Red stays reserved for genuinely destructive actions (BUG-014 new list). */
.nav-icon-warn {
  background: rgba(245,158,11,0.12);
  color: #F59E0B;
}

/* ── Nav text ── */
.nav-text {
  font-size: inherit;
  font-weight: 500;
  flex: 1;
  min-width: 0;
}

.nav-item-active .nav-text {
  color: #C8D5E8;
  font-weight: 600;
}

.nav-item-idle .nav-text {
  color: #637285;
}

.nav-item-idle:hover .nav-text {
  color: #C8D5E8;
}

.nav-text-warn {
  color: #F59E0B !important;
  font-weight: 600;
}

/* ── Active dot ── */
.active-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1A56DB;
  box-shadow: 0 0 8px rgba(26,86,219,0.60);
  flex-shrink: 0;
}

/* ── Bottom ── */
.sidebar-bottom {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid rgba(26,86,219,0.15);
}

.close-shift-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  width: 100%;
  font-family: 'Tajawal', system-ui, sans-serif;
  transition: background 0.15s, border-color 0.15s;
}

.close-shift-btn:hover {
  background: rgba(245,158,11,0.08);
  border-color: rgba(245,158,11,0.20);
}
</style>
