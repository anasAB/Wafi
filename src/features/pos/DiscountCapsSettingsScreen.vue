<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useDiscountCaps } from '@/features/pos/useDiscountCaps'
import { validateDiscountCaps, type DiscountCapsErrors } from '@/features/pos/discountCapsValidation'

const router = useRouter()
const caps = useDiscountCaps()

const cashierInput = ref(String(caps.cashierPct.value))
const managerInput = ref(String(caps.managerPct.value))
const cashierTouched = ref(false)
const managerTouched = ref(false)
const errors = ref<DiscountCapsErrors>({})
const toast = ref<{ kind: 'success' | 'error'; message: string } | null>(null)
const confirming = ref(false)
const pending = ref<{ cashierPct: number; managerPct: number } | null>(null)
let checkTimer: ReturnType<typeof setTimeout> | null = null
let dismissTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  await caps.load()
  // Only sync loaded values into fields the user hasn't already started editing,
  // so a slow load() can't silently clobber input made while it was in flight.
  if (!cashierTouched.value) cashierInput.value = String(caps.cashierPct.value)
  if (!managerTouched.value) managerInput.value = String(caps.managerPct.value)
})

const confirmMessage = computed(() => {
  if (!pending.value) return ''
  const lines: string[] = []
  if (pending.value.cashierPct !== caps.cashierPct.value) {
    lines.push(`سيتغير حد الكاشير من ${caps.cashierPct.value}% إلى ${pending.value.cashierPct}%`)
  }
  if (pending.value.managerPct !== caps.managerPct.value) {
    lines.push(`سيتغير حد المدير من ${caps.managerPct.value}% إلى ${pending.value.managerPct}%`)
  }
  return lines.join(' — ')
})

function submit() {
  const result = validateDiscountCaps({ cashier: String(cashierInput.value), manager: String(managerInput.value) })
  errors.value = result.errors
  if (!result.valid || !result.parsed) return

  pending.value = result.parsed
  confirming.value = true
}

async function confirmSave() {
  if (!pending.value) return
  const next = pending.value
  confirming.value = false
  pending.value = null

  const sinceIso = new Date().toISOString()
  try {
    await caps.save(next)
  } catch {
    toast.value = { kind: 'error', message: 'تعذّر الحفظ' }
    return
  }
  toast.value = { kind: 'success', message: 'تم الحفظ' }

  // Best-effort single sample, not an authoritative guarantee: while offline
  // (this product's normal state), the PowerSync upload may not have even been
  // attempted 1.5s after the local write, so checkSaveFailed() will return null
  // and the success toast stands even though nothing has reached the server yet.
  // This only reliably catches an already-known rejection (e.g. a dead-lettered
  // upload from a previous save, or a very fast online rejection) — it is not a
  // continuous monitor. A db.watch-based continuous check is a good follow-up,
  // out of scope for this fix wave.
  checkTimer = setTimeout(async () => {
    checkTimer = null
    const failure = await caps.checkSaveFailed(sinceIso)
    if (failure) {
      toast.value = { kind: 'error', message: 'لم يتم الحفظ على الخادم — سيُعاد المحاولة' }
    }
    dismissTimer = setTimeout(() => {
      dismissTimer = null
      toast.value = null
    }, 2000)
  }, 1500)
}

function cancelSave() {
  confirming.value = false
  pending.value = null
}

onUnmounted(() => {
  if (checkTimer) clearTimeout(checkTimer)
  if (dismissTimer) clearTimeout(dismissTimer)
})

defineExpose({ submit })
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="حدود الخصم" :show-back="true" @back="router.back()" />
  </div>

  <form class="page-body" dir="rtl" @submit.prevent="submit">
    <p class="hint">أقصى نسبة خصم يمكن لكل رتبة تطبيقها بدون رمز موافقة المالك.</p>
    <p class="hint">الأصحاب غير مقيدين بحد أقصى.</p>

    <div class="field">
      <span id="cashier-cap-label">الكاشير</span>
      <input
        id="cashier-cap-input"
        type="number"
        min="0"
        max="100"
        step="0.01"
        aria-labelledby="cashier-cap-label"
        v-model="cashierInput"
        @input="cashierTouched = true"
      />
      <span class="suffix">%</span>
    </div>
    <p v-if="errors.cashier" class="field-error">{{ errors.cashier }}</p>

    <div class="field">
      <span id="manager-cap-label">المدير</span>
      <input
        id="manager-cap-input"
        type="number"
        min="0"
        max="100"
        step="0.01"
        aria-labelledby="manager-cap-label"
        v-model="managerInput"
        @input="managerTouched = true"
      />
      <span class="suffix">%</span>
    </div>
    <p v-if="errors.manager" class="field-error">{{ errors.manager }}</p>
    <p v-if="errors.cross" class="field-error">{{ errors.cross }}</p>

    <button type="submit" class="save-btn">حفظ</button>

    <p v-if="toast" :class="toast.kind === 'success' ? 'saved-note' : 'error-note'">{{ toast.message }}</p>
  </form>

  <AppDialog
    v-if="confirming"
    data-testid="confirm-dialog"
    title="تأكيد التغيير"
    :message="confirmMessage"
    @confirm="confirmSave"
    @cancel="cancelSave"
  />
</template>

<style scoped>
.page-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.hint { font-size: 12px; color: #637285; margin: 0 0 6px; }
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(26,86,219,0.14);
  border-radius: 12px;
  padding: 10px 14px;
  color: #E8EDF5;
}
.field input {
  width: 70px;
  background: transparent;
  border: none;
  outline: none;
  color: #E8EDF5;
  font-size: 16px;
  font-weight: 700;
  font-family: inherit;
}
.suffix { color: #637285; }
.field-error { color: #EF4444; font-size: 12px; margin: 0 0 6px; }
.save-btn {
  align-self: flex-start;
  background: #1A56DB;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  margin-top: 6px;
}
.saved-note { color: #22C55E; font-size: 12px; margin: 8px 0 0; }
.error-note { color: #EF4444; font-size: 12px; margin: 8px 0 0; }
</style>
