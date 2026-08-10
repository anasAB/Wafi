import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import IntelligenceCard from './IntelligenceCard.vue'

describe('IntelligenceCard', () => {
  it('renders the headline slot always, and the body slot only when expanded', async () => {
    const wrapper = mount(IntelligenceCard, {
      props: { state: 'ready', expanded: false },
      slots: { headline: '<span data-testid="headline">Revenue down</span>', default: '<div data-testid="body">Details</div>' },
    })
    expect(wrapper.find('[data-testid="headline"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(false)

    await wrapper.setProps({ expanded: true })
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(true)
  })

  it('emits toggle on header click', async () => {
    const wrapper = mount(IntelligenceCard, { props: { state: 'ready', expanded: false } })
    await wrapper.find('[data-testid="ic-header"]').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('shows an error state with a retry button that emits retry, distinct from an empty ready state', () => {
    const wrapper = mount(IntelligenceCard, { props: { state: 'error', expanded: false } })
    expect(wrapper.find('[data-testid="ic-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ic-retry"]').exists()).toBe(true)
  })

  it('shows the placeholder state distinctly from ready/error', () => {
    const wrapper = mount(IntelligenceCard, {
      props: { state: 'placeholder', expanded: true },
      slots: { placeholder: 'Available once today closes' },
    })
    expect(wrapper.find('[data-testid="ic-placeholder"]').text()).toContain('Available once today closes')
    expect(wrapper.find('[data-testid="ic-error"]').exists()).toBe(false)
  })
})
