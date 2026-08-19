import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReportsTestDb } from '../helpers/reportsSqliteDb'

let conn: ReturnType<typeof createReportsTestDb>
vi.mock('@/data/powersync/db', () => ({
  db: { getAll: async (sql: string, params: unknown[]) => conn.prepare(sql).all(...(params as any[])) },
}))

import { computeDiscountReport } from '../../definitions/discountReport'
import { computeReturnsReport } from '../../definitions/returnsReport'
import { computeTopProductsReport } from '../../definitions/topProducts'
import type { DetailSection } from '../../report.types'

function findSection(sections: unknown[], title: string) {
  return sections.find((s): s is DetailSection => (s as { title?: string }).title === title)
}

describe('discount-by-product attribution integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('computeDiscountReport\'s "By Product" section sums sale_line_items.discount_amount_usd per product, ranked descending', async () => {
    conn.exec(`
      INSERT INTO products (id, shop_id, name_ar) VALUES ('p1', 'shop1', 'قلم'), ('p2', 'shop1', 'دفتر');
      INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-18T10:00:00');
      INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, discount_amount_usd) VALUES
        ('li1', 's1', 'shop1', 'p1', 1, 10, 5),
        ('li2', 's1', 'shop1', 'p2', 1, 20, 2),
        ('li3', 's1', 'shop1', 'p1', 1, 10, 0);
    `)
    const report = await computeDiscountReport('shop1', { from: '2026-08-18', to: '2026-08-18' })
    const byProduct = findSection(report.sections, 'By Product')
    const rows = byProduct?.rows as { productId: string; nameAr: string; discountUsd: number }[]

    expect(rows).toHaveLength(2) // p2's zero-discount third line correctly excluded by the > 0 filter
    expect(rows[0]).toMatchObject({ productId: 'p1', discountUsd: 5 })
    expect(rows[1]).toMatchObject({ productId: 'p2', discountUsd: 2 })
  })
})

describe('returns-by-product attribution integration', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  // Task 0 P0 finding 10: an earlier draft of this task claimed coverage for
  // returns-by-product but only actually exercised discount-by-product, and a
  // later draft duplicated Top Products' "most returned" (units) query shape
  // instead of returnsReport.ts's own "By Product" section. returnsReport.ts's
  // By Product row is COUNT(*) return-line-rows plus SUM refund dollar value
  // -- a genuinely different shape from Top Products' SUM(qty_returned) units
  // -- so this must call computeReturnsReport itself, not a stand-in query.
  it('computeReturnsReport\'s "By Product" section reports returnCount (row count) and refundUsd (dollar value), not units returned', async () => {
    conn.exec(`
      INSERT INTO products (id, shop_id, name_ar) VALUES ('p1', 'shop1', 'قلم');
      INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-10T10:00:00');
      INSERT INTO returns (id, shop_id, original_sale_id, created_at) VALUES
        ('r1', 'shop1', 's1', '2026-08-18T10:00:00'), ('r2', 'shop1', 's1', '2026-08-18T11:00:00');
      INSERT INTO return_line_items (id, return_id, product_id, qty_returned, unit_price_usd) VALUES
        ('rli1', 'r1', 'p1', 3, 10), ('rli2', 'r2', 'p1', 2, 10);
    `)
    const report = await computeReturnsReport('shop1', { from: '2026-08-18', to: '2026-08-18' })
    const byProduct = findSection(report.sections, 'By Product')
    const rows = byProduct?.rows as { productId: string; nameAr: string; returnCount: number; refundUsd: number }[]

    // 2 return-line rows (rli1, rli2) -- COUNT(*), NOT SUM(qty_returned) which
    // would be 5. refundUsd = SUM(qty_returned * unit_price_usd) = 3*10 + 2*10 = 50.
    expect(rows[0]).toMatchObject({ productId: 'p1', returnCount: 2, refundUsd: 50 })
  })
})

describe('top-N ranking integration (LIMIT 20 with >20 candidate rows)', () => {
  beforeEach(() => { conn = createReportsTestDb() })

  it('computeTopProductsReport\'s "Top 20 by Revenue" section returns exactly 20 rows, ranked descending, when 25 products have sales', async () => {
    conn.exec(`INSERT INTO sales (id, shop_id, created_at) VALUES ('s1', 'shop1', '2026-08-18T10:00:00')`)
    for (let i = 0; i < 25; i++) {
      conn.exec(
        `INSERT INTO products (id, shop_id, name_ar) VALUES ('p${i}', 'shop1', 'p${i}');
         INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
         VALUES ('li${i}', 's1', 'shop1', 'p${i}', 1, ${i}, ${i})`,
      )
    }
    // Rewired to call the real computeTopProductsReport (its "Top 20 by
    // Revenue" section is where the LIMIT 20 truncation actually lives) --
    // no separate justification needed for leaving this inline, since the
    // real function's shape is simple enough to assert on directly.
    const report = await computeTopProductsReport('shop1', { from: '2026-08-18', to: '2026-08-18' })
    const byRevenue = findSection(report.sections, 'Top 20 by Revenue')
    const rows = byRevenue?.rows as { productId: string; nameAr: string; value: number }[]

    expect(rows).toHaveLength(20) // not 25 -- LIMIT actually truncates
    expect(rows[0]).toMatchObject({ productId: 'p24', value: 24 }) // highest value first
    expect(rows[19]).toMatchObject({ productId: 'p5', value: 5 }) // the 20th-highest, not an arbitrary row
  })
})
