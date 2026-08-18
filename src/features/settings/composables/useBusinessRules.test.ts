import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetAll = vi.fn()
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...args: unknown[]) => mockGetAll(...args), watch: vi.fn() } }))

const mockRpc = vi.fn()
vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }))

import { useBusinessRules } from './useBusinessRules'

describe('useBusinessRules', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('loads and parses rules for the given shop', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'r1', shop_id: 's1', rule_key: 'large_return', name: 'إرجاع كبير', event_type: 'sale.returned', field: 'refundAmountUsd', transform: 'none', operator: 'gt', threshold: 100, action: 'notify_owner', enabled: 1 },
    ])
    const { rules, load } = useBusinessRules('s1')
    await load()
    expect(rules.value).toHaveLength(1)
    expect(rules.value[0].ruleKey).toBe('large_return')
  })

  it('updateRule calls update_business_rule with exactly name/threshold/enabled', async () => {
    mockRpc.mockResolvedValue({ data: 'updated', error: null })
    const { updateRule } = useBusinessRules('s1')
    const result = await updateRule('r1', { name: 'new name', threshold: 250, enabled: false })
    expect(mockRpc).toHaveBeenCalledWith('update_business_rule', {
      p_rule_id: 'r1', p_name: 'new name', p_threshold: 250, p_enabled: false,
    })
    expect(result).toBe('updated')
  })

  it('updateRule surfaces a forbidden result without throwing', async () => {
    mockRpc.mockResolvedValue({ data: 'forbidden', error: null })
    const { updateRule } = useBusinessRules('s1')
    expect(await updateRule('r1', { name: 'x', threshold: 1, enabled: true })).toBe('forbidden')
  })

  it('updateRule surfaces an invalid_threshold result without throwing', async () => {
    mockRpc.mockResolvedValue({ data: 'invalid_threshold', error: null })
    const { updateRule } = useBusinessRules('s1')
    expect(await updateRule('r1', { name: 'x', threshold: -5, enabled: true })).toBe('invalid_threshold')
  })
})
