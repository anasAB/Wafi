// src/services/events/loadEnabledRules.ts
import { db } from '@/data/powersync/db'
import { parseBusinessRuleRow } from './businessRules.types'
import type { BusinessRule } from './businessRules.types'
import type { DataDrivenRuleEventType } from './domainEvent.types'

export async function loadEnabledRules(
  shopId: string,
  eventType: DataDrivenRuleEventType,
): Promise<BusinessRule[]> {
  const rows = await db.getAll<{
    id: string
    shop_id: string
    rule_key: string
    name: string
    event_type: string
    field: string
    transform: string
    operator: string
    threshold: number
    action: string
    enabled: number
  }>(
    `select id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled
     from business_rules where shop_id = ? and event_type = ? and enabled = 1`,
    [shopId, eventType],
  )
  return rows.map(parseBusinessRuleRow)
}
