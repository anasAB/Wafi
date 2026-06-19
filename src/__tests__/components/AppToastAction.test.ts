import { describe, it, expect, vi, afterEach } from 'vitest'
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

describe('AppToast autoDismiss timer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-dismisses after 4000ms when autoDismiss is true (default)', () => {
    vi.useFakeTimers()
    const w = mount(AppToast, { props: { message: 'hi' } })
    expect(w.emitted('dismiss')).toBeFalsy()
    vi.advanceTimersByTime(4000)
    expect(w.emitted('dismiss')).toBeTruthy()
  })

  it('does NOT auto-dismiss after 4000ms when autoDismiss is false', () => {
    vi.useFakeTimers()
    const w = mount(AppToast, { props: { message: 'تحديث متاح', autoDismiss: false } })
    expect(w.emitted('dismiss')).toBeFalsy()
    vi.advanceTimersByTime(4000)
    expect(w.emitted('dismiss')).toBeFalsy()
  })
})
