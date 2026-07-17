import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/data/supabase/auth', () => ({ signOut: vi.fn() }))

import { db } from '@/data/powersync/db'
import { signOut } from '@/data/supabase/auth'
import PersonalPreferencesScreen from '@/features/settings/screens/PersonalPreferencesScreen.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountScreen() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(PersonalPreferencesScreen, { global: { plugins: [pinia, router] } })
}

describe('PersonalPreferencesScreen — sign out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getUploadQueueStats).mockResolvedValue({ count: 0, size: 0 })
  })

  it('signs out immediately when there are no unsynced writes', async () => {
    const wrapper = mountScreen()
    await wrapper.get('[data-testid="signout-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await wrapper.get('[data-testid="dialog-confirm"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(signOut).toHaveBeenCalled()
  })

  it('warns about unsynced data before signing out', async () => {
    vi.mocked(db.getUploadQueueStats).mockResolvedValue({ count: 3, size: 300 })
    const wrapper = mountScreen()
    await wrapper.get('[data-testid="signout-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('3')
  })
})
