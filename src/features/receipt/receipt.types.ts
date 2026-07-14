export interface ReceiptSettings {
  shopName:   string
  taxNumber:  string
  headerText: string
  footerText: string
  showWhatsAppReceipt: boolean
}

export interface ReceiptSettingsRow {
  id:          string
  shop_id:     string
  shop_name:   string
  tax_number:  string
  header_text: string
  footer_text: string
  show_whatsapp_receipt: number | boolean | null
  updated_at:  string
  sync_status: string
}
