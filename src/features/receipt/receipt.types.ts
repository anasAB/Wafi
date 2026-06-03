export interface ReceiptSettings {
  shopName:   string
  taxNumber:  string
  headerText: string
  footerText: string
}

export interface ReceiptSettingsRow {
  id:          string
  shop_id:     string
  shop_name:   string
  tax_number:  string
  header_text: string
  footer_text: string
  updated_at:  string
  sync_status: string
}
