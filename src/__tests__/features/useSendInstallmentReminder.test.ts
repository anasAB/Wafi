import { describe, it, expect, vi } from 'vitest'
import { useSendInstallmentReminder } from '@/features/messaging/useSendInstallmentReminder'

describe('useSendInstallmentReminder.prepare', () => {
  it('builds the reminder text with name, amount, date, and remaining balance', () => {
    const { prepare } = useSendInstallmentReminder()
    const result = prepare({
      customerName: 'محمد',
      shopName: 'محل الإلكترونيات',
      amountDueUsd: 100,
      dueDate: '2026-09-01',
      remainingUsd: 200,
      phoneRaw: '0944123456',
    })
    expect(result.text).toContain('محمد')
    expect(result.text).toContain('$100.00')
    expect(result.text).toContain('2026-09-01')
    expect(result.text).toContain('$200.00')
    expect(result.text).toContain('محل الإلكترونيات')
    expect(result.phone).toBe('963944123456')
  })

  it('resolves phone to null when none is supplied', () => {
    const { prepare } = useSendInstallmentReminder()
    const result = prepare({
      customerName: 'محمد', shopName: 'المحل', amountDueUsd: 50,
      dueDate: '2026-09-01', remainingUsd: 50,
    })
    expect(result.phone).toBeNull()
  })
})

describe('useSendInstallmentReminder.send', () => {
  it('opens WhatsApp with the given phone and text', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { send } = useSendInstallmentReminder()
    send('963944123456', 'test message')
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/963944123456'),
      '_blank',
    )
    openSpy.mockRestore()
  })
})
