import { ref } from 'vue'

export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit' | 'split'

export interface ReceiptData {
  saleId:            string
  displaySaleNumber: string
  shopName:          string
  createdAt:         string
  lines: Array<{
    nameAr:        string
    quantity:      number
    unitPriceUsd:  number
    lineTotalUsd:  number
  }>
  totalUsd:                 number
  totalSyp:                 number
  exchangeRate:             number
  paymentMethod:            PaymentMethod
  amountReceived?:          number
  amountReceivedCurrency?:  'USD' | 'SYP'
  changeDue?:               number
  taxNumber?:               string
  headerText?:              string
  footerText?:              string
  /** Per-leg breakdown for a split sale, so a reprint matches the original. */
  splitPayments?: Array<{ method: PaymentMethod; amountUsd: number }>
  /** Marks a reprint of a fully-returned sale so it isn't mistaken for a live sale. */
  isFullyReturned?:         boolean
}

export interface IPrinterDriver {
  print(receipt: ReceiptData): Promise<void>
}

export class SimulatedDriver implements IPrinterDriver {
  async print(receipt: ReceiptData): Promise<void> {
    // Simulates thermal print operation
    console.log('[SimulatedPrinter]', {
      saleNumber: receipt.displaySaleNumber,
      total:      `$${receipt.totalUsd.toFixed(2)} / ${receipt.totalSyp.toLocaleString()} ل.س`,
      lines:      receipt.lines.map(l => `${l.nameAr} × ${l.quantity} = $${l.lineTotalUsd.toFixed(2)}`),
    })
  }
}

export function usePrinter(driver: IPrinterDriver = new SimulatedDriver()) {
  const printing = ref(false)
  const error    = ref<string | null>(null)

  async function print(receipt: ReceiptData): Promise<void> {
    printing.value = true
    error.value    = null
    try {
      await driver.print(receipt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Print failed'
      error.value = msg
      throw err
    } finally {
      printing.value = false
    }
  }

  return { printing, error, print }
}
