import { describe, it, expect, vi } from 'vitest'
// Importing the barrel pulls in all 13 real definition files, each of which
// imports the real db singleton -- mock it so this smoke test never tries to
// initialize a real PowerSync client.
vi.mock('@/data/powersync/db', () => ({ db: { getAll: vi.fn().mockResolvedValue([]), getOptional: vi.fn().mockResolvedValue(null) } }))

import { REPORT_DEFINITIONS } from '../index'

describe('reports registration barrel', () => {
  it('populates all 13 report definitions via import side-effects', () => {
    expect(Object.keys(REPORT_DEFINITIONS)).toHaveLength(13)
  })
})
