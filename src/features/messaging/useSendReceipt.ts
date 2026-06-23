import type { ReceiptData } from '@/composables/usePrinter'
import { formatReceiptText } from './receiptText'
import { resolvePhone, openWhatsApp } from './whatsapp'

export interface PreparedReceipt {
  text:  string
  phone: string | null
}

export function useSendReceipt() {
  /**
   * Build the WhatsApp text and resolve the phone (if supplied).
   * Pure — no DB, no I/O.
   */
  function prepare(receipt: ReceiptData, phoneRaw?: string): PreparedReceipt {
    return {
      text:  formatReceiptText(receipt),
      phone: phoneRaw !== undefined ? resolvePhone(phoneRaw) : null,
    }
  }

  /** Open WhatsApp with the resolved phone and the (possibly edited) text. */
  function send(phone: string, text: string): void {
    openWhatsApp(phone, text)
  }

  return { prepare, send }
}
