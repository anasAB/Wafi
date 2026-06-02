import { column, Schema, Table } from '@powersync/web'

const products = new Table({
  shop_id:             column.text,
  name_ar:             column.text,
  name_en:             column.text,
  price_usd:           column.real,
  cost_price_usd:      column.real,
  barcode:             column.text,
  category:            column.text,
  photo_url:           column.text,
  current_stock:       column.integer,
  low_stock_threshold: column.integer,
  is_active:           column.integer,
  deleted:             column.integer,
  sync_status:         column.text,
  created_at:          column.text,
  updated_at:          column.text,
})

const stock_adjustments = new Table({
  shop_id:    column.text,
  product_id: column.text,
  old_value:  column.integer,
  new_value:  column.integer,
  reason:     column.text,
  notes:      column.text,
  created_at: column.text,
  device_id:  column.text,
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
  customer_id:              column.text,   // nullable — set for credit sales
  is_credit:                column.integer, // 0/1, default 0
})

const sale_line_items = new Table({
  sale_id:        column.text,
  shop_id:        column.text,
  product_id:     column.text,
  quantity:       column.integer,
  unit_price_usd: column.real,
  unit_cost_usd:  column.real,
  line_total_usd: column.real,
})

const exchange_rates = new Table({
  shop_id:   column.text,
  device_id: column.text,
  rate:      column.real,
  set_at:    column.text,
  set_by:    column.text,
})

const expenses = new Table({
  shop_id:      column.text,
  amount:       column.real,
  currency:     column.text,
  amount_usd:   column.real,
  category:     column.text,
  expense_date: column.text,
  notes:        column.text,
  photo_url:    column.text,
  paid_in_cash: column.integer,
  created_at:   column.text,
  sync_status:  column.text,
})

const customers = new Table({
  shop_id:     column.text,
  name:        column.text,
  phone:       column.text,
  mobile:      column.text,
  address:     column.text,
  deleted:     column.integer,
  created_at:  column.text,
  sync_status: column.text,
})

const customer_payments = new Table({
  shop_id:                  column.text,
  customer_id:              column.text,
  sale_id:                  column.text,
  amount_usd:               column.real,
  currency:                 column.text,
  amount_raw:               column.real,
  exchange_rate_at_payment: column.real,
  notes:                    column.text,
  paid_at:                  column.text,
  created_at:               column.text,
  sync_status:              column.text,
})

export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
  customers,
  customer_payments,
})
