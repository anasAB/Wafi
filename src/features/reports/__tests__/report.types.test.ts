import { describe, it, expect } from 'vitest'
import { detailSection, summarySection } from '../report.types'

interface FakeRow { id: string; label: string; total: number }

describe('summarySection', () => {
  it('builds a well-shaped summary section', () => {
    const s = summarySection({ title: 'Totals', metrics: [{ label: 'Revenue', value: 100, unit: 'USD' }] })
    expect(s).toEqual({ type: 'summary', title: 'Totals', metrics: [{ label: 'Revenue', value: 100, unit: 'USD' }], visibility: 'shop' })
  })
})

describe('detailSection', () => {
  it('normalizes typed rows/columns into the plain runtime shape', () => {
    const rows: FakeRow[] = [{ id: 'r1', label: 'A', total: 10 }]
    const s = detailSection<FakeRow>({
      title: 'Rows',
      columns: [{ key: 'label', label: 'Label' }, { key: 'total', label: 'Total' }],
      rows,
    })
    expect(s).toEqual({
      type: 'detail',
      title: 'Rows',
      columns: [
        { key: 'label', label: 'Label', format: undefined, align: undefined },
        { key: 'total', label: 'Total', format: undefined, align: undefined },
      ],
      rows,
      visibility: 'shop',
      truncated: false,
    })
  })

  it('accepts an explicit visibility: "staff" for staff-identifying sections', () => {
    const s = detailSection<FakeRow>({ title: 'Staff', columns: [{ key: 'id', label: 'ID' }], rows: [], visibility: 'staff' })
    expect(s.visibility).toBe('staff')
  })

  it('carries format/align column hints and an explicit truncated flag through', () => {
    const s = detailSection<FakeRow>({
      title: 'Rows',
      columns: [{ key: 'total', label: 'Total', format: 'currency-usd', align: 'end' }],
      rows: [],
      truncated: true,
    })
    expect(s.columns[0]).toMatchObject({ format: 'currency-usd', align: 'end' })
    expect(s.truncated).toBe(true)
  })

  it('mixed sections coexist in one Report without a shared row type', () => {
    const report = {
      id: 'daily-closing' as const, name: 'X', dateRange: { from: '2026-08-01', to: '2026-08-01' }, generatedAt: '2026-08-01T00:00:00.000Z',
      sections: [
        summarySection({ title: 'S', metrics: [] }),
        detailSection<FakeRow>({ title: 'D', columns: [{ key: 'id', label: 'ID' }], rows: [] }),
      ],
    }
    expect(report.sections).toHaveLength(2)
    expect(report.sections[0].type).toBe('summary')
    expect(report.sections[1].type).toBe('detail')
  })
})
