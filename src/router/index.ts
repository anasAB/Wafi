import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '@/store/session.store'
import { isRouteAllowed, resolveLanding } from './permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The home dashboard is the business-health financial roll-up — owner-only
    // by default, owner-grantable to a manager via can_view_reports (WAFI-058).
    { path: '/',                  component: () => import('@/pages/HomePage.vue'), meta: { permission: 'can_view_reports' } },
    { path: '/pos',               component: () => import('@/pages/PosPage.vue') },
    { path: '/pos/confirmation',  component: () => import('@/features/pos/SaleConfirmationScreen.vue') },
    { path: '/history',           component: () => import('@/pages/SaleHistoryPage.vue') },
    { path: '/back-office',       component: () => import('@/features/products/BackOfficePage.vue') },
    { path: '/products',          component: () => import('@/features/products/ProductsPage.vue'),     meta: { permission: 'can_manage_products' } },
    { path: '/products/add',      component: () => import('@/features/products/AddProductPage.vue'),   meta: { permission: 'can_manage_products' } },
    { path: '/products/:id/edit', component: () => import('@/features/products/EditProductPage.vue'),  meta: { permission: 'can_manage_products' } },
    { path: '/expenses',          component: () => import('@/features/expenses/ExpenseListPage.vue'),  meta: { permission: 'can_view_expenses' } },
    { path: '/customers',         component: () => import('@/features/customers/CustomersPage.vue'),       meta: { permission: 'can_manage_customers' } },
    { path: '/customers/:id',     component: () => import('@/features/customers/CustomerDetailPage.vue'),  meta: { permission: 'can_manage_customers' } },
    { path: '/suppliers',         component: () => import('@/features/suppliers/SuppliersPage.vue'),       meta: { permission: 'can_manage_products' } },
    { path: '/suppliers/:id',     component: () => import('@/features/suppliers/SupplierDetailPage.vue'),  meta: { permission: 'can_manage_products' } },
    { path: '/receivings',        component: () => import('@/features/suppliers/ReceivingsPage.vue'),      meta: { permission: 'can_manage_products' } },
    {
      // Parent meta is merged into child route meta, so all settings screens inherit this guard.
      path: '/settings',
      component: () => import('@/pages/SettingsPage.vue'),
      meta: { permission: 'can_manage_settings' },
      children: [
        { path: 'personal',       component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue') },
        { path: 'receipt',        component: () => import('@/features/receipt/ReceiptSettingsScreen.vue') },
        { path: 'staff',          component: () => import('@/features/staff/components/StaffList.vue') },
        { path: 'return-reasons', component: () => import('@/features/settings/screens/ReturnReasonsScreen.vue') },
        { path: 'audit-log', component: () => import('@/features/audit/AuditLogPage.vue') },
        { path: 'recovery-codes', component: () => import('@/features/settings/screens/RecoveryCodesScreen.vue') },
        { path: 'exports',   component: () => import('@/features/exports/ExportPage.vue') },
      ],
    },
    { path: '/shifts/history',  component: () => import('@/features/shifts/components/ShiftHistoryScreen.vue') },
    { path: '/setup-owner',     component: () => import('@/features/shifts/components/OwnerSetupScreen.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// Enforce staff permissions on navigation. to.meta merges all matched records'
// meta, so settings children inherit the parent's permission. An unauthorized
// staffer is sent to their landing route — never to '/', which is itself gated
// by can_view_reports and would loop. resolveLanding() returns '/pos' (always
// reachable) for anyone lacking reports, so a deep-link to a denied financial
// route fails closed onto the POS instead of bouncing (WAFI-058).
router.beforeEach((to) => {
  const required = to.meta.permission as keyof StaffPermissions | undefined
  // Active operator lives in the session store (WAFI-011) — the same store a
  // "switch operator" updates, so guards re-scope on switch.
  const staff = useSessionStore().activeStaff
  if (isRouteAllowed(required, staff)) return true
  const landing = resolveLanding(staff)
  // Guard against any self-redirect (defensive — resolveLanding never returns a
  // gated route for a staffer who lacks it).
  return to.path === landing ? true : landing
})

export default router
