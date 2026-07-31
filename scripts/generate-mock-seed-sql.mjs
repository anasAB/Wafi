// Generates a single SQL file that seeds an IKEA-style mock catalog
// (products, expenses, customers, suppliers, stock receivings) into an
// existing shop, replicating the stock/cost side-effects that
// useReceivingSheet.confirm() performs in the app itself.
//
// Usage: node scripts/generate-mock-seed-sql.mjs > scripts/mock-data/seed-output.sql
// Then:  docker exec -i supabase_db_Wafi psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/mock-data/seed-output.sql

import { randomUUID } from 'node:crypto';
import { CATEGORIES, PRODUCTS, EXPENSES, CUSTOMERS, SUPPLIERS, RECEIVINGS } from './mock-data/ikea-mock-data.mjs';

const SHOP_ID = '00000000-0000-0000-0000-000000000001';
const CREATED_VIA = 'mock_data_seed';
const EXCHANGE_RATE = 14500; // SYP per USD, matches supabase/seed.sql

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNum(v) {
  return Number(v).toFixed(2);
}

const lines = [];
lines.push('-- Generated mock data seed. Idempotent per-run via a fixed marker check below.');
lines.push('BEGIN;');

// Guard: refuse to double-seed if this exact batch already ran.
lines.push(`DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE shop_id = ${sqlStr(SHOP_ID)} AND created_via = ${sqlStr(CREATED_VIA)}) THEN
    RAISE EXCEPTION 'Mock data already seeded for shop %. Delete existing created_via=% rows first if you want to reseed.', ${sqlStr(SHOP_ID)}, ${sqlStr(CREATED_VIA)};
  END IF;
END $$;`);

// Products
const productIds = PRODUCTS.map(() => randomUUID());
lines.push('\n-- Products');
lines.push('INSERT INTO products (id, shop_id, name_ar, name_en, price_usd, cost_price_usd, barcode, category, current_stock, low_stock_threshold, created_via, cost_updated_at) VALUES');
const productRows = PRODUCTS.map(([nameAr, nameEn, price, costRatio, category], i) => {
  const cost = Math.round(price * costRatio * 100) / 100;
  const barcode = `20260730${String(i + 1).padStart(5, '0')}`;
  return `  (${sqlStr(productIds[i])}, ${sqlStr(SHOP_ID)}, ${sqlStr(nameAr)}, ${sqlStr(nameEn)}, ${sqlNum(price)}, ${sqlNum(cost)}, ${sqlStr(barcode)}, ${sqlStr(category)}, 0, 5, ${sqlStr(CREATED_VIA)}, now())`;
});
lines.push(productRows.join(',\n') + ';');

// Expenses
lines.push('\n-- Expenses');
lines.push('INSERT INTO expenses (id, shop_id, amount, currency, amount_usd, category, expense_date, notes, paid_in_cash) VALUES');
const expenseRows = EXPENSES.map(([category, daysAgo, amount, currency, notes]) => {
  const amountUsd = currency === 'USD' ? amount : Math.round((amount / EXCHANGE_RATE) * 100) / 100;
  return `  (${sqlStr(randomUUID())}, ${sqlStr(SHOP_ID)}, ${sqlNum(amount)}, ${sqlStr(currency)}, ${sqlNum(amountUsd)}, ${sqlStr(category)}, (CURRENT_DATE - INTERVAL '${daysAgo} days')::date, ${sqlStr(notes)}, 1)`;
});
lines.push(expenseRows.join(',\n') + ';');

// Customers
lines.push('\n-- Customers');
lines.push('INSERT INTO customers (id, shop_id, name, phone, address) VALUES');
const customerRows = CUSTOMERS.map(([name, phone, address]) => {
  return `  (${sqlStr(randomUUID())}, ${sqlStr(SHOP_ID)}, ${sqlStr(name)}, ${sqlStr(phone)}, ${sqlStr(address)})`;
});
lines.push(customerRows.join(',\n') + ';');

// Suppliers
const supplierIds = SUPPLIERS.map(() => randomUUID());
lines.push('\n-- Suppliers');
lines.push('INSERT INTO suppliers (id, shop_id, name, phone, contact_person, address) VALUES');
const supplierRows = SUPPLIERS.map(([name, phone, contactPerson, address], i) => {
  return `  (${sqlStr(supplierIds[i])}, ${sqlStr(SHOP_ID)}, ${sqlStr(name)}, ${sqlStr(phone)}, ${sqlStr(contactPerson)}, ${sqlStr(address)})`;
});
lines.push(supplierRows.join(',\n') + ';');

// Stock receivings + line items + product side-effects (current_stock, cost_price_usd, cost_updated_at)
lines.push('\n-- Stock receivings');
for (const [supplierIdx, daysAgo, lineItems] of RECEIVINGS) {
  const receivingId = randomUUID();
  const supplierId = supplierIds[supplierIdx];
  let totalCost = 0;
  const lineValues = [];
  const stockUpdates = [];
  for (const [productIdx, qty, costMultiplier] of lineItems) {
    const [, , price, costRatio] = PRODUCTS[productIdx];
    const baseCost = Math.round(price * costRatio * 100) / 100;
    const unitCost = Math.round(baseCost * costMultiplier * 100) / 100;
    totalCost += unitCost * qty;
    const productId = productIds[productIdx];
    const costUpdated = costMultiplier !== 1.0 ? 1 : 0;
    lineValues.push(`  (${sqlStr(randomUUID())}, ${sqlStr(receivingId)}, ${sqlStr(SHOP_ID)}, ${sqlStr(productId)}, ${qty}, ${sqlNum(unitCost)}, ${costUpdated})`);
    stockUpdates.push(
      costUpdated
        ? `UPDATE products SET current_stock = current_stock + ${qty}, cost_price_usd = ${sqlNum(unitCost)}, cost_updated_at = now() WHERE id = ${sqlStr(productId)};`
        : `UPDATE products SET current_stock = current_stock + ${qty} WHERE id = ${sqlStr(productId)};`
    );
  }
  lines.push(`INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES (${sqlStr(receivingId)}, ${sqlStr(SHOP_ID)}, ${sqlStr(supplierId)}, (now() - INTERVAL '${daysAgo} days'), ${sqlNum(Math.round(totalCost * 100) / 100)}, ${EXCHANGE_RATE});`);
  lines.push('INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES');
  lines.push(lineValues.join(',\n') + ';');
  lines.push(...stockUpdates);
}

lines.push('\nCOMMIT;');
lines.push(`\n-- Summary counts (informational, run manually if desired):`);
lines.push(`-- SELECT count(*) FROM products WHERE shop_id='${SHOP_ID}' AND created_via='${CREATED_VIA}';`);

console.log(lines.join('\n'));
