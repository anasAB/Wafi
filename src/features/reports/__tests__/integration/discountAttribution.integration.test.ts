import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

describe('discount-by-product attribution integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('sums sale_line_items.discount_amount_usd per product, ranked descending -- the exact query shape Task 11/15 both use', async () => {
    conn.exec(`
      INSERT INTO products (id, shop_id, name_ar) VALUES ('p1', 'shop1', 'قلم'), ('p2', 'shop1', 'دفتر');
      INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-18T10:00:00');
      INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, discount_amount_usd) VALUES
        ('li1', 's1', 'shop1', 'p1', 1, 10, 5),
        ('li2', 's1', 'shop1', 'p2', 1, 20, 2),
        ('li3', 's1', 'shop1', 'p1', 1, 10, 0);
    `)
    const rows = conn.prepare(
      `SELECT sli.product_id AS productId, p.name_ar AS nameAr, SUM(COALESCE(sli.discount_amount_usd, 0)) AS discountUsd
       FROM sale_line_items sli JOIN products p ON p.id = sli.product_id JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND sli.discount_amount_usd > 0 AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id, p.name_ar ORDER BY discountUsd DESC`,
    ).all('shop1', '2026-08-18', '2026-08-18') as { productId: string; nameAr: string; discountUsd: number }[]

    expect(rows).toHaveLength(2) // p2's zero-discount third line correctly excluded by the > 0 filter
    expect(rows[0]).toMatchObject({ productId: 'p1', discountUsd: 5 })
    expect(rows[1]).toMatchObject({ productId: 'p2', discountUsd: 2 })
  })

  // Task 0 P0 finding 10: an earlier draft of this task claimed coverage for
  // returns-by-product but only actually exercised discount-by-product --
  // the two are separate query shapes (different tables, different join
  // path) and both need real coverage.
  it('sums return_line_items.qty_returned per product (Task 12/15\'s "units returned" query shape), not return-transaction count', async () => {
    conn.exec(`
      INSERT INTO products (id, shop_id, name_ar) VALUES ('p1', 'shop1', 'قلم');
      INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-10T10:00:00');
      INSERT INTO returns (id, shop_id, original_sale_id, created_at) VALUES
        ('r1', 'shop1', 's1', '2026-08-18T10:00:00'), ('r2', 'shop1', 's1', '2026-08-18T11:00:00');
      INSERT INTO return_line_items (id, return_id, product_id, qty_returned, unit_price_usd) VALUES
        ('rli1', 'r1', 'p1', 3, 10), ('rli2', 'r2', 'p1', 2, 10);
    `)
    const rows = conn.prepare(
      `SELECT rli.product_id AS productId, p.name_ar AS nameAr, SUM(rli.qty_returned) AS value
       FROM return_line_items rli JOIN products p ON p.id = rli.product_id JOIN returns r ON r.id = rli.return_id
       WHERE r.shop_id = ? AND DATE(r.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY rli.product_id, p.name_ar ORDER BY value DESC`,
    ).all('shop1', '2026-08-18', '2026-08-18') as { productId: string; value: number }[]

    // 2 return transactions, 5 total units -- proves SUM(qty_returned), not
    // COUNT(*), is what's actually being tested (the bug this finding exists
    // to catch would silently pass a COUNT(*)-based assertion of 2).
    expect(rows[0]).toMatchObject({ productId: 'p1', value: 5 })
  })
})

describe('top-N ranking integration (LIMIT 20 with >20 candidate rows)', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('returns exactly 20 rows, ranked descending, when 25 products have sales -- proves LIMIT truncates correctly, not just that ORDER BY works on a small set', async () => {
    conn.exec(`INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-18T10:00:00')`)
    for (let i = 0; i < 25; i++) {
      conn.exec(
        `INSERT INTO products (id, shop_id, name_ar) VALUES ('p${i}', 'shop1', 'p${i}');
         INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
         VALUES ('li${i}', 's1', 'shop1', 'p${i}', 1, ${i}, ${i})`,
      )
    }
    const rows = conn.prepare(
      `SELECT sli.product_id AS productId, SUM(sli.line_total_usd) AS value
       FROM sale_line_items sli JOIN sales s ON s.id = sli.sale_id
       WHERE sli.shop_id = ? AND DATE(s.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY sli.product_id ORDER BY value DESC LIMIT 20`,
    ).all('shop1', '2026-08-18', '2026-08-18') as { productId: string; value: number }[]

    expect(rows).toHaveLength(20) // not 25 -- LIMIT actually truncates
    expect(rows[0]).toMatchObject({ productId: 'p24', value: 24 }) // highest value first
    expect(rows[19]).toMatchObject({ productId: 'p5', value: 5 }) // the 20th-highest, not an arbitrary row
  })
})
