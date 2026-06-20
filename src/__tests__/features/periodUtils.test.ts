import { describe, it, expect } from 'vitest'
import { getMonthRange } from '@/features/dashboard/composables/periodUtils'

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

describe('getMonthRange', () => {
  it('returns the full current calendar month for offset 0', () => {
    const now = new Date()
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const r = getMonthRange(0)
    expect(r.start).toBe(`${ym(now)}-01`)
    expect(r.end).toBe(`${ym(now)}-${String(lastDay).padStart(2, '0')}`)
  })

  it('returns the previous month (with year rollover) for offset -1', () => {
    const prev = new Date()
    prev.setDate(1)
    prev.setMonth(prev.getMonth() - 1)
    const r = getMonthRange(-1)
    expect(r.start).toBe(`${ym(prev)}-01`)
  })

  it('returns the next month for offset +1', () => {
    const next = new Date()
    next.setDate(1)
    next.setMonth(next.getMonth() + 1)
    const r = getMonthRange(1)
    expect(r.start).toBe(`${ym(next)}-01`)
  })
})
