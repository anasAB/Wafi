<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useShopTimezone, COMMON_TIMEZONE_OPTIONS, type ConfirmTimezoneResult } from '@/features/staff/composables/useShopTimezone'

// WAFI-148: the first shop-level (not per-staff/device) settings screen in
// this app. Lets the owner correct the shop's timezone after bootstrap --
// e.g. a wrong choice at setup, or a shop relocating. Changing it here does
// NOT rewrite already-recorded health-metric history (see
// docs/superpowers/specs/2026-08-21-wafi-148-health-monitoring-design.md and
// migration 115's event_projection_day comment) -- it only takes effect for
// future reporting periods.
const { currentTimezone, isConfirmed, loading, error, load, confirmTimezone } = useShopTimezone()

const selected = ref('UTC')
const saving = ref(false)
const result = ref<ConfirmTimezoneResult | null>(null)

onMounted(async () => {
  await load()
  if (currentTimezone.value) selected.value = currentTimezone.value
})

async function save() {
  saving.value = true
  result.value = null
  try {
    result.value = await confirmTimezone(selected.value)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" dir="rtl">
    <div>
      <h2 class="text-sm font-semibold mb-1">المنطقة الزمنية للمتجر</h2>
      <p class="text-xs opacity-70">
        تُستخدم هذه القيمة لتحديد بداية اليوم في تقارير صحة التطبيق. تغييرها لا يعيد
        حساب البيانات التاريخية المسجلة سابقًا.
      </p>
    </div>

    <p v-if="loading" class="text-xs opacity-60">جارٍ التحميل...</p>

    <template v-else>
      <p v-if="!isConfirmed" class="text-xs text-amber-500">
        لم يتم تأكيد المنطقة الزمنية بعد — تقارير الصحة غير مفعّلة حتى تأكيدها.
      </p>

      <select
        v-model="selected"
        class="h-10 rounded-lg px-3 text-sm bg-white/5 border border-white/10"
        :disabled="saving"
      >
        <option v-for="opt in COMMON_TIMEZONE_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <button
        type="button"
        class="h-10 rounded-lg text-sm font-semibold text-white"
        style="background: linear-gradient(135deg, #1A56DB, #1248B3)"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? 'جارٍ الحفظ...' : 'حفظ' }}
      </button>

      <p v-if="result === 'ok'" class="text-xs text-emerald-500">تم الحفظ بنجاح.</p>
      <p v-else-if="result === 'forbidden'" class="text-xs text-red-500">
        هذا الإعداد متاح لمالك المتجر فقط.
      </p>
      <p v-else-if="result === 'invalid_timezone'" class="text-xs text-red-500">
        منطقة زمنية غير صالحة.
      </p>
      <p v-else-if="result === 'error'" class="text-xs text-red-500">{{ error || 'حدث خطأ غير متوقع.' }}</p>
    </template>
  </div>
</template>
