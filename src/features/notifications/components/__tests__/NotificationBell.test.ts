import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import NotificationBell from '../NotificationBell.vue'

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

vi.mock('@/data/powersync/db', () => ({
  db: {
    execute: vi.fn(),
    watch: (_sql: string, _params: unknown[], _opts: unknown) => ({
      [Symbol.asyncIterator]() {
        let done = false
        return {
          async next() {
            if (done) return { done: true, value: undefined }
            done = true
            return { done: false, value: { rows: { _array: fixtureRows } } }
          },
        }
      },
    }),
  },
}))

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a distinct visual marker for an unacknowledged CRITICAL notification', async () => {
    const wrapper = mount(NotificationBell)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.find('.nb-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="notification-critical-marker"]').exists()).toBe(true)
  })

  it('links to the full notification center', async () => {
    const wrapper = mount(NotificationBell)
    await wrapper.vm.$nextTick()
    await wrapper.find('.nb-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('a[href="/notifications"]').exists()).toBe(true)
  })
})
