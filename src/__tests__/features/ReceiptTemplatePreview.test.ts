import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReceiptTemplatePreview from '@/features/receipt/components/ReceiptTemplatePreview.vue'
import type { ReceiptSettings } from '@/features/receipt/receipt.types'

const empty: ReceiptSettings = { shopName: '', taxNumber: '', headerText: '', footerText: '' }

function mountPreview(settings: Partial<ReceiptSettings> = {}) {
  return mount(ReceiptTemplatePreview, {
    props: { settings: { ...empty, ...settings } },
  })
}

describe('ReceiptTemplatePreview', () => {
  it('always renders the dummy sale line', () => {
    const w = mountPreview()
    expect(w.find('[data-testid="preview-dummy-line"]').exists()).toBe(true)
  })

  it('renders shopName when set', () => {
    const w = mountPreview({ shopName: 'محل الإلكترونيات' })
    expect(w.find('[data-testid="preview-shop-name"]').text()).toBe('محل الإلكترونيات')
  })

  it('shows placeholder name when shopName is empty', () => {
    const w = mountPreview({ shopName: '' })
    expect(w.find('[data-testid="preview-shop-name"]').text()).toContain('اسم المحل')
  })

  it('renders taxNumber when set', () => {
    const w = mountPreview({ taxNumber: '12345678' })
    expect(w.find('[data-testid="preview-tax-number"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-tax-number"]').text()).toContain('12345678')
  })

  it('hides taxNumber when empty', () => {
    const w = mountPreview({ taxNumber: '' })
    expect(w.find('[data-testid="preview-tax-number"]').exists()).toBe(false)
  })

  it('renders headerText when set', () => {
    const w = mountPreview({ headerText: 'Electronics & Accessories' })
    expect(w.find('[data-testid="preview-header-text"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-header-text"]').text()).toBe('Electronics & Accessories')
  })

  it('hides headerText when empty', () => {
    const w = mountPreview({ headerText: '' })
    expect(w.find('[data-testid="preview-header-text"]').exists()).toBe(false)
  })

  it('renders footerText when set', () => {
    const w = mountPreview({ footerText: 'شكراً لزيارتكم' })
    expect(w.find('[data-testid="preview-footer-text"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-footer-text"]').text()).toBe('شكراً لزيارتكم')
  })

  it('hides footerText when empty', () => {
    const w = mountPreview({ footerText: '' })
    expect(w.find('[data-testid="preview-footer-text"]').exists()).toBe(false)
  })
})
