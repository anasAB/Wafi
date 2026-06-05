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
  <div class="form-root" dir="rtl">
    <!-- Name + role fields (new staff only) -->
    <template v-if="!editStaffId && !firstPin">
      <div class="fields-section">

        <!-- Name input -->
        <div class="field-group">
          <label class="field-label">اسم الموظف</label>
          <input
            v-model="name"
            @input="pinError = ''"
            class="field-input"
            placeholder="مثال: أحمد خالد"
          />
        </div>

        <!-- Role selector -->
        <div class="field-group">
          <label class="field-label">الدور الوظيفي</label>
          <div class="role-toggle">
            <button
              @click="role = 'cashier'"
              :class="['role-btn', role === 'cashier' ? 'role-active' : 'role-idle']"
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              كاشير
            </button>
            <button
              @click="role = 'owner'"
              :class="['role-btn', role === 'owner' ? 'role-active' : 'role-idle']"
            >
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
              </svg>
              مالك
            </button>
          </div>
        </div>

        <!-- Permissions (cashier only) -->
        <div v-if="role === 'cashier'" class="perms-card">
          <p class="perms-title">الصلاحيات</p>
          <label
            v-for="[key, label] in PERM_LABELS"
            :key="key"
            class="perm-row"
          >
            <span class="perm-label">{{ label }}</span>
            <div class="checkbox-wrap" :class="{ 'checkbox-checked': (perms as any)[key] }">
              <input
                type="checkbox"
                v-model="(perms as any)[key]"
                class="sr-only"
              />
              <svg v-if="(perms as any)[key]" width="12" height="12" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          </label>
        </div>
      </div>
    </template>

    <!-- Pin step label -->
    <p class="pin-label">
      {{ pinStep === 'first'
        ? (editStaffId ? 'أدخل الرقم السري الجديد' : 'أنشئ رقماً سرياً (4 أرقام)')
        : 'أكّد الرقم السري' }}
    </p>
    <p v-if="pinError" class="pin-error">{{ pinError }}</p>

    <PinPad
      ref="pinPadRef"
      @complete="pinStep === 'first' ? onFirstPin($event) : onConfirmPin($event)"
    />
  </div>
</template>

<style scoped>
.form-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.fields-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  letter-spacing: 0.03em;
}

.field-input {
  width: 100%;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  color: #E8EDF5;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.field-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

.field-input::placeholder {
  color: #3D4F6B;
}

/* Role toggle */
.role-toggle {
  display: flex;
  gap: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 3px;
}

.role-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 38px;
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
  box-shadow: 0 2px 10px rgba(26,86,219,0.40);
}

.role-idle {
  background: transparent;
  color: #637285;
}

.role-idle:hover {
  color: #C8D5E8;
  background: rgba(255,255,255,0.05);
}

/* Permissions */
.perms-card {
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.18);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.perms-title {
  font-size: 11px;
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

.perm-label {
  font-size: 13px;
  color: #C8D5E8;
}

.checkbox-wrap {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1.5px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.checkbox-checked {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  border-color: #1A56DB;
  box-shadow: 0 2px 8px rgba(26,86,219,0.35);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
}

/* Pin step */
.pin-label {
  font-size: 15px;
  font-weight: 600;
  color: #E8EDF5;
  text-align: center;
}

.pin-error {
  font-size: 13px;
  color: #EF4444;
  text-align: center;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.25);
  border-radius: 8px;
  padding: 8px 14px;
  width: 100%;
}
</style>
