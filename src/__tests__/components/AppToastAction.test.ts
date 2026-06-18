import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppToast from '@/components/ui/AppToast.vue'

describe('AppToast action button', () => {
  it('renders no action button by default', () => {
    const w = mount(AppToast, { props: { message: 'hi' } })
    expect(w.find('[data-testid="toast-action"]').exists()).toBe(false)
  })

  it('renders the action button and emits "action" on click', async () => {
    const w = mount(AppToast, { props: { message: 'hi', actionLabel: 'تحديث' } })
    const btn = w.find('[data-testid="toast-action"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('تحديث')
    await btn.trigger('click')
    expect(w.emitted('action')).toBeTruthy()
  })
})
