<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useStaff }       from '../composables/useStaff'
import PinPad             from './PinPad.vue'
import type { StaffRole, StaffPermissions, Staff } from '../staff.types'
import { DEFAULT_CASHIER_PERMISSIONS }      from '../staff.types'

const props = defineProps<{ editStaff?: Staff; forceRole?: StaffRole }>()
const emit  = defineEmits<{ done: [] }>()

const { createStaff, updateStaffPin, updateStaff } = useStaff()

const isEdit = computed(() => !!props.editStaff)

// step: 'info' → 'pin' → 'confirm'. Both add and edit start on 'info'; in edit
// mode the owner can change name/role/permissions and optionally the PIN.
const step      = ref<'info' | 'pin' | 'confirm'>('info')
const name      = ref(props.editStaff?.name ?? '')
const role      = ref<StaffRole>(props.forceRole ?? props.editStaff?.role ?? 'cashier')
const firstPin  = ref('')
const nameError = ref('')
const pinError  = ref('')
const pinPadRef = ref<InstanceType<typeof PinPad> | null>(null)
const saving    = ref(false)
const perms     = reactive<StaffPermissions>({
  ...DEFAULT_CASHIER_PERMISSIONS,
  ...(props.editStaff?.permissions ?? {}),
})

const stepLabel = computed(() => {
  if (step.value === 'info')    return ''
  if (step.value === 'pin')     return isEdit.value ? 'أدخل الرقم السري الجديد' : 'أنشئ رقماً سرياً (4 أرقام)'
  return 'أكّد الرقم السري'
})

const PERM_LABELS: Array<[keyof StaffPermissions, string]> = [
  ['can_view_reports',     'عرض التقارير'],
  ['can_manage_products',  'إدارة المنتجات'],
  ['can_manage_customers', 'إدارة الزبائن'],
  ['can_view_expenses',    'عرض المصاريف'],
  ['can_manage_settings',  'الإعدادات'],
]

function submitInfo() {
  if (!name.value.trim()) { nameError.value = 'يرجى إدخال الاسم'; return }
  nameError.value = ''
  step.value = 'pin'
}

// Edit mode: save name/role/permissions without touching the PIN.
async function saveEdits() {
  if (!props.editStaff) return
  if (!name.value.trim()) { nameError.value = 'يرجى إدخال الاسم'; return }
  nameError.value = ''
  saving.value = true
  try {
    await updateStaff(props.editStaff.id, {
      name: name.value.trim(),
      role: role.value,
      permissions: { ...perms },
    })
    emit('done')
  } finally {
    saving.value = false
  }
}

function onPin(pin: string) {
  if (step.value === 'pin') {
    firstPin.value = pin
    step.value     = 'confirm'
    return
  }
  if (pin !== firstPin.value) {
    pinError.value = 'الرقمان لا يتطابقان'
    pinPadRef.value?.shake()
    step.value     = 'pin'
    firstPin.value = ''
    return
  }
  saveStaff(pin)
}

async function saveStaff(pin: string) {
  saving.value = true
  try {
    if (props.editStaff) {
      await updateStaffPin(props.editStaff.id, pin)
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
  <div class="form-root" dir="rtl">

    <!-- Step 1: Info (new staff only) -->
    <template v-if="step === 'info'">
      <div class="fields-section">

        <div class="field-group">
          <label class="field-label">اسم الموظف</label>
          <input
            v-model="name"
            @input="nameError = ''"
            @keydown.enter="submitInfo"
            class="field-input"
            :class="{ 'field-input-error': nameError }"
            placeholder="مثال: أحمد خالد"
            autofocus
          />
          <p v-if="nameError" class="field-error-msg">{{ nameError }}</p>
        </div>

        <div v-if="!forceRole" class="field-group">
          <label class="field-label">الدور الوظيفي</label>
          <div class="role-toggle">
            <button
              @click="role = 'cashier'"
              :class="['role-btn', role === 'cashier' ? 'role-active' : 'role-idle']"
              type="button"
            >كاشير</button>
            <button
              @click="role = 'owner'"
              :class="['role-btn', role === 'owner' ? 'role-active' : 'role-idle']"
              type="button"
            >مالك</button>
          </div>
        </div>

        <div v-if="role === 'cashier' && !forceRole" class="perms-card">
          <p class="perms-title">الصلاحيات</p>
          <label v-for="[key, label] in PERM_LABELS" :key="key" class="perm-row">
            <span class="perm-label">{{ label }}</span>
            <div class="checkbox-wrap" :class="{ 'checkbox-checked': (perms as any)[key] }">
              <input type="checkbox" v-model="(perms as any)[key]" class="sr-only" />
              <svg v-if="(perms as any)[key]" width="11" height="11" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          </label>
        </div>

        <!-- Edit mode: save changes + optional PIN change -->
        <template v-if="isEdit">
          <button @click="saveEdits" class="btn-next" type="button" :disabled="saving">
            {{ saving ? 'جاري الحفظ...' : 'حفظ التغييرات' }}
          </button>
          <button @click="step = 'pin'; pinError = ''" class="btn-secondary" type="button">
            تغيير الرقم السري
          </button>
        </template>

        <!-- Add mode: continue to PIN -->
        <button v-else @click="submitInfo" class="btn-next" type="button">
          التالي — تعيين الرقم السري
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
        </button>
      </div>
    </template>

    <!-- Step 2 & 3: PIN entry -->
    <template v-else>
      <p class="pin-step-label">{{ stepLabel }}</p>
      <p v-if="pinError" class="pin-error">{{ pinError }}</p>
      <PinPad ref="pinPadRef" @complete="onPin" />

      <button
        v-if="!forceRole"
        @click="step = 'info'; firstPin = ''; pinError = ''"
        class="btn-back"
        type="button"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
        رجوع
      </button>
    </template>

  </div>
</template>

<style scoped>
.form-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
}

.fields-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  color: #637285;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.field-input {
  width: 100%;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  color: #E8EDF5;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.field-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.22), 0 0 10px rgba(26,86,219,0.12);
}

.field-input::placeholder { color: #3D4F6B; }

.field-input-error { border-color: rgba(239,68,68,0.6) !important; }

.field-error-msg {
  font-size: 12px;
  color: #EF4444;
}

.role-toggle {
  display: flex;
  gap: 6px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 3px;
}

.role-btn {
  flex: 1;
  height: 36px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.role-active {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: white;
  box-shadow: 0 2px 8px rgba(26,86,219,0.35);
}

.role-idle {
  background: transparent;
  color: #637285;
}

.role-idle:hover { color: #C8D5E8; background: rgba(255,255,255,0.05); }

.perms-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.07), rgba(255,255,255,0.02));
  border: 1px solid rgba(26,86,219,0.16);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.perms-title {
  font-size: 10px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.perm-label { font-size: 13px; color: #C8D5E8; }

.checkbox-wrap {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1.5px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.checkbox-checked {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border-color: #1A56DB;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
}

.btn-next {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 4px 14px rgba(26,86,219,0.38);
  border: none;
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
  margin-top: 2px;
}

.btn-secondary {
  width: 100%;
  height: 42px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #60A5FA;
  background: rgba(26,86,219,0.12);
  border: 1px solid rgba(26,86,219,0.30);
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.btn-secondary:hover { background: rgba(26,86,219,0.20); }

/* PIN step */
.pin-step-label {
  font-size: 15px;
  font-weight: 600;
  color: #E8EDF5;
  text-align: center;
}

.pin-error {
  font-size: 12px;
  color: #EF4444;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.22);
  border-radius: 8px;
  padding: 7px 14px;
  width: 100%;
  text-align: center;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #637285;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: 'Tajawal', system-ui, sans-serif;
  margin-top: 4px;
}

.btn-back:hover { color: #C8D5E8; }
</style>
