import { useSaleStore } from '@/store/sale.store'
import { useDeviceStore } from '@/store/device.store'

export function useSaleNumber() {
  function formatNumber(deviceCode: string, sequence: number): string {
    const padded = String(sequence + 1).padStart(6, '0')
    return `${deviceCode}-${padded}`
  }

  function nextNumber(): string {
    const sale = useSaleStore()
    const device = useDeviceStore()
    const seq = sale.deviceSequence // capture BEFORE increment
    sale.incrementSequence()
    return formatNumber(device.deviceCode, seq)
  }

  return { formatNumber, nextNumber }
}
