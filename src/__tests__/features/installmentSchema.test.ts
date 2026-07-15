// src/__tests__/features/installmentSchema.test.ts
import { describe, it, expect } from 'vitest'
import { AppSchema } from '@/data/powersync/schema'

describe('AppSchema — installment tables', () => {
  it('registers installment_plans with the expected columns', () => {
    const table = AppSchema.tables.find(t => t.name === 'installment_plans')
    expect(table).toBeTruthy()
    const cols = table!.columns.map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining([
      'shop_id', 'customer_id', 'sale_id', 'total_amount_usd', 'down_payment_usd',
      'term_count', 'term_frequency', 'start_date', 'status', 'created_at', 'created_by', 'sync_status',
    ]))
  })

  it('registers installment_dues with the expected columns', () => {
    const table = AppSchema.tables.find(t => t.name === 'installment_dues')
    expect(table).toBeTruthy()
    const cols = table!.columns.map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining([
      'plan_id', 'shop_id', 'due_date', 'amount_due_usd', 'amount_paid_usd', 'status', 'sync_status',
    ]))
  })

  it('adds due_id to customer_payments', () => {
    const table = AppSchema.tables.find(t => t.name === 'customer_payments')
    const cols = table!.columns.map(c => c.name)
    expect(cols).toContain('due_id')
  })
})
