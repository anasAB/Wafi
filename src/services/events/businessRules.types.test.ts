import { describe, it, expect } from 'vitest'
import { parseBusinessRuleRow } from './businessRules.types'

describe('parseBusinessRuleRow', () => {
  it('maps a raw SQLite row to a typed BusinessRule', () => {
    const rule = parseBusinessRuleRow({
      id: 'r1',
      shop_id: 's1',
      rule_key: 'large_return',
      name: 'إرجاع كبير',
      event_type: 'sale.returned',
      field: 'refundAmountUsd',
      transform: 'none',
      operator: 'gt',
      threshold: 100,
      action: 'notify_owner',
      enabled: 1,
    })
    expect(rule).toEqual({
      id: 'r1',
      shopId: 's1',
      ruleKey: 'large_return',
      name: 'إرجاع كبير',
      eventType: 'sale.returned',
      field: 'refundAmountUsd',
      transform: 'none',
      operator: 'gt',
      threshold: 100,
      action: 'notify_owner',
      enabled: true,
    })
  })

  it('maps enabled: 0 to false', () => {
    const rule = parseBusinessRuleRow({
      id: 'r2',
      shop_id: 's1',
      rule_key: 'drawer_variance',
      name: 'فرق في الصندوق',
      event_type: 'shift.closed',
      field: 'variance',
      transform: 'abs',
      operator: 'gt',
      threshold: 15,
      action: 'notify_owner',
      enabled: 0,
    })
    expect(rule.enabled).toBe(false)
  })
})
