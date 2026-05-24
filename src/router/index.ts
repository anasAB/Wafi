import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',        component: () => import('@/pages/HomePage.vue') },
    { path: '/pos',     component: () => import('@/pages/PosPage.vue') },
    { path: '/history', component: () => import('@/pages/SaleHistoryPage.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
