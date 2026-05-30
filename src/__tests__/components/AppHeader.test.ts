import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import AppHeader from '@/components/ui/AppHeader.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes:  [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountHeader(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  return mount(AppHeader, {
    props: { title: 'Test', ...props },
    global: { plugins: [pinia, router] },
  })
}

describe('AppHeader', () => {
  it('renders the title', () => {
    const w = mountHeader()
    expect(w.text()).toContain('Test')
  })

  it('shows gear icon by default', () => {
    const w = mountHeader()
    expect(w.find('[data-testid="gear-link"]').exists()).toBe(true)
  })

  it('hides gear icon when showSettings is false', () => {
    const w = mountHeader({ showSettings: false })
    expect(w.find('[data-testid="gear-link"]').exists()).toBe(false)
  })

  it('shows back button when showBack is true', () => {
    const w = mountHeader({ showBack: true })
    expect(w.find('[data-testid="back-button"]').exists()).toBe(true)
  })

  it('hides back button by default', () => {
    const w = mountHeader()
    expect(w.find('[data-testid="back-button"]').exists()).toBe(false)
  })
})
