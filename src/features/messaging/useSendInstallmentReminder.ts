import { resolvePhone, openWhatsApp } from './whatsapp'

export interface PrepareInstallmentReminderInput {
  customerName:  string
  shopName:      string
  amountDueUsd:  number
  dueDate:       string   // YYYY-MM-DD
  /** Total remaining across the whole plan (not just this due). */
  remainingUsd:  number
  phoneRaw?:     string
}

export interface PreparedInstallmentReminder {
  text:  string
  phone: string | null
}

export function useSendInstallmentReminder() {
  function prepare(input: PrepareInstallmentReminderInput): PreparedInstallmentReminder {
    const text =
      `السلام عليكم ${input.customerName}، تذكير بموعد القسط: ` +
      `$${input.amountDueUsd.toFixed(2)} بتاريخ ${input.dueDate}. ` +
      `الرصيد المتبقي: $${input.remainingUsd.toFixed(2)}. — ${input.shopName}`

    const phone = input.phoneRaw?.trim()
      ? resolvePhone(input.phoneRaw.trim(), '963')
      : null

    return { text, phone }
  }

  function send(phone: string, text: string): void {
    openWhatsApp(phone, text)
  }

  return { prepare, send }
}
