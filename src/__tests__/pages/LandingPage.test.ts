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
    expect(wrapper.find('[data-testid="hero"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Fully in command')
  })

  it('renders three pillar cards', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, {
      global: { plugins: [router, makePinia()] },
    })
    expect(wrapper.find('[data-testid="pillars"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Always On')
    expect(wrapper.text()).toContain('Speaks Your Language')
    expect(wrapper.text()).toContain('Any Device You Have')
  })

  it('renders product story section', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
    expect(wrapper.find('[data-testid="product-story"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Ring up a sale in under 10 seconds')
  })

  it('renders founding CTA section', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
    expect(wrapper.find('[data-testid="founding-cta"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Join the founding circle')
  })

  it('renders footer', async () => {
    const router = makeRouter()
    await router.push('/')
    const wrapper = mount(LandingPage, { global: { plugins: [router, makePinia()] } })
    expect(wrapper.find('[data-testid="footer"]').exists()).toBe(true)
  })
})
