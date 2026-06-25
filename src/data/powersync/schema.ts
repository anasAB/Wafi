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
  is_split:                 column.integer, // 0/1, default 0
  shift_id:                 column.text,   // FK → cashier_shifts.id, nullable
  staff_id:                 column.text,   // operator who completed the sale (nullable)
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
  method:                   column.text,   // 'cash' | 'transfer' | 'usdt' | 'hawala' — only cash hits the drawer
  exchange_rate_at_payment: column.real,
  notes:                    column.text,
  paid_at:                  column.text,
  created_at:               column.text,
  sync_status:              column.text,
})

const receipt_settings = new Table({
  shop_id:     column.text,
  shop_name:   column.text,
  tax_number:  column.text,
  header_text: column.text,
  footer_text: column.text,
  updated_at:  column.text,
  sync_status: column.text,
})

const sale_payments = new Table({
  sale_id:       column.text,
  shop_id:       column.text,
  method:        column.text,   // 'cash_usd' | 'cash_syp' | 'card'
  amount_raw:    column.real,   // amount as entered in native currency
  currency:      column.text,   // 'USD' | 'SYP'
  amount_usd:    column.real,   // converted to USD
  exchange_rate: column.real,
  change_due:    column.real,   // nullable — only last entry when overpaid
  created_at:    column.text,
})

const staff = new Table({
  shop_id:        column.text,
  name:           column.text,
  pin_hash:       column.text,
  pin_salt:       column.text,     // per-staff salt (hex); null = legacy unsalted hash
  role:           column.text,     // 'owner' | 'cashier' | 'manager'
  permissions:    column.text,     // JSON blob
  is_active:      column.integer,
  created_at:     column.text,
  recovery_codes: column.text,     // JSON array: [{hash,salt,usedAt}]
})

const cashier_shifts = new Table({
  shop_id:          column.text,
  device_id:        column.text,
  staff_id:         column.text,
  opened_at:        column.text,
  closed_at:        column.text,    // nullable
  opening_cash_usd: column.real,
  opening_cash_syp: column.real,    // WAFI-059: opening cash in SYP (primary currency)
  closing_cash_usd: column.real,    // nullable
  closing_cash_syp: column.real,    // nullable
  // WAFI-060: immutable close evidence. variance_* are persisted (not recomputed);
  // z_report_data holds the JSON snapshot of the Z-report as it was at close.
  variance_usd:     column.real,    // nullable — set at close
  variance_syp:     column.real,    // nullable — set at close
  close_note:       column.text,    // nullable — required when |variance| > 5%
  force_closed_by:  column.text,    // nullable — staff id, WAFI-065 force-close
  z_report_data:    column.text,    // nullable — JSON snapshot of ZReportMetrics
  status:           column.text,    // 'open' | 'closed'
})

const cash_movements = new Table({
  shop_id:            column.text,
  device_id:          column.text,
  shift_id:           column.text,
  staff_id:           column.text,
  direction:          column.text,   // 'in' | 'out'
  category:           column.text,
  currency:           column.text,   // 'USD' | 'SYP'
  amount:             column.real,   // raw in `currency`; integer when SYP
  note:               column.text,
  voids_movement_id:  column.text,   // set on a reversing (void) row
  created_at:         column.text,
})

const returns = new Table({
  shop_id:                 column.text,
  original_sale_id:        column.text,
  created_at:              column.text,
  refund_method:           column.text,   // 'cash_usd' | 'cash_syp' | 'store_credit' | 'transfer'
  refund_amount_usd:       column.real,
  refund_amount_syp:       column.real,
  exchange_rate_at_return: column.real,
  reason:                  column.text,   // nullable snapshot of reason label
  notes:                   column.text,   // nullable free text
  shift_id:                column.text,   // nullable FK → cashier_shifts.id
  sync_status:             column.text,
})

const return_line_items = new Table({
  return_id:      column.text,
  shop_id:        column.text,
  product_id:     column.text,
  qty_returned:   column.integer,
  unit_price_usd: column.real,
  unit_price_syp: column.real,
  restock:        column.integer,  // 0 | 1
  sync_status:    column.text,
})

const return_reasons = new Table({
  shop_id:    column.text,
  label:      column.text,
  sort_order: column.integer,
  is_active:  column.integer,  // 0 | 1
})

// Local-only holding for upload ops the server permanently rejected (constraint
// / RLS / 4xx). NOT synced (localOnly) — it must never generate its own CRUD ops
// or it would re-enter the very queue it exists to unblock. The connector moves
// a poison op here so the rest of the queue can drain; the owner retries or
// discards it from the sync panel. See connector.ts / dead-letter.ts (WAFI-015).
const sync_dead_letter = new Table({
  client_id:     column.integer, // ps_crud op id at quarantine — dedupes re-quarantine
  op_type:       column.text,    // 'PUT' | 'PATCH' | 'DELETE'
  table_name:    column.text,
  row_id:        column.text,
  op_data:       column.text,    // JSON of the op payload (null for DELETE)
  error_code:    column.text,    // PostgrestError.code at the last failed attempt
  error_message: column.text,
  failed_at:     column.text,    // ISO timestamp of the last failed attempt
}, { localOnly: true })

const audit_log = new Table({
  shop_id:     column.text,
  staff_id:    column.text,
  staff_name:  column.text,
  event:       column.text,
  entity_type: column.text,
  entity_id:   column.text,
  meta:        column.text,
  created_at:  column.text,
})

const suppliers = new Table({
  shop_id:        column.text,
  name:           column.text,
  phone:          column.text,
  contact_person: column.text,
  address:        column.text,
  notes:          column.text,
  deleted:        column.integer,
  created_at:     column.text,
  sync_status:    column.text,
})

const stock_receivings = new Table({
  shop_id:                    column.text,
  supplier_id:                column.text,
  received_at:                column.text,
  invoice_photo_url:          column.text,
  total_cost_usd:             column.real,
  exchange_rate_at_receiving: column.real,
  notes:                      column.text,
  staff_id:                   column.text,
  sync_status:                column.text,
})

const stock_receiving_line_items = new Table({
  receiving_id:  column.text,
  shop_id:       column.text,
  product_id:    column.text,
  qty_received:  column.integer,
  unit_cost_usd: column.real,
  cost_updated:  column.integer,
  sync_status:   column.text,
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
  receipt_settings,
  sale_payments,
  staff,
  cashier_shifts,
  cash_movements,
  returns,
  return_line_items,
  return_reasons,
  sync_dead_letter,
  audit_log,
  suppliers,
  stock_receivings,
  stock_receiving_line_items,
})
