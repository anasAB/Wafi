<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useRecoveryCodes, RECOVERY_CODE_COUNT } from '@/features/staff/composables/useRecoveryCodes'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { useSessionStore } from '@/store/session.store'

// Owner-only: generate/replace the owner's offline recovery codes. Codes are
// shown ONCE here and never persisted in plaintext (see useRecoveryCodes).
const { t } = useI18n()
const { generate, remaining } = useRecoveryCodes()
const { logRecoveryCodesGenerated } = useAuditLog()
const session = useSessionStore()
const router  = useRouter()

const left      = ref(0)
const codes     = ref<string[] | null>(null) // non-null only while showing a fresh set
const busy      = ref(false)
const copied    = ref(false)

const owner = () => session.activeStaff

onMounted(async () => { if (owner()) left.value = await remaining(owner()!.id) })

async function onGenerate() {
  const o = owner()
  if (!o || busy.value) return
  busy.value = true
  try {
    codes.value = await generate(o.id)
    left.value = RECOVERY_CODE_COUNT
    await logRecoveryCodesGenerated(o.id, o.name)
  } finally { busy.value = false }
}

async function copyAll() {
  if (!codes.value) return
  try { await navigator.clipboard.writeText(codes.value.join('\n')); copied.value = true }
  catch { /* clipboard blocked — the codes are visible to copy by hand */ }
}

function done() { codes.value = null; copied.value = false }
</script>

<template>
  <!-- Mobile header — hidden on desktop where SettingsPage provides the chrome -->
  <div class="lg:hidden">
    <AppHeader
      :title="t('settings.recoveryCodes')"
      :show-back="true"
      @back="router.back()"
    />
  </div>

  <div class="rc">
    <h2 class="rc-title">{{ t('staff.codesTitle') }}</h2>

    <!-- Reveal-once view -->
    <template v-if="codes">
      <p class="rc-warn">{{ t('staff.codesShownOnce') }}</p>
      <ul class="rc-grid" dir="ltr">
        <li v-for="c in codes" :key="c" class="rc-code">{{ c }}</li>
      </ul>
      <button type="button" class="rc-secondary" @click="copyAll">
        {{ copied ? t('staff.codesCopied') : '⧉' }}
      </button>
      <button type="button" class="rc-primary" data-test="codes-done" @click="done">
        {{ t('staff.codesDone') }}
      </button>
    </template>

    <!-- Default view -->
    <template v-else>
      <p class="rc-intro">{{ t('staff.codesIntro') }}</p>
      <p class="rc-remaining">{{ t('staff.codesRemaining', { count: left, total: RECOVERY_CODE_COUNT }) }}</p>
      <p class="rc-warn-soft">{{ t('staff.codesRegenerateWarn') }}</p>
      <button type="button" class="rc-primary" data-test="generate" :disabled="busy" @click="onGenerate">
        {{ t('staff.codesGenerate') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.rc { display: flex; flex-direction: column; gap: 0.75rem; max-width: 28rem; padding: 16px; }
.rc-title { font-size: 1.125rem; font-weight: 800; color: #E8EDF5; }
.rc-intro, .rc-warn-soft { font-size: 0.85rem; color: #8EA3BF; line-height: 1.6; }
.rc-remaining { font-size: 0.95rem; font-weight: 700; color: #C8D5E8; }
.rc-warn { font-size: 0.85rem; color: #FBBF24; font-weight: 700; }
.rc-grid {
  list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;
}
.rc-code {
  font-family: monospace; font-size: 1rem; letter-spacing: 0.15em; color: #E8EDF5;
  background: #0D1828; border: 1px solid rgba(26,86,219,0.30); border-radius: 0.5rem;
  padding: 0.6rem; text-align: center;
}
.rc-primary {
  height: 48px; border-radius: 0.875rem; border: none; cursor: pointer;
  background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; font-weight: 700; font-family: inherit;
}
.rc-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-secondary {
  align-self: flex-start; padding: 0.4rem 0.8rem; border-radius: 0.5rem; cursor: pointer;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); color: #C8D5E8; font-family: inherit;
}
</style>
