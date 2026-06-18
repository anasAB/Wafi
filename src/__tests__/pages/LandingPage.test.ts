import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import LandingPage from '@/pages/LandingPage.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: LandingPage },
      { path: '/home', component: { template: '<div>home</div>' } },
      { path: '/pos', component: { template: '<div>pos</div>' } },
    ],
  })
}

function makePinia() {
  const p = createPinia()
  p.use(piniaPluginPersistedstate)
  return p
}

describe('LandingPage', () => {
  it('renders the hero section with headline', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, {
      global: { plugins: [router, makePinia()] },
    })
    expect(wrapper.find('.lp-hero').exists()).toBe(true)
    expect(wrapper.text()).toContain('تحت سيطرتك الكاملة.')
  })

  it('renders the features grid', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, {
      global: { plugins: [router, makePinia()] },
    })
    expect(wrapper.find('.lp-features-grid').exists()).toBe(true)
    expect(wrapper.text()).toContain('كل ما يحتاجه متجرك.')
  })

  it('renders product story section', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
    expect(wrapper.find('.lp-story-wrap').exists()).toBe(true)
  })

  it('renders founding CTA section', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
    expect(wrapper.find('.lp-cta-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('انضم لدائرة المؤسسين.')
  })

  it('renders footer', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
    expect(wrapper.find('.lp-footer').exists()).toBe(true)
  })

  it('does not advertise the unbuilt Electronics Pro pack while its flag is off', async () => {
    // Flag defaults to false (no VITE_FF_ELECTRONICS_PRO in the test env), so
    // none of the IMEI/repair/warranty copy should reach the DOM.
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })

    expect(wrapper.text()).not.toContain('إلكترونيات برو')
    expect(wrapper.text()).not.toContain('تتبع IMEI')
    // The packs that are actually built still render.
    expect(wrapper.text()).toContain('باقة الموظفين')
  })
})
