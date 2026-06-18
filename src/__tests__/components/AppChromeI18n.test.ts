import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { i18n } from '@/i18n'

// AppSidebar statically imports ZReportScreen → useShift → the PowerSync db.
// Stub it so the chrome mounts without a live database (mirrors AppHeader.test).
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppBottomNav from '@/components/layout/AppBottomNav.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
  })
}

function makePinia() {
  const p = createPinia()
  p.use(piniaPluginPersistedstate)
  return p
}

// The shared i18n instance defaults to Arabic; restore it after each test so a
// locale flip here can't leak into other suites.
afterEach(() => {
  i18n.global.locale.value = 'ar'
})

describe('App chrome i18n', () => {
  it('renders the sidebar nav in Arabic by default and English after a locale switch', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(AppSidebar, { global: { plugins: [router, makePinia()] } })

    // Arabic (default locale)
    expect(wrapper.text()).toContain('الرئيسية')
    expect(wrapper.text()).toContain('نقطة البيع')
    expect(wrapper.text()).toContain('الإعدادات')

    // Switch to English — labels follow without a remount
    i18n.global.locale.value = 'en'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Home')
    expect(wrapper.text()).toContain('Point of Sale')
    expect(wrapper.text()).toContain('Settings')
    expect(wrapper.text()).not.toContain('الرئيسية')
  })

  it('relabels the bottom nav on a locale switch', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(AppBottomNav, { global: { plugins: [router, makePinia()] } })

    expect(wrapper.text()).toContain('المزيد')

    i18n.global.locale.value = 'en'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('More')
    expect(wrapper.text()).toContain('Products')
  })
})
