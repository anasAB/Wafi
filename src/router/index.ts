import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                 component: () => import('@/pages/HomePage.vue') },
    { path: '/pos',              component: () => import('@/pages/PosPage.vue') },
    { path: '/pos/confirmation', component: () => import('@/features/pos/SaleConfirmationScreen.vue') },
    { path: '/history',          component: () => import('@/pages/SaleHistoryPage.vue') },
    {
      path: '/settings',
      component: () => import('@/pages/SettingsPage.vue'),
      children: [
        {
          path: 'personal',
          component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue'),
        },
      ],
    },
    { path: '/:pathMatch(.*)*',  redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
