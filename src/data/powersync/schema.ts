import { column, Schema, Table } from '@powersync/web'

const products = new Table({
  shop_id:   column.text,
  name_ar:   column.text,
  name_en:   column.text,
  price_usd: column.real,
  barcode:   column.text,
  photo_url: column.text,
  is_active: column.integer,
})

const sales = new Table({
  shop_id:                  column.text,
  device_id:                column.text,
  device_sequence:          column.integer,
  display_sale_number:      column.text,
  created_at:               column.text,
  total_usd:                column.real,
  total_syp:                column.real,
  exchange_rate_at_sale:    column.real,
  payment_method:           column.text,
  amount_received:          column.real,
  amount_received_currency: column.text,
  change_due:               column.real,
})

const sale_line_items = new Table({
  sale_id:        column.text,
  shop_id:        column.text,
  product_id:     column.text,
  quantity:       column.integer,
  unit_price_usd: column.real,
  line_total_usd: column.real,
})

const exchange_rates = new Table({
  shop_id:   column.text,
  device_id: column.text,
  rate:      column.real,
  set_at:    column.text,
  set_by:    column.text,
})

export const AppSchema = new Schema({
  products,
  sales,
  sale_line_items,
  exchange_rates,
})
