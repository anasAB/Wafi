import { createRouter, createWebHistory } from 'vue-router'
import { useShiftStore } from '@/features/shifts/shift.store'
import { isRouteAllowed } from './permissions'
import type { StaffPermissions } from '@/features/staff/staff.types'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                  component: () => import('@/pages/HomePage.vue') },
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
      ],
    },
    { path: '/exports', component: () => import('@/features/exports/ExportPage.vue') },
    { path: '/shifts/history',  component: () => import('@/features/shifts/components/ShiftHistoryScreen.vue') },
    { path: '/setup-owner',     component: () => import('@/features/shifts/components/OwnerSetupScreen.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// Enforce staff permissions on navigation. to.meta merges all matched records'
// meta, so settings children inherit the parent's permission. Unauthorized
// staff are sent home rather than reaching a screen the sidebar hides.
router.beforeEach((to) => {
  const required = to.meta.permission as keyof StaffPermissions | undefined
  const staff = useShiftStore().activeStaff
  return isRouteAllowed(required, staff) ? true : '/'
})

export default router
