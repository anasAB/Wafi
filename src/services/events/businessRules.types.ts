// src/services/events/businessRules.types.ts
// WAFI-156: client-side representation of a data-driven business rule
// (public.business_rules, migration 092). Mirrors the closed vocabulary
// enforced server-side by that table's CHECK constraints.
import type { DataDrivenRuleEventType } from './domainEvent.types'

export type RuleField = 'refundAmountUsd' | 'variance'
export type RuleTransform = 'none' | 'abs'
export type RuleOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
export type RuleAction = 'notify_owner'

export interface BusinessRule {
  id: string
  shopId: string
  ruleKey: string
  name: string
  eventType: DataDrivenRuleEventType
  field: RuleField
  transform: RuleTransform
  operator: RuleOperator
  threshold: number
  action: RuleAction
  enabled: boolean
}

/** Maps a raw PowerSync/SQLite row (all-text/integer, per schema.ts convention)
 *  to a typed BusinessRule. */
export function parseBusinessRuleRow(row: {
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
}): BusinessRule {
  return {
    id: row.id,
    shopId: row.shop_id,
    ruleKey: row.rule_key,
    name: row.name,
    eventType: row.event_type as DataDrivenRuleEventType,
    field: row.field as RuleField,
    transform: row.transform as RuleTransform,
    operator: row.operator as RuleOperator,
    threshold: row.threshold,
    action: row.action as RuleAction,
    enabled: row.enabled === 1,
  }
}
