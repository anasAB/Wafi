/**
 * useSendChurnReminder — compose a plain "we miss you" WhatsApp check-in for
 * a customer flagged inactive on the Dashboard 2.0 Customer card.
 *
 * Mirrors useSendStatement.ts's prepare/send split: prepare() is pure (no
 * I/O), send() is the only function that opens WhatsApp, and it is never
 * called automatically — the caller (CustomerIntelligenceCard.vue) must
 * call it from an explicit user tap. No new messaging backend.
 */

import { resolvePhone, openWhatsApp } from './whatsapp'

export interface PrepareChurnReminderInput {
  customerName: string
  shopName: string
  phoneRaw?: string
}

export interface PreparedChurnReminder {
  text: string
  phone: string | null
}

export function useSendChurnReminder() {
  /**
   * Build the WhatsApp churn reminder text and resolve the phone (if supplied).
   * Pure — no DB, no I/O, no new Date().
   */
  function prepare(input: PrepareChurnReminderInput): PreparedChurnReminder {
    const { customerName, shopName, phoneRaw } = input
    const text = `مرحباً ${customerName}، اشتقنا لزيارتك في ${shopName}! تفضل بزيارتنا قريباً 🙏`
    const phone = phoneRaw?.trim() ? resolvePhone(phoneRaw.trim(), '963') : null
    return { text, phone }
  }

  /**
   * Open WhatsApp with the resolved phone and the (possibly edited) text.
   */
  function send(phone: string, text: string): void {
    openWhatsApp(phone, text)
  }

  return { prepare, send }
}
