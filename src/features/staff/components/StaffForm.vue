<script setup lang="ts">
import { ref, reactive }  from 'vue'
import { useStaff }       from '../composables/useStaff'
import PinPad             from './PinPad.vue'
import type { StaffRole, StaffPermissions } from '../staff.types'
import { DEFAULT_CASHIER_PERMISSIONS }      from '../staff.types'

const props = defineProps<{ editStaffId?: string }>()
const emit  = defineEmits<{ done: [] }>()

const { createStaff, updateStaffPin } = useStaff()

const name      = ref('')
const role      = ref<StaffRole>('cashier')
const pinStep   = ref<'first' | 'confirm'>('first')
const firstPin  = ref('')
const pinError  = ref('')
const pinPadRef = ref<InstanceType<typeof PinPad> | null>(null)
const saving    = ref(false)
const perms     = reactive<StaffPermissions>({ ...DEFAULT_CASHIER_PERMISSIONS })

const PERM_LABELS: Array<[keyof StaffPermissions, string]> = [
  ['can_view_reports',     'عرض التقارير'],
  ['can_manage_products',  'إدارة المنتجات'],
  ['can_manage_customers', 'إدارة الزبائن'],
  ['can_view_expenses',    'عرض المصاريف'],
  ['can_manage_settings',  'الإعدادات'],
]

async function onFirstPin(pin: string) {
  if (!props.editStaffId && !name.value.trim()) {
    pinError.value = 'يرجى إدخال الاسم أولاً'
    return
  }
  firstPin.value = pin
  pinStep.value  = 'confirm'
}

async function onConfirmPin(pin: string) {
  if (pin !== firstPin.value) {
    pinError.value = 'الرقمان لا يتطابقان'
    pinPadRef.value?.shake()
    pinStep.value  = 'first'
    firstPin.value = ''
    return
  }
  saving.value = true
  try {
    if (props.editStaffId) {
      await updateStaffPin(props.editStaffId, pin)
    } else {
      await createStaff({ name: name.value, pin, role: role.value, permissions: { ...perms } })
    }
    emit('done')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-4" dir="rtl">
    <!-- Name + role fields (new staff only) -->
    <template v-if="!editStaffId && !firstPin">
      <div class="w-full flex flex-col gap-3">
        <div>
          <label class="text-[#637285] text-sm block mb-1">الاسم</label>
          <input v-model="name"
            @input="pinError = ''"
            class="w-full bg-white/10 rounded-xl px-4 py-3 text-white outline-none"
            placeholder="اسم الموظف" />
        </div>
        <div>
          <label class="text-[#637285] text-sm block mb-1">الدور</label>
          <div class="flex gap-2">
            <button @click="role = 'cashier'"
              :class="['flex-1 py-2 rounded-xl text-sm font-medium', role === 'cashier' ? 'bg-[#1A56DB] text-white' : 'bg-white/10 text-[#C8D5E8]']">
              كاشير</button>
            <button @click="role = 'owner'"
              :class="['flex-1 py-2 rounded-xl text-sm font-medium', role === 'owner' ? 'bg-[#1A56DB] text-white' : 'bg-white/10 text-[#C8D5E8]']">
              مالك</button>
          </div>
        </div>
        <div v-if="role === 'cashier'" class="bg-white/5 rounded-xl p-4 space-y-3">
          <p class="text-[#637285] text-sm">الصلاحيات</p>
          <label v-for="[key, label] in PERM_LABELS" :key="key"
            class="flex items-center justify-between">
            <span class="text-[#C8D5E8] text-sm">{{ label }}</span>
            <input type="checkbox" v-model="(perms as any)[key]" class="w-5 h-5 accent-[#1A56DB]" />
          </label>
        </div>
      </div>
    </template>

    <p class="text-white text-base">
      {{ pinStep === 'first'
        ? (editStaffId ? 'أدخل الرقم السري الجديد' : 'أنشئ رقماً سرياً (4 أرقام)')
        : 'أكّد الرقم السري' }}
    </p>
    <p v-if="pinError" class="text-red-400 text-sm">{{ pinError }}</p>

    <PinPad
      ref="pinPadRef"
      @complete="pinStep === 'first' ? onFirstPin($event) : onConfirmPin($event)"
    />
  </div>
</template>
