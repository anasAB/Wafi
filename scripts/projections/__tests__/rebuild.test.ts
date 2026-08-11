import { describe, it, expect, vi } from 'vitest'
import { parseArgs, runRebuild } from '../rebuild'

describe('parseArgs', () => {
  it('parses a scoped rebuild (--shop --from --to)', () => {
    const args = parseArgs(['daily_event_counts', '--shop', 'shop-1', '--from', '2026-08-01', '--to', '2026-08-11'])
    expect(args).toEqual({
      projection: 'daily_event_counts', mode: 'scoped',
      shopId: 'shop-1', from: '2026-08-01', to: '2026-08-11',
    })
  })

  it('parses --all', () => {
    const args = parseArgs(['daily_event_counts', '--all'])
    expect(args).toEqual({ projection: 'daily_event_counts', mode: 'all' })
  })

  it('rejects --shop combined with --all -- ambiguous, must be explicit about scope', () => {
    expect(() => parseArgs(['daily_event_counts', '--shop', 'shop-1', '--all'])).toThrow(/cannot combine --shop and --all/)
  })

  it('rejects a scoped rebuild missing --from or --to', () => {
    expect(() => parseArgs(['daily_event_counts', '--shop', 'shop-1', '--from', '2026-08-01'])).toThrow(/--from and --to are both required/)
  })

  it('rejects an unknown projection name', () => {
    expect(() => parseArgs(['unknown_projection', '--all'])).toThrow(/unknown projection/)
  })
})

describe('runRebuild', () => {
  it('scoped mode calls rebuildScope once with the given shop/range and reports the result', async () => {
    const rebuildScope = vi.fn().mockResolvedValue({ rows_deleted: 3, events_replayed: 5 })
    const listShopIds = vi.fn()
    const results = await runRebuild(
      { projection: 'daily_event_counts', mode: 'scoped', shopId: 'shop-1', from: '2026-08-01', to: '2026-08-11' },
      { rebuildScope, listShopIds },
    )
    expect(rebuildScope).toHaveBeenCalledTimes(1)
    expect(rebuildScope).toHaveBeenCalledWith('shop-1', '2026-08-01', '2026-08-11')
    expect(listShopIds).not.toHaveBeenCalled()
    expect(results).toEqual([{ shopId: 'shop-1', status: 'success', rowsDeleted: 3, eventsReplayed: 5 }])
  })

  it('--all mode calls rebuildScope once per shop returned by listShopIds, using each shop\'s full history', async () => {
    const rebuildScope = vi.fn().mockResolvedValue({ rows_deleted: 1, events_replayed: 1 })
    const listShopIds = vi.fn().mockResolvedValue(['shop-1', 'shop-2'])
    const results = await runRebuild(
      { projection: 'daily_event_counts', mode: 'all' },
      { rebuildScope, listShopIds },
    )
    expect(rebuildScope).toHaveBeenCalledTimes(2)
    expect(rebuildScope).toHaveBeenNthCalledWith(1, 'shop-1', '0001-01-01', '9999-12-31')
    expect(rebuildScope).toHaveBeenNthCalledWith(2, 'shop-2', '0001-01-01', '9999-12-31')
    expect(results).toEqual([
      { shopId: 'shop-1', status: 'success', rowsDeleted: 1, eventsReplayed: 1 },
      { shopId: 'shop-2', status: 'success', rowsDeleted: 1, eventsReplayed: 1 },
    ])
  })

  it('--all mode: a failure on one shop does not abort or block already-completed shops', async () => {
    const rebuildScope = vi.fn()
      .mockResolvedValueOnce({ rows_deleted: 1, events_replayed: 1 })
      .mockRejectedValueOnce(new Error('validation failed'))
    const listShopIds = vi.fn().mockResolvedValue(['shop-1', 'shop-2'])
    const results = await runRebuild(
      { projection: 'daily_event_counts', mode: 'all' },
      { rebuildScope, listShopIds },
    )
    expect(results).toEqual([
      { shopId: 'shop-1', status: 'success', rowsDeleted: 1, eventsReplayed: 1 },
      { shopId: 'shop-2', status: 'failed', error: 'validation failed' },
    ])
  })
})
