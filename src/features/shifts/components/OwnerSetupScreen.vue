<script setup lang="ts">
import { ref }         from 'vue'
import { useRouter }   from 'vue-router'
import StaffForm       from '@/features/staff/components/StaffForm.vue'
import ExchangeRateEditor from '@/features/exchange-rate/ExchangeRateEditor.vue'
import TimezoneConfirmForm from '@/features/staff/components/TimezoneConfirmForm.vue'
import { useDemoDataSeed } from '@/features/onboarding/composables/useDemoDataSeed'
import { useOwnerBootstrap } from '@/features/staff/composables/useOwnerBootstrap'
import { useShopTimezone, suggestedTimezoneForCountry } from '@/features/staff/composables/useShopTimezone'
import { store } from '@/store'

const router = useRouter()
const { seedDemoProducts } = useDemoDataSeed()
const { bootstrapOwner, resumePendingBootstrap } = useOwnerBootstrap()
const { confirmTimezone } = useShopTimezone()

const pinDone   = ref(false)
const bootstrapping = ref(false)
const timedOut  = ref(false)
const bootstrapError = ref('')

// WAFI-148: prompted once during bootstrap, but never a hard gate on
// finishing setup -- the owner can skip and confirm later from Shop
// Settings. Health-monitoring computation stays inactive until confirmed;
// nothing about POS onboarding itself depends on this step.
const exchangeRateDone = ref(false)
const timezoneStepDone = ref(false)
const confirmingTimezone = ref(false)

function handleExchangeRateClose() {
  exchangeRateDone.value = true
}

async function handleTimezoneConfirm(timezone: string) {
  confirmingTimezone.value = true
  try {
    await confirmTimezone(timezone)
  } finally {
    confirmingTimezone.value = false
    timezoneStepDone.value = true
    await proceedToGoal()
  }
}

function handleTimezoneSkip() {
  timezoneStepDone.value = true
  void proceedToGoal()
}

// Design doc §"Client-side change": the very first owner's staff row is
// created server-side via bootstrap_owner_identity(), not through
// StaffForm's normal local-write path -- see useOwnerBootstrap.ts for why.
async function handleOwnerSetup(name: string, pin: string) {
  bootstrapping.value = true
  timedOut.value = false
  bootstrapError.value = ''
  try {
    const result = await bootstrapOwner(name, pin)
    if (result.status === 'done') {
      pinDone.value = true
    } else if (result.status === 'timeout') {
      timedOut.value = true
    } else {
      bootstrapError.value = 'تحتاج إلى اتصال بالإنترنت لإكمال الإعداد الأول'
    }
  } finally {
    bootstrapping.value = false
  }
}

async function retrySync() {
  timedOut.value = false
  bootstrapping.value = true
  try {
    const result = await resumePendingBootstrap()
    if (result.status === 'done') pinDone.value = true
    else if (result.status === 'timeout') timedOut.value = true
    else if (result.status === 'needs-connectivity') bootstrapError.value = 'تحتاج إلى اتصال بالإنترنت لإكمال الإعداد الأول'
  } finally {
    bootstrapping.value = false
  }
}

function continueLater() {
  // Leaves the PendingBootstrap record in place -- resumed automatically on
  // next launch per the design doc's Lifecycle section (out of scope for
  // this task: the boot-time auto-resume check is a separate concern from
  // this screen's own retry button, and belongs at the router/App.vue level,
  // not here).
  router.push('/')
}

async function proceedToGoal() {
  switch (store.startGoal) {
    case 'sell':
      router.push('/pos')
      break
    case 'inventory':
      router.push('/products/add')
      break
    case 'explore':
      await seedDemoProducts()
      router.push('/onboarding')
      break
    default:
      router.push('/')
  }
}
</script>

<template>
  <div class="lock-root" dir="rtl">
    <div class="lock-card">
      <h1 class="brand">وافي</h1>

      <StaffForm
        v-if="!pinDone && !timedOut"
        force-role="owner"
        :saving="bootstrapping"
        :submit-error="bootstrapError"
        @submit="handleOwnerSetup"
      />

      <div v-if="timedOut" class="bootstrap-timeout">
        <p>لا يزال قيد المزامنة — يمكنك المحاولة مرة أخرى أو المتابعة لاحقاً</p>
        <button class="bootstrap-retry-btn" type="button" @click="retrySync">إعادة المحاولة</button>
        <button class="bootstrap-continue-later-btn" type="button" @click="continueLater">المتابعة لاحقاً</button>
      </div>
    </div>
    <ExchangeRateEditor
      v-if="pinDone && !exchangeRateDone"
      @close="handleExchangeRateClose"
    />
    <div v-if="pinDone && exchangeRateDone && !timezoneStepDone" class="lock-card">
      <TimezoneConfirmForm
        :initial-timezone="suggestedTimezoneForCountry(store.country)"
        :confirming="confirmingTimezone"
        :skippable="true"
        @confirm="handleTimezoneConfirm"
        @skip="handleTimezoneSkip"
      />
    </div>
  </div>
</template>

<style scoped>
.lock-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.lock-card {
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1.5rem;
  border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.40);
  box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
  text-align: center;
  gap: 0.5rem;
}

.brand {
  font-family: var(--font-display-ar, 'Tajawal'), serif;
  margin: 0;
  color: var(--color-gold-primary);
  font-size: 2.5rem;
  line-height: 1;
  font-weight: 800;
  margin-bottom: 1rem;
}

.bootstrap-timeout {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 1rem;
  text-align: center;
  color: #E8EDF5;
}
.bootstrap-retry-btn, .bootstrap-continue-later-btn {
  height: 42px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
  border: none;
}
.bootstrap-retry-btn {
  color: white;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
}
.bootstrap-continue-later-btn {
  color: #60A5FA;
  background: rgba(26,86,219,0.12);
  border: 1px solid rgba(26,86,219,0.30);
}
</style>
