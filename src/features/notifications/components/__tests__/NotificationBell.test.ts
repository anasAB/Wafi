import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import NotificationBell from '../NotificationBell.vue'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

const fixtureRows = [
  {
    id: 'n1',
    title: 'Drawer variance detected',
    message: 'Cash drawer is short by $12.',
    entity_type: 'shift',
    entity_id: 'shift-1',
    severity: 'CRITICAL',
    created_at: '2026-08-08T10:00:00.000Z',
    read_at: null,
    acknowledged_at: null,
  },
]

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountBell() {
  return mount(NotificationBell, {
    global: { plugins: [router] },
  })
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.watch).mockReturnValue({
      [Symbol.asyncIterator]: vi.fn().mockReturnValue({
        next: vi.fn()
          .mockResolvedValueOnce({ value: { rows: { _array: fixtureRows } }, done: false })
          .mockResolvedValue({ value: undefined, done: true }),
        return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
      }),
    } as any)
  })

  it('renders a distinct visual marker for an unacknowledged CRITICAL notification', async () => {
    const wrapper = mountBell()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.find('.nb-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="notification-critical-marker"]').exists()).toBe(true)
  })

  it('links to the full notification center', async () => {
    const wrapper = mountBell()
    await wrapper.vm.$nextTick()
    await wrapper.find('.nb-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('a[href="/notifications"]').exists()).toBe(true)
  })
})
