import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock whatsapp module BEFORE importing useSendReceipt
vi.mock('../whatsapp', () => ({
  resolvePhone: vi.fn((raw: string | null | undefined, _cc?: string) => {
    if (!raw) return null
    const d = raw.replace(/\D/g, '')
    return d.length >= 11 ? d : null
  }),
  openWhatsApp: vi.fn(),
}))

import { useSendReceipt } from '../useSendReceipt'
import { formatReceiptText } from '../receiptText'
import * as whatsapp from '../whatsapp'
import type { ReceiptData } from '@/composables/usePrinter'

const receipt: ReceiptData = {
  saleId:            's-001',
  displaySaleNumber: 'A-000001',
  shopName:          'محل وافي',
  createdAt:         '2026-06-23T10:00:00Z',
  lines: [
    { nameAr: 'قلم', quantity: 2, unitPriceUsd: 0.5, lineTotalUsd: 1 },
  ],
  totalUsd:      1,
  totalSyp:      14500,
  exchangeRate:  14500,
  paymentMethod: 'cash_usd',
}

describe('useSendReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('prepare()', () => {
    it('returns text equal to formatReceiptText(receipt) when no phone given', () => {
      const { prepare } = useSendReceipt()
      const result = prepare(receipt)
      expect(result.text).toBe(formatReceiptText(receipt))
      expect(result.phone).toBeNull()
    })

    it('returns phone=null when an empty string is given', () => {
      const { prepare } = useSendReceipt()
      const result = prepare(receipt, '')
      expect(result.phone).toBeNull()
    })

    it('returns phone=null when an unresolvable number is given (too short)', () => {
      const { prepare } = useSendReceipt()
      const result = prepare(receipt, '123')
      expect(result.phone).toBeNull()
    })

    it('returns a resolved phone string when a valid international number is given', () => {
      // resolvePhone mock returns digits if length >= 11
      const validRaw = '+963912345678'
      const { prepare } = useSendReceipt()
      const result = prepare(receipt, validRaw)
      expect(result.phone).not.toBeNull()
      expect(typeof result.phone).toBe('string')
    })

    it('calls resolvePhone with the raw phone value', () => {
      const { prepare } = useSendReceipt()
      prepare(receipt, '0912345678')
      expect(whatsapp.resolvePhone).toHaveBeenCalledWith('0912345678')
    })
  })

  describe('send()', () => {
    it('calls openWhatsApp with the phone and text', () => {
      const { send } = useSendReceipt()
      send('963912345678', 'فاتورة')
      expect(whatsapp.openWhatsApp).toHaveBeenCalledWith('963912345678', 'فاتورة')
    })

    it('calls openWhatsApp exactly once', () => {
      const { send } = useSendReceipt()
      send('963912345678', 'some text')
      expect(whatsapp.openWhatsApp).toHaveBeenCalledTimes(1)
    })
  })
})
