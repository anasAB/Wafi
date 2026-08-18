// src/services/events/businessRuleSubscriber.ts
// WAFI-156: no client-side condition pre-filter in the correctness path (spec
// §2.2 correction). business_rules is synced config that can be stale on a
// given device -- a local gate concluding "doesn't match, don't call the RPC"
// off a stale threshold would silently suppress a real notification, which
// is unacceptable. An unnecessary RPC call that the RPC correctly rejects is
// harmless. So: every enabled rule loaded for an event type gets an RPC
// call, unconditionally, with no local condition check gating it.
import { supabase } from '@/data/supabase/client'
import { runDurableSubscriber } from './runDurableSubscriber'
import { loadEnabledRules } from './loadEnabledRules'
import type { DataDrivenRuleEventType } from './domainEvent.types'
import type { DurableEvent } from './runDurableSubscriber'

/** Mirrors NOTIFIED_EVENT_TYPES's role in notificationSubscriber.ts (WAFI-157
 *  consumer-completeness convention): the finite set this subscriber group
 *  actually registers for, exported as inspectable data. */
export const DATA_DRIVEN_RULE_EVENT_TYPES: DataDrivenRuleEventType[] = ['sale.returned', 'shift.closed']

async function handleEventForType(eventType: DataDrivenRuleEventType, event: DurableEvent<unknown>): Promise<void> {
  const rules = await loadEnabledRules(event.shopId, eventType)
  // No local condition filter (spec §2.2 correction): execute_rule_action is
  // the sole evaluator, called for every enabled rule regardless of what a
  // possibly-stale local copy of the rule's threshold would suggest. Each
  // call is independent -- one rule's failure must not prevent the next
  // rule's call in this same loop from being attempted.
  const errors: unknown[] = []
  for (const rule of rules) {
    const { error } = await supabase.rpc('execute_rule_action', {
      p_event_id: event.eventId,
      p_rule_id: rule.id,
    })
    if (error) errors.push(error)
  }
  if (errors.length > 0) {
    // runDurableSubscriber's own catch/retry-queue wraps this handler --
    // rethrow (after every rule in this event has been attempted) so the
    // failure routes through the existing retry mechanism rather than being
    // silently swallowed here.
    throw errors[0]
  }
}

/**
 * One runDurableSubscriber instance per SUPPORTED event type, fixed at
 * registration time regardless of how many business_rules rows are
 * currently enabled for it (spec §2.2) -- adding a 10th rule to
 * sale.returned is a data change, not a new subscriber.
 */
export function startBusinessRuleSubscribers(shopId: string): { stop: () => void } {
  const subs = DATA_DRIVEN_RULE_EVENT_TYPES.map((eventType) =>
    runDurableSubscriber({
      subscriberName: `business-rules:${eventType}`,
      eventType,
      shopId,
      handler: (event) => handleEventForType(eventType, event),
    }),
  )
  return { stop: () => subs.forEach((s) => s.stop()) }
}
