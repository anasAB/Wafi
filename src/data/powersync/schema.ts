import { column, Schema, Table } from '@powersync/web'

const products = new Table({
  shop_id:             column.text,
  name_ar:             column.text,
  name_en:             column.text,
  price_usd:           column.real,
  cost_price_usd:      column.real,
  barcode:             column.text,
  category:            column.text,   // deprecated free-text; kept for rollback safety, no longer written to
  category_id:         column.text,
  subcategory_id:      column.text,
  photo_url:           column.text,
  current_stock:       column.integer,
  low_stock_threshold: column.integer,
  is_active:           column.integer,
  deleted:             column.integer,
  sync_status:         column.text,
  created_at:          column.text,
  updated_at:          column.text,
  cost_updated_at:     column.text,   // WAFI-013 — null until a real cost is set/confirmed
  created_via:         column.text,   // WAFI-101: 'quick_add' | 'open_item' | null
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
  sale_discount_type:       column.text,   // WAFI-100
  sale_discount_value:      column.real,   // WAFI-100
  sale_discount_amount_usd: column.real,   // WAFI-100
  sync_status:              column.text,
  source:                   column.text,   // WAFI-008: 'pos' | 'import' | 'seed'
})

const sale_line_items = new Table({
  sale_id:        column.text,
  shop_id:        column.text,
  product_id:     column.text,
  quantity:       column.integer,
  unit_price_usd: column.real,
  unit_cost_usd:  column.real,
  line_total_usd: column.real,
  discount_type:         column.text,   // WAFI-100
  discount_value:        column.real,   // WAFI-100
  discount_amount_usd:   column.real,   // WAFI-100
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
  shift_id:     column.text,   // WAFI-120: drawer attribution (nullable; legacy rows null)
  device_id:    column.text,
  sync_status:  column.text,
})

const customers = new Table({
  shop_id:          column.text,
  name:             column.text,
  phone:            column.text,
  mobile:           column.text,
  address:          column.text,
  deleted:          column.integer,
  created_at:       column.text,
  sync_status:      column.text,
  last_reminded_at: column.text,
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
  shift_id:                 column.text,   // WAFI-120: drawer attribution (nullable; legacy rows null)
  device_id:                column.text,
  sync_status:              column.text,
  due_id:                   column.text,   // tags a payment against a specific installment_dues row; null for the plan's down payment
})

const installment_plans = new Table({
  shop_id:          column.text,
  customer_id:      column.text,
  sale_id:          column.text,
  total_amount_usd: column.real,
  down_payment_usd: column.real,
  term_count:       column.integer,
  term_frequency:   column.text,   // 'weekly' | 'monthly'
  start_date:       column.text,   // YYYY-MM-DD
  status:           column.text,   // 'active' | 'completed' | 'defaulted' | 'cancelled'
  created_at:       column.text,
  created_by:       column.text,
  sync_status:      column.text,
})

const installment_dues = new Table({
  plan_id:         column.text,
  shop_id:         column.text,
  due_date:        column.text,   // YYYY-MM-DD
  amount_due_usd:  column.real,
  amount_paid_usd: column.real,
  status:          column.text,   // 'pending' | 'paid' | 'voided'
  sync_status:     column.text,
})

const staff_settlements = new Table({
  shop_id:              column.text,
  staff_id:            column.text,
  settlement_number:   column.text,
  period_month:        column.text,   // YYYY-MM-DD
  status:              column.text,   // 'draft' | 'finalized' | 'paid'
  base_salary_usd:     column.real,
  settlement_currency: column.text,   // 'usd' | 'syp'
  locked_rate:         column.real,
  applied_amount_usd:  column.real,
  final_amount_usd:    column.real,
  notes:               column.text,
  staff_name_snapshot: column.text,
  staff_role_snapshot: column.text,
  finalized_at:        column.text,
  paid_at:             column.text,
  paid_by_staff_id:    column.text,
  payment_method:      column.text,   // 'cash' | 'bank' | 'other'
  client_operation_id: column.text,
  created_at:          column.text,
  sync_status:         column.text,
})

const staff_ledger = new Table({
  shop_id:            column.text,
  staff_id:           column.text,
  entry_type:         column.text,   // 'advance' | 'bonus' | 'penalty' | 'carry_forward' | 'write_off' | 'correction'
  amount_usd:         column.real,
  currency_entered:   column.text,   // 'usd' | 'syp'
  locked_rate:        column.real,
  note:               column.text,
  source_type:        column.text,   // 'manual' | 'shift' | 'settlement'
  source_id:          column.text,
  created_by_staff_id: column.text,
  client_operation_id: column.text,
  settlement_id:      column.text,
  created_at:         column.text,
  sync_status:        column.text,
})

const receipt_settings = new Table({
  shop_id:     column.text,
  shop_name:   column.text,
  tax_number:  column.text,
  header_text: column.text,
  footer_text: column.text,
  show_whatsapp_receipt: column.integer,
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
  // WAFI-103: JSON {"500":2,...} when counted by denomination; null = manual total entry.
  opening_breakdown: column.text,
  closing_breakdown: column.text,
})

const denomination_configs = new Table({
  shop_id:     column.text,
  currency:    column.text,   // 'USD' | 'SYP'
  value:       column.real,
  sort_order:  column.integer,
  deleted:     column.integer,
  created_at:  column.text,
  sync_status: column.text,
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

const devices = new Table({
  shop_id:       column.text,
  code:          column.text,
  is_temporary:  column.integer,
  registered_at: column.text,
  label:         column.text,     // WAFI-130: owner-set human name ("كاشير ١")
  last_seen_at:  column.text,     // WAFI-130: stale-device pruning signal
  is_active:     column.integer,  // WAFI-130: deactivation (null/1 = active)
  sync_status:   column.text,
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

// WAFI-140 Sprint 2 — at-most-once guard for subscriber re-processing (design spec §3).
// Local-only: single-device replay protection only, not cross-device dedup (see spec §3).
const local_event_processed_ledger = new Table({
  subscriber_id: column.text,
  event_id:      column.text,
  processed_at:  column.text,
}, { localOnly: true })

// WAFI-140 Sprint 2 — publish-failure retry queue (design spec §4).
const local_event_publish_retries = new Table({
  serialized_event: column.text,  // JSON.stringify(DomainEvent) -- see design spec §4 for why
                                   // this duplicates events' own columns rather than referencing them
  failure_kind:     column.text,  // 'transient' | 'permanent'
  attempts:         column.integer,
  last_error:       column.text,
  next_retry_at:    column.text,  // ISO string
  created_at:       column.text,  // ISO string
}, { localOnly: true })

// WAFI-150 -- retry state for durable subscribers (mirrors local_event_publish_retries'
// shape almost exactly, on the consumption side). subscriber_name distinguishes rows
// when more than one durable subscriber exists in the future -- they share one table
// rather than one-table-per-subscriber.
const local_event_processing_retries = new Table({
  subscriber_name:   column.text,
  serialized_event:  column.text,  // JSON.stringify(DomainEvent) -- same convention as
                                    // local_event_publish_retries.serialized_event
  failure_kind:      column.text,  // 'transient' | 'permanent'
  attempts:          column.integer,
  last_error:        column.text,
  next_retry_at:     column.text,  // ISO string
  created_at:        column.text,  // ISO string
}, { localOnly: true })

// WAFI-150 -- durable-subscriber processed ledger. Deliberately a SEPARATE table from
// local_event_processed_ledger (the lightweight/best-effort ledger, WAFI-140 Sprint 2):
// that ledger writes BEFORE running its action (at-most-once, explicitly unsuitable for
// durable writes per its own docstring); this one writes ONLY AFTER the handler
// succeeds. Sharing one table with a mode column would force every future reader to
// branch on lifecycle semantics throughout the framework -- two small tables are
// clearer than one table with two contracts. Named for what it belongs to (the durable
// subscriber framework), not for the abstract property "durable".
const local_subscriber_processed_events = new Table({
  subscriber_name: column.text,
  event_id:        column.text,
  processed_at:    column.text,  // ISO string
}, { localOnly: true })

const events = new Table({
  type:            column.text,
  entity_id:       column.text,
  payload:         column.text,   // JSON.stringify'd — same convention as audit_log's `meta`
  payload_version: column.integer,
  staff_id:        column.text,
  shop_id:         column.text,
  occurred_at:     column.text,
  created_at:      column.text,
})

const daily_event_counts = new Table({
  shop_id:          column.text,
  event_type:       column.text,
  day:              column.text,
  count:            column.integer,
  source_event_id:  column.text,
})

const audit_log = new Table({
  shop_id:          column.text,
  staff_id:         column.text,
  staff_name:       column.text,
  event:            column.text,
  entity_type:      column.text,
  entity_id:        column.text,
  meta:             column.text,
  created_at:       column.text,
  source_event_id:  column.text,  // WAFI-150 -- nullable; ties an audit row back to
                                   // its originating events.id for idempotent retry
})

// WAFI-143 -- disposable, rebuildable read model (design spec, "Dashboard consumer").
// Never a source of truth for anything financial; may drift under event loss and
// self-corrects on the next full resync. (shop_id, date) is a LOGICAL key only --
// PowerSync's Table DSL has no composite-primary-key support, and this table's implicit
// `id` is the real primary key, same as daily_event_counts. The projection subscriber
// enforces uniqueness itself via read-then-insert-or-update, not a DB constraint.
const local_today_revenue_projection = new Table({
  shop_id:      column.text,
  date:         column.text,   // YYYY-MM-DD
  revenue_usd:  column.real,
  revenue_syp:  column.real,
  updated_at:   column.text,   // ISO string
}, { localOnly: true })

// WAFI-143 -- durable business facts produced by notificationSubscriber.ts (design spec,
// "Notification consumer"). Synced (unlike the projection above): the owner must see
// this on every device, not just the one that generated it.
const notifications = new Table({
  shop_id:             column.text,
  recipient_staff_id:  column.text,
  recipient_role:      column.text,
  type:                column.text,
  title:               column.text,
  message:             column.text,
  entity_type:         column.text,
  entity_id:           column.text,
  severity:            column.text,
  source_event_id:     column.text,
  created_at:          column.text,
  read_at:             column.text,
  acknowledged_at:     column.text,   // WAFI-145: CRITICAL rows require this, distinct from read_at
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

const stock_take_sessions = new Table({
  shop_id:      column.text,
  started_at:   column.text,
  completed_at: column.text,
  status:       column.text,   // 'in_progress' | 'completed' | 'cancelled'
  created_by:   column.text,
  scope:        column.text,   // human-readable scope name snapshot (WAFI-134)
  scope_category_id:    column.text, // real categories scoping (WAFI-134)
  scope_subcategory_id: column.text,
  sync_status:  column.text,
})

const stock_take_lines = new Table({
  session_id:         column.text,
  shop_id:            column.text,
  product_id:         column.text,
  expected_stock:     column.integer,
  counted_stock:      column.integer,
  variance:           column.integer,
  variance_value_usd: column.real,
  sync_status:        column.text,
})

const categories = new Table({
  shop_id:     column.text,
  name:        column.text,
  created_at:  column.text,
  sync_status: column.text,
})

const subcategories = new Table({
  category_id: column.text,
  shop_id:     column.text,
  name:        column.text,
  created_at:  column.text,
  sync_status: column.text,
})

const shops = new Table({
  owner_user_id:               column.text,
  name:                        column.text,
  business_type:               column.text,
  country:                     column.text,
  created_at:                  column.text,
  features:                    column.text,   // WAFI-131: per-shop pack flags (JSON, server-set)
  cashier_discount_cap_pct:    column.real,   // WAFI-100
  manager_discount_cap_pct:    column.real,   // WAFI-100
  open_time:                   column.text,    // WAFI-145: 'HH:MM', NULL = no operating-hours checks
  close_time:                  column.text,    // WAFI-145
  is_24_7:                     column.integer, // WAFI-145: 0/1
})

const notification_settings = new Table({
  shop_id:        column.text,
  type:           column.text,
  enabled:        column.integer,  // 0/1
  threshold_json: column.text,     // JSON-encoded NotificationTypeSettings, see notificationSettings.ts
  updated_at:     column.text,
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
  devices,
  returns,
  return_line_items,
  return_reasons,
  sync_dead_letter,
  local_event_processed_ledger,
  local_event_publish_retries,
  local_event_processing_retries,
  local_subscriber_processed_events,
  audit_log,
  events,
  daily_event_counts,
  local_today_revenue_projection,
  notifications,
  notification_settings,
  suppliers,
  stock_receivings,
  stock_receiving_line_items,
  stock_take_sessions,
  stock_take_lines,
  installment_plans,
  installment_dues,
  staff_settlements,
  staff_ledger,
  categories,
  subcategories,
  shops,
  denomination_configs,
})
