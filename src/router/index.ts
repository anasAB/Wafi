import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '@/store/session.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { isRouteAllowed, resolveLanding } from './permissions'
import { useFlagsStore } from '@/features/flags/flags.store'
import type { FlagKey } from '@/features/flags/flagRegistry'
import type { StaffPermissions } from '@/features/staff/staff.types'
import { supabase } from '@/data/supabase/client'
import { resumeBootstrapIfPending } from './bootstrap-resume'

const SHIFT_OPEN_REDIRECT = '/shifts/history'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // The home dashboard is the business-health financial roll-up — owner-only
    // by default, owner-grantable to a manager via can_view_reports (WAFI-058).
    { path: '/',                  component: () => import('@/pages/HomePage.vue'), meta: { permission: 'can_view_reports' } },
    { path: '/pos',               component: () => import('@/pages/PosPage.vue'), meta: { requiresOpenShift: true } },
    { path: '/pos/confirmation',  component: () => import('@/features/pos/SaleConfirmationScreen.vue'), meta: { requiresOpenShift: true } },
    { path: '/history',           component: () => import('@/pages/SaleHistoryPage.vue') },
    { path: '/back-office',       component: () => import('@/features/products/BackOfficePage.vue') },
    { path: '/products',          component: () => import('@/features/products/ProductsPage.vue'),     meta: { permission: 'can_manage_products' } },
    { path: '/products/add',      component: () => import('@/features/products/AddProductPage.vue'),   meta: { permission: 'can_manage_products' } },
    { path: '/products/:id/edit', component: () => import('@/features/products/EditProductPage.vue'),  meta: { permission: 'can_manage_products' } },
    { path: '/products/import',   component: () => import('@/features/imports/ImportWizardPage.vue'),  meta: { permission: 'can_manage_products' } },
    { path: '/categories', component: () => import('@/features/categories/components/CategoriesManagementScreen.vue'), meta: { permission: 'can_manage_products' } },
    { path: '/expenses',          component: () => import('@/features/expenses/ExpenseListPage.vue'),  meta: { permission: 'can_view_expenses' } },
    // WAFI-138: staff ledger/settlement — reuses can_view_expenses (no new permission flag).
    { path: '/staff/:staffId/ledger',                       component: () => import('@/features/staff-ledger/views/StaffLedgerView.vue'),       meta: { permission: 'can_view_expenses' }, props: true },
    { path: '/staff/:staffId/settlement/draft/:periodMonth', component: () => import('@/features/staff-ledger/views/SettlementDraftView.vue'),   meta: { permission: 'can_view_expenses' }, props: true },
    { path: '/staff/:staffId/settlement/:settlementId',      component: () => import('@/features/staff-ledger/views/SettlementDetailView.vue'),  meta: { permission: 'can_view_expenses' }, props: true },
    { path: '/customers',         component: () => import('@/features/customers/CustomersPage.vue'),       meta: { permission: 'can_manage_customers' } },
    { path: '/customers/collections', component: () => import('@/features/customers/CollectionsWorklistPage.vue'), meta: { permission: 'can_view_reports' } },
    { path: '/customers/:id',     component: () => import('@/features/customers/CustomerDetailPage.vue'),  meta: { permission: 'can_manage_customers' } },
    { path: '/installments',      component: () => import('@/features/installments/InstallmentsDuePage.vue'), meta: { permission: 'can_manage_customers' } },
    { path: '/suppliers',         component: () => import('@/features/suppliers/SuppliersPage.vue'),       meta: { permission: 'can_manage_products' } },
    { path: '/suppliers/:id',     component: () => import('@/features/suppliers/SupplierDetailPage.vue'),  meta: { permission: 'can_manage_products' } },
    { path: '/receivings',        component: () => import('@/features/suppliers/ReceivingsPage.vue'),      meta: { permission: 'can_manage_products' } },
    { path: '/stock-take',            component: () => import('@/features/stock-take/components/StockTakeStartScreen.vue'), meta: { permission: 'can_manage_products' } },
    { path: '/stock-take/history',     component: () => import('@/features/stock-take/components/StockTakeHistoryScreen.vue'), meta: { permission: 'can_manage_products' } },
    { path: '/stock-take/:id',         component: () => import('@/features/stock-take/components/StockTakeSessionScreen.vue'), meta: { permission: 'can_manage_products' } },
    { path: '/stock-take/:id/review',  component: () => import('@/features/stock-take/components/StockTakeReviewScreen.vue'), meta: { permission: 'can_manage_products' } },
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
        { path: 'scanner',        component: () => import('@/features/settings/screens/ScannerDiagnosticsScreen.vue') },
        { path: 'devices',        component: () => import('@/features/devices/DevicesScreen.vue') },
        { path: 'audit-log', component: () => import('@/features/audit/AuditLogPage.vue') },
        { path: 'recovery-codes', component: () => import('@/features/settings/screens/RecoveryCodesScreen.vue') },
        { path: 'report-problem', component: () => import('@/features/settings/screens/ReportProblemScreen.vue') },
        { path: 'exports',   component: () => import('@/features/exports/ExportPage.vue') },
        { path: 'denominations', component: () => import('@/features/settings/screens/DenominationSettingsScreen.vue') },
        { path: 'discount-caps', component: () => import('@/features/pos/DiscountCapsSettingsScreen.vue') },
      ],
    },
    { path: '/reports',         component: () => import('@/features/dashboard/components/ReportsPage.vue'),      meta: { permission: 'can_view_reports', feature: 'reporting_pack' } },
    // WAFI-131: upgrade teaser for pack-gated features
    { path: '/feature-locked',  component: () => import('@/features/flags/FeatureLockedScreen.vue') },
    { path: '/onboarding',      component: () => import('@/pages/OnboardingPage.vue') },
    { path: '/shifts/history',  component: () => import('@/features/shifts/components/ShiftHistoryScreen.vue') },
    { path: '/shifts/:id',      component: () => import('@/features/shifts/components/ShiftDetailScreen.vue') },
    { path: '/setup-owner',     component: () => import('@/features/shifts/components/OwnerSetupScreen.vue') },
    { path: '/welcome', component: () => import('@/components/HomePage.vue') },
    { path: '/login',  component: () => import('@/pages/LoginPage.vue') },
    { path: '/signup', component: () => import('@/pages/SignupPage.vue') },
    { path: '/forgot-password', component: () => import('@/pages/ForgotPasswordPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// One-time boot check (not per-navigation): if a previous owner-bootstrap
// attempt was left incomplete (crash, closed tab, or server success with
// local hydration never finishing), resume it automatically here rather than
// inside the beforeEach guard below, which runs on every navigation.
// .catch() is required, not cosmetic: this call is unawaited at module load,
// so an unhandled rejection here would surface as a process-level error in
// any file that merely imports the router (e.g. any test importing
// './router') even though nothing about that failure is fatal to boot.
resumeBootstrapIfPending().catch(() => {
  // Resume is best-effort; a failure here just means the pending bootstrap
  // (if any) stays pending and will be retried on the next boot or by the
  // owner-setup screen itself.
})

// Enforce staff permissions on navigation. to.meta merges all matched records'
// meta, so settings children inherit the parent's permission. An unauthorized
// staffer is sent to their landing route — never to '/', which is itself gated
// by can_view_reports and would loop. resolveLanding() returns '/pos' (always
// reachable) for anyone lacking reports, so a deep-link to a denied financial
// route fails closed onto the POS instead of bouncing (WAFI-058).
router.beforeEach(async (to) => {
  const PUBLIC_PATHS = ['/welcome', '/login', '/signup', '/forgot-password']
  const { data } = await supabase.auth.getSession()
  const isAuthenticated = !!data.session

  if (!isAuthenticated && !PUBLIC_PATHS.includes(to.path)) {
    return '/welcome'
  }
  if (isAuthenticated && PUBLIC_PATHS.includes(to.path)) {
    return '/'
  }
  if (PUBLIC_PATHS.includes(to.path)) {
    return true
  }

  const required = to.meta.permission as keyof StaffPermissions | undefined
  const requiresOpenShift = Boolean(to.meta.requiresOpenShift)
  // Active operator lives in the session store (WAFI-011) — the same store a
  // "switch operator" updates, so guards re-scope on switch.
  const staff = useSessionStore().activeStaff
  if (!isRouteAllowed(required, staff)) {
    const landing = resolveLanding(staff)
    // Guard against any self-redirect (defensive — resolveLanding never returns a
    // gated route for a staffer who lacks it).
    return to.path === landing ? true : landing
  }

  // Ring-a-sale routes require an active open shift. Redirect to a non-POS route
  // so the global LockScreen open-shift flow can take over without URL loops.
  if (requiresOpenShift && !useShiftStore().isShiftOpen) {
    return to.path === SHIFT_OPEN_REDIRECT ? true : SHIFT_OPEN_REDIRECT
  }

  // WAFI-131: per-shop pack gating. A route tagged meta.feature is reachable
  // only when the shop's synced flag enables it; otherwise the clean upgrade
  // teaser — never a broken screen. Gating applies at navigation, so a flag
  // turned off mid-operation lets the current screen finish (ticket rule).
  const feature = to.meta.feature as FlagKey | undefined
  if (feature) {
    const flags = useFlagsStore()
    await flags.ensureLoaded()
    if (!flags.isEnabled(feature)) {
      return { path: '/feature-locked', query: { f: feature } }
    }
  }

  return true
})

export default router
