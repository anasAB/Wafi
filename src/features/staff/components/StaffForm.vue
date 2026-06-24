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

// WAFI-058: a manager runs the floor by default and sees NO financials. The
// owner can grant these two financial views per manager; everything else about
// the manager role is fixed (products/customers yes, settings no), so only
// these toggles appear. Plain-language labels, not accounting jargon.
const MANAGER_FINANCIAL_LABELS: Array<[keyof StaffPermissions, string]> = [
  ['can_view_reports',  'عرض التقارير والأرباح'],
  ['can_view_expenses', 'عرض المصاريف'],
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
              @click="role = 'manager'"
              :class="['role-btn', role === 'manager' ? 'role-active' : 'role-idle']"
              type="button"
            >مدير</button>
            <button
              @click="role = 'owner'"
              :class="['role-btn', role === 'owner' ? 'role-active' : 'role-idle']"
              type="button"
            >مالك</button>
          </div>
          <p v-if="role === 'manager'" class="role-hint">
            يدير المنتجات والتقارير والزبائن والمصاريف — لا يدير الموظفين أو الإعدادات.
          </p>
        </div>

        <div v-if="role === 'cashier' && !forceRole" class="perms-card">
          <p class="perms-title">الصلاحيات</p>
          <p class="perms-sub">حدّد ما يمكن لهذا الموظف الوصول إليه</p>
          <label
            v-for="[key, label] in PERM_LABELS"
            :key="key"
            class="perm-row"
            :class="{ 'perm-row--on': (perms as any)[key] }"
          >
            <span class="perm-label">{{ label }}</span>
            <input
              v-model="(perms as any)[key]"
              type="checkbox"
              class="perm-check"
            />
          </label>
        </div>

        <!-- WAFI-058: owner-only financial grants for a manager. Only the owner
             reaches this form (it lives behind can_manage_settings), so a manager
             can never grant themselves access. Both default off. -->
        <div v-if="role === 'manager'" class="perms-card">
          <p class="perms-title">الصلاحيات المالية</p>
          <p class="perms-sub">المدير يدير المنتجات والزبائن دائماً. هذه الصلاحيات المالية مغلقة افتراضياً — امنحها عند الحاجة فقط.</p>
          <label
            v-for="[key, label] in MANAGER_FINANCIAL_LABELS"
            :key="key"
            class="perm-row"
            :class="{ 'perm-row--on': (perms as any)[key] }"
          >
            <span class="perm-label">{{ label }}</span>
            <input
              v-model="(perms as any)[key]"
              type="checkbox"
              class="perm-check"
            />
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
      <div class="pin-step-card">
        <p class="pin-step-label">{{ stepLabel }}</p>
        <p class="pin-step-sub">لحماية الحساب، أدخل الرقم السري ثم أكده</p>
      </div>
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

.role-hint {
  font-size: 0.74rem;
  color: #8EA3BF;
  line-height: 1.5;
  margin: 0.1rem 0.1rem 0;
}

.perms-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.24);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.perms-title {
  font-size: 11px;
  font-weight: 700;
  color: #8EA3BF;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0;
}

.perms-sub {
  margin: 0.22rem 0 0.65rem;
  font-size: 0.74rem;
  color: #637285;
}

.perm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  border-top: 1px solid rgba(26,86,219,0.14);
  padding: 0.62rem 0.1rem;
  transition: background 0.15s;
}

.perm-row:hover {
  background: rgba(26,86,219,0.06);
}

.perm-row--on .perm-label {
  color: #E8EDF5;
}

.perm-label {
  font-size: 13px;
  color: #C8D5E8;
  font-weight: 600;
}

.perm-check {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 5px;
  border: 1px solid rgba(96,165,250,0.45);
  background: rgba(255,255,255,0.04);
  display: grid;
  place-items: center;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.perm-check::after {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(135deg, #60A5FA, #1A56DB);
  transform: scale(0);
  transition: transform 0.12s ease;
}

.perm-check:checked {
  border-color: rgba(96,165,250,0.9);
  background: rgba(26,86,219,0.20);
}

.perm-check:checked::after {
  transform: scale(1);
}

.perm-check:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(26,86,219,0.24);
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
  font-weight: 700;
  color: #E8EDF5;
  text-align: center;
}

.pin-step-card {
  width: 100%;
  border-radius: 10px;
  padding: 10px 12px 9px;
  background: linear-gradient(135deg, rgba(26,86,219,0.14), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.pin-brand-mini {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #60A5FA, #1A56DB);
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  box-shadow: 0 4px 12px rgba(26,86,219,0.34);
}

.pin-step-sub {
  margin: 0;
  font-size: 11px;
  color: #93A3B8;
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
