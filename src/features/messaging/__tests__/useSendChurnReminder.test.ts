import { describe, it, expect, vi } from 'vitest'

vi.mock('../whatsapp', () => ({
  resolvePhone: vi.fn((raw: string) => (raw ? '963900000000' : null)),
  openWhatsApp: vi.fn(),
}))

import { openWhatsApp } from '../whatsapp'
import { useSendChurnReminder } from '../useSendChurnReminder'

describe('useSendChurnReminder', () => {
  it('prepares a plain check-in message and resolves the phone', () => {
    const { prepare } = useSendChurnReminder()
    const result = prepare({ customerName: 'أحمد', shopName: 'محل أحمد', phoneRaw: '0900000000' })
    expect(result.phone).toBe('963900000000')
    expect(result.text).toContain('أحمد')
    expect(result.text).toContain('محل أحمد')
  })

  it('returns phone null when no phone number is on file', () => {
    const { prepare } = useSendChurnReminder()
    const result = prepare({ customerName: 'أحمد', shopName: 'محل أحمد' })
    expect(result.phone).toBeNull()
  })

  it('send() only opens WhatsApp — never sends automatically on prepare()', () => {
    const { prepare } = useSendChurnReminder()
    prepare({ customerName: 'أحمد', shopName: 'محل أحمد', phoneRaw: '0900000000' })
    expect(openWhatsApp).not.toHaveBeenCalled()
  })
})
