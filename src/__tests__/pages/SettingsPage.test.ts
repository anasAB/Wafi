import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import SettingsPage from '@/pages/SettingsPage.vue'

// matchMedia is mocked (matches:false) in the test setup, so these run as "mobile".
const ChildStub = { template: '<div class="child-stub">CHILD-SCREEN</div>' }

async function mountAt(path: string) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      {
        path: '/settings',
        component: SettingsPage,
        children: [{ path: 'exports', component: ChildStub }],
      },
    ],
  })
  const Root = { template: '<RouterView />' }
  const w = mount(Root, { global: { plugins: [pinia, router] } })
  await router.push(path)
  await router.isReady()
  await flushPromises()
  return w
}

describe('SettingsPage — mobile child rendering', () => {
  it('shows the settings list at the index', async () => {
    const w = await mountAt('/settings')
    expect(w.text()).toContain('تصدير البيانات') // list row present
    expect(w.find('.child-stub').exists()).toBe(false)
  })

  it('renders the child screen and hides the list on a child route', async () => {
    const w = await mountAt('/settings/exports')
    expect(w.find('.child-stub').exists()).toBe(true)
    // the list (which also contains this label) must be gone, not just CSS-hidden
    expect(w.text()).not.toContain('تصدير البيانات')
  })

  it('uses the sidebar + panel on desktop and mounts the child exactly once', async () => {
    // matchMedia is a vi.fn (test setup); make the next call report desktop.
    vi.mocked(window.matchMedia).mockReturnValueOnce({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const w = await mountAt('/settings/exports')
    expect(w.find('.desktop-nav').exists()).toBe(true)   // sidebar present
    expect(w.findAll('.child-stub')).toHaveLength(1)     // single mount, not double
  })
})
