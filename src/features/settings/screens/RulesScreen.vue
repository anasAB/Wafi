<!-- src/features/settings/screens/RulesScreen.vue -->
<!--
  WAFI-156: owner-only view/edit UI for data-driven business rules. Lists the
  proof rules (large_return/drawer_variance) seeded by seed_business_rules_for_shop
  and lets the owner edit name/threshold/enabled per row -- the only fields
  update_business_rule (Task 4) accepts. No "add new rule" affordance (out of
  scope, spec §6): event_type/field/transform/operator/action are fixed,
  never client-editable.
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useDeviceStore } from '@/store/device.store'
import { useBusinessRules } from '@/features/settings/composables/useBusinessRules'
import type { BusinessRule } from '@/services/events/businessRules.types'

const router = useRouter()
const { rules, load, updateRule } = useBusinessRules(useDeviceStore().shopId)

// Per-row edit buffer, so typing doesn't mutate `rules` until Save -- same
// reasoning as NotificationSettingsScreen.vue's threshold input (only commits
// on change/click, not on every keystroke).
const drafts = ref<Record<string, { name: string; threshold: number; enabled: boolean }>>({})
const savedRuleId = ref<string | null>(null)
const errorByRuleId = ref<Record<string, string>>({})

function syncDrafts() {
  const next: Record<string, { name: string; threshold: number; enabled: boolean }> = {}
  for (const rule of rules.value) {
    next[rule.id] = { name: rule.name, threshold: rule.threshold, enabled: rule.enabled }
  }
  drafts.value = next
}

async function save(rule: BusinessRule) {
  savedRuleId.value = null
  errorByRuleId.value = { ...errorByRuleId.value, [rule.id]: '' }
  const draft = drafts.value[rule.id]
  const result = await updateRule(rule.id, draft)
  if (result === 'updated') {
    syncDrafts()
    savedRuleId.value = rule.id
  } else if (result === 'invalid_name') {
    errorByRuleId.value = { ...errorByRuleId.value, [rule.id]: 'الاسم مطلوب' }
  } else if (result === 'invalid_threshold') {
    errorByRuleId.value = { ...errorByRuleId.value, [rule.id]: 'يجب أن يكون الحد رقمًا صحيحًا وغير سالب' }
  } else {
    errorByRuleId.value = { ...errorByRuleId.value, [rule.id]: 'لا تملك صلاحية تعديل هذه القاعدة' }
  }
}

onMounted(async () => {
  await load()
  syncDrafts()
})
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="قواعد العمل" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <p class="section-label">القواعد</p>
    <div class="settings-card">
      <div
        v-for="(rule, idx) in rules"
        :key="rule.id"
        class="rule-row"
        :class="{ 'rule-row--last': idx === rules.length - 1 }"
        :data-testid="`rule-row-${rule.ruleKey}`"
      >
        <div class="rule-row-main">
          <input
            v-if="drafts[rule.id]"
            v-model="drafts[rule.id].name"
            type="text"
            class="field-input"
            :data-testid="`name-input-${rule.ruleKey}`"
          >
          <label class="switch">
            <input
              v-if="drafts[rule.id]"
              v-model="drafts[rule.id].enabled"
              type="checkbox"
              :data-testid="`enable-toggle-${rule.ruleKey}`"
            >
          </label>
        </div>
        <div class="rule-row-threshold">
          <input
            v-if="drafts[rule.id]"
            v-model.number="drafts[rule.id].threshold"
            type="number"
            min="0"
            class="field-input field-input--small"
            :data-testid="`threshold-input-${rule.ruleKey}`"
          >
          <button
            type="button"
            class="btn-primary"
            :data-testid="`save-button-${rule.ruleKey}`"
            @click="save(rule)"
          >
            حفظ
          </button>
        </div>
        <p v-if="errorByRuleId[rule.id]" class="rule-error" :data-testid="`error-${rule.ruleKey}`">
          {{ errorByRuleId[rule.id] }}
        </p>
        <p v-else-if="savedRuleId === rule.id" class="rule-saved">تم الحفظ</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-body { padding: 16px; max-width: 560px; margin: 0 auto; width: 100%; padding-bottom: 80px; font-family: 'Tajawal', system-ui, sans-serif; }
@media (min-width: 1024px) { .page-body { padding: 20px; max-width: none; } }

.section-label { font-size: 11px; font-weight: 700; color: #3D4F6B; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 4px; margin-bottom: 6px; }

.settings-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28); border-radius: 1rem; overflow: hidden; margin-bottom: 0.75rem;
}

.field-input {
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px; padding: 9px 12px; font-size: 14px; color: #E8EDF5; outline: none; font-family: inherit;
}
.field-input--small { max-width: 110px; }

.btn-primary {
  display: inline-flex; align-items: center; justify-content: center; height: 40px; padding-inline: 0.9rem;
  border-radius: 0.625rem; font-size: 0.8125rem; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #1A56DB, #1248B3); border: none; cursor: pointer; font-family: inherit;
}

.rule-row {
  padding: 0.7rem 0.95rem; border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  display: flex; flex-direction: column; gap: 0.5rem;
}
.rule-row--last { border-bottom: none; }

.rule-row-main { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.rule-row-main .field-input { flex: 1; }

.switch input { width: 18px; height: 18px; }

.rule-row-threshold { display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; }

.rule-error { margin: 0; font-size: 0.78rem; color: #EF4444; }
.rule-saved { margin: 0; font-size: 0.78rem; color: #22C55E; }
</style>
