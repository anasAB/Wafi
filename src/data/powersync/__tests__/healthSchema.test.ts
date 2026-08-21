import { describe, it, expect } from 'vitest'
import { AppSchema } from '../schema'

describe('WAFI-148 local health schema', () => {
  it('defines local_health_metrics as localOnly with the expected columns', () => {
    const table = AppSchema.tables.find((t) => t.name === 'local_health_metrics')
    expect(table).toBeDefined()
    expect(table?.localOnly).toBe(true)
    const columnNames = table?.columns.map((c) => c.name)
    expect(columnNames).toEqual(expect.arrayContaining(['metric_key', 'period_start', 'value', 'updated_at']))
  })

  it('defines local_health_gauges as localOnly with the expected columns', () => {
    const table = AppSchema.tables.find((t) => t.name === 'local_health_gauges')
    expect(table).toBeDefined()
    expect(table?.localOnly).toBe(true)
    const columnNames = table?.columns.map((c) => c.name)
    expect(columnNames).toEqual(expect.arrayContaining(['gauge_key', 'value', 'observed_at']))
  })
})
