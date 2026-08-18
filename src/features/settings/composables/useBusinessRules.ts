// src/features/settings/composables/useBusinessRules.ts
// WAFI-156: RulesScreen.vue's data layer. update_business_rule (Task 4) is
// the only write path -- this composable never writes business_rules
// directly, only through that RPC.
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import { parseBusinessRuleRow } from '@/services/events/businessRules.types'
import type { BusinessRule } from '@/services/events/businessRules.types'

export function useBusinessRules(shopId: string) {
  const rules = ref<BusinessRule[]>([])

  async function load(): Promise<void> {
    const rows = await db.getAll<Parameters<typeof parseBusinessRuleRow>[0]>(
      `select id, shop_id, rule_key, name, event_type, field, transform, operator, threshold, action, enabled
       from business_rules where shop_id = ? order by name`,
      [shopId],
    )
    rules.value = rows.map(parseBusinessRuleRow)
  }

  async function updateRule(
    ruleId: string,
    changes: { name: string; threshold: number; enabled: boolean },
  ): Promise<'updated' | 'forbidden' | 'invalid_name' | 'invalid_threshold'> {
    const { data, error } = await supabase.rpc('update_business_rule', {
      p_rule_id: ruleId, p_name: changes.name, p_threshold: changes.threshold, p_enabled: changes.enabled,
    })
    if (error) throw error
    if (data === 'updated') await load()
    return data as 'updated' | 'forbidden' | 'invalid_name' | 'invalid_threshold'
  }

  return { rules, load, updateRule }
}
