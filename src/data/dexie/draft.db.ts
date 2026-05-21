import Dexie, { type Table } from 'dexie'

export interface DraftLineItem {
  product_id:     string
  name_ar:        string
  quantity:       number
  unit_price_usd: number
}

export interface SaleDraft {
  id:                   string   // device_id — one active draft per device
  device_id:            string
  shop_id:              string
  line_items:           DraftLineItem[]
  locked_exchange_rate: number   // captured on first addLine(); required for correct restore
  updated_at:           number   // Unix ms; used for 24h purge
}

class DraftDatabase extends Dexie {
  drafts!: Table<SaleDraft, string>

  constructor() {
    super('wafi_drafts')
    this.version(1).stores({
      drafts: 'id, device_id, updated_at',
    })
  }
}

export const draftDb = new DraftDatabase()
