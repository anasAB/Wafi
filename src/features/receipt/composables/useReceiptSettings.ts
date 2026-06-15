import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { ReceiptSettings, ReceiptSettingsRow } from '@/features/receipt/receipt.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

export function useReceiptSettings() {
  const { logReceiptSettingsUpdated } = useAuditLog()

  const settings = ref<ReceiptSettings>({
    shopName: '', taxNumber: '', headerText: '', footerText: '',
  })

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const row = await db.getOptional<ReceiptSettingsRow>(
      `SELECT * FROM receipt_settings WHERE shop_id = ? LIMIT 1`,
      [device.shopId]
    )
    if (row) {
      settings.value = {
        shopName:   row.shop_name   ?? '',
        taxNumber:  row.tax_number  ?? '',
        headerText: row.header_text ?? '',
        footerText: row.footer_text ?? '',
      }
    }
  }

  async function save(data: ReceiptSettings): Promise<void> {
    const device = useDeviceStore()
    const now    = new Date().toISOString()
    await db.execute(
      `INSERT OR REPLACE INTO receipt_settings
         (id, shop_id, shop_name, tax_number, header_text, footer_text, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [device.shopId, device.shopId, data.shopName, data.taxNumber,
       data.headerText, data.footerText, now]
    )
    settings.value = { ...data }
    await logReceiptSettingsUpdated()
  }

  return { settings, load, save }
}
