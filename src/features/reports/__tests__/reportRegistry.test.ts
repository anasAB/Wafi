import { describe, it, expect } from 'vitest'
import { REPORT_DEFINITIONS } from '../reportRegistry'
import type { ReportId } from '../report.types'

const EXPECTED_IDS: ReportId[] = [
  'daily-closing', 'cash-flow', 'weekly-summary', 'profit-trend', 'employee-summary',
  'discount-report', 'returns-report', 'credit-report', 'top-customers', 'top-products',
  'inventory-health', 'dead-stock', 'monthly-health',
]

describe('REPORT_DEFINITIONS', () => {
  it('is empty until report definitions are registered in later tasks', () => {
    expect(Object.keys(REPORT_DEFINITIONS)).toHaveLength(0)
  })
})

describe('ReportId', () => {
  it('documents all 13 report ids as a compile-time check', () => {
    // This test exists to fail to compile (not to fail at runtime) if a future
    // edit removes a ReportId member -- assigning the full expected list to a
    // ReportId[]-typed const is the check.
    expect(EXPECTED_IDS).toHaveLength(13)
  })
})
