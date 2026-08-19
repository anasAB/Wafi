// src/features/reports/__tests__/helpers/reportsSqliteDb.ts
// WAFI-147A: a real SQLite database (Node's built-in node:sqlite), for
// integration-testing the shared primitives and high-risk report queries
// against real SQL semantics -- date boundaries, joins, aggregation -- which
// db-mocking (used by every report definition's own unit test) cannot
// validate. Unlike src/__tests__/helpers/realSqliteDb.ts (built for a
// PowerSync localOnly table's JSON-blob view), these are ordinary synced
// tables, so plain CREATE TABLE statements matching schema.ts's columns
// suffice -- no view/trigger machinery needed.
import { DatabaseSync } from 'node:sqlite'

export function createReportsTestDb(path = ':memory:') {
  const conn = new DatabaseSync(path)
  conn.exec(`
    CREATE TABLE sales (
      id TEXT PRIMARY KEY, shop_id TEXT, staff_id TEXT, customer_id TEXT,
      total_usd REAL, created_at TEXT, is_credit INTEGER, payment_method TEXT,
      sale_discount_amount_usd REAL DEFAULT 0
    );
    CREATE TABLE sale_line_items (
      id TEXT PRIMARY KEY, sale_id TEXT, shop_id TEXT, product_id TEXT,
      quantity INTEGER, unit_price_usd REAL, unit_cost_usd REAL, line_total_usd REAL,
      discount_amount_usd REAL DEFAULT 0
    );
    CREATE TABLE returns (
      id TEXT PRIMARY KEY, shop_id TEXT, original_sale_id TEXT, created_at TEXT,
      refund_amount_usd REAL, shift_id TEXT, refund_method TEXT, reason TEXT
    );
    CREATE TABLE return_line_items (
      id TEXT PRIMARY KEY, return_id TEXT, product_id TEXT, qty_returned INTEGER,
      unit_price_usd REAL, restock INTEGER
    );
    CREATE TABLE customer_payments (
      id TEXT PRIMARY KEY, shop_id TEXT, customer_id TEXT, sale_id TEXT,
      amount_usd REAL, paid_at TEXT, created_at TEXT
    );
    CREATE TABLE customers (id TEXT PRIMARY KEY, shop_id TEXT, name TEXT, deleted INTEGER DEFAULT 0, created_at TEXT);
    CREATE TABLE staff (id TEXT PRIMARY KEY, shop_id TEXT, name TEXT);
    CREATE TABLE cashier_shifts (
      id TEXT PRIMARY KEY, shop_id TEXT, staff_id TEXT, status TEXT,
      opened_at TEXT, closed_at TEXT, opening_cash_usd REAL, closing_cash_usd REAL, variance_usd REAL,
      z_report_data TEXT
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY, shop_id TEXT, name_ar TEXT, current_stock INTEGER,
      cost_price_usd REAL, low_stock_threshold INTEGER, created_at TEXT, deleted INTEGER DEFAULT 0
    );
    CREATE TABLE profit_cache (
      shop_id TEXT, day TEXT, revenue_usd INTEGER, revenue_syp INTEGER, cogs_usd INTEGER,
      cogs_reversal_usd INTEGER, expenses_usd INTEGER, refunds_usd INTEGER, discount_usd INTEGER,
      invoice_count INTEGER, return_count INTEGER, costless_sale_count INTEGER
    );
  `)
  return conn
}
