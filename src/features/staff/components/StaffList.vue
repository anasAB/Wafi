<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useStaff } from '../composables/useStaff'
import StaffForm from './StaffForm.vue'
import type { Staff } from '../staff.types'

const router = useRouter()

const { staff, loadStaff, deactivateStaff } = useStaff()
const showForm = ref(false)
const editStaff = ref<Staff | undefined>()
const deactivateTarget = ref<Staff | null>(null)

const activeStaffCount = computed(() => staff.value.length)

onMounted(() => loadStaff())

function startEdit(s: Staff) {
  editStaff.value = s
  showForm.value = true
}

function startAdd() {
  editStaff.value = undefined
  showForm.value = true
}

function requestDeactivate(s: Staff) {
  deactivateTarget.value = s
}

async function confirmDeactivate() {
  if (!deactivateTarget.value) return
  await deactivateStaff(deactivateTarget.value.id)
  deactivateTarget.value = null
  await loadStaff()
}

async function onFormDone() {
  showForm.value = false
  await loadStaff()
}
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="الموظفون" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <div class="intro-card">
      <p class="intro-title">إدارة الموظفين</p>
      <p class="intro-sub">إضافة الفريق وتحديث الصلاحيات والرقم السري</p>
    </div>

    <div class="summary-row">
      <span class="summary-label">إجمالي الموظفين</span>
      <span class="summary-value">{{ activeStaffCount }}</span>
    </div>

    <div class="actions-row">
      <button type="button" class="btn-primary" @click="startAdd">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        إضافة موظف
      </button>
    </div>

    <p class="section-label">الفريق</p>
    <div class="settings-card" v-if="staff.length">
      <div v-for="(s, idx) in staff" :key="s.id" class="staff-row" :class="{ 'staff-row--last': idx === staff.length - 1 }">
        <div class="staff-identity">
          <div class="staff-avatar">{{ s.name.charAt(0) }}</div>
          <div class="staff-main">
            <p class="staff-name">{{ s.name }}</p>
            <span :class="['role-badge', s.role === 'owner' ? 'role-owner' : 'role-cashier']">
              {{ s.role === 'owner' ? 'مالك' : 'كاشير' }}
            </span>
          </div>
        </div>

        <div class="staff-actions" v-if="s.role !== 'owner'">
          <button type="button" class="btn-edit" @click="startEdit(s)">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
            تعديل
          </button>
          <button type="button" class="btn-danger" @click="requestDeactivate(s)">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
            </svg>
            إلغاء
          </button>
        </div>

        <div v-else class="owner-badge">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>
          مالك
        </div>
      </div>
    </div>

    <div v-else class="empty-card">
      <div class="empty-icon-wrap">
        <svg width="28" height="28" fill="none" stroke="#3D4F6B" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      </div>
      <p class="empty-title">لا يوجد موظفون بعد</p>
      <p class="empty-sub">أضف أول موظف لمنحه صلاحيات الوصول</p>
      <button type="button" class="btn-primary" @click="startAdd">إضافة موظف</button>
    </div>
  </div>

  <BaseModal v-if="showForm" :title="editStaff ? 'تعديل الموظف' : 'موظف جديد'" @close="showForm = false">
    <StaffForm :edit-staff="editStaff" @done="onFormDone" />
  </BaseModal>

  <AppDialog
    v-if="deactivateTarget"
    title="إلغاء تفعيل الموظف"
    :message="`هل تريد إلغاء تفعيل ${deactivateTarget.name}؟`"
    confirm-label="إلغاء التفعيل"
    cancel-label="رجوع"
    danger
    @confirm="confirmDeactivate"
    @cancel="deactivateTarget = null"
  />
</template>

<style scoped>
.page-body {
  padding: 16px;
  max-width: 560px;
  margin: 0 auto;
  width: 100%;
  padding-bottom: 80px;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 1024px) {
  .page-body {
    padding: 20px;
    max-width: none;
  }
}

.intro-card {
  margin-bottom: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.intro-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #E8EDF5;
}

.intro-sub {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: #637285;
}

.summary-row {
  margin-bottom: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 0.75rem;
  border: 1px solid rgba(26,86,219,0.2);
  background: rgba(26,86,219,0.09);
  padding: 0.55rem 0.75rem;
}

.summary-label {
  color: #637285;
  font-size: 0.78rem;
  font-weight: 700;
}

.summary-value {
  color: #E8EDF5;
  font-size: 0.88rem;
  font-weight: 800;
}

.actions-row {
  margin-bottom: 0.7rem;
  display: flex;
  justify-content: flex-start;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 40px;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  border: none;
  padding-inline: 0.9rem;
  border-radius: 0.625rem;
  font-weight: 700;
  font-size: 0.8125rem;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.35);
  font-family: inherit;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 8px 4px;
  margin-bottom: 6px;
}

.settings-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-radius: 1rem;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

.staff-row {
  padding: 0.8rem 0.95rem;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}

.staff-row--last {
  border-bottom: none;
}

.staff-identity {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.staff-main {
  min-width: 0;
}

.staff-avatar {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(26,86,219,0.25), rgba(26,86,219,0.12));
  border: 1px solid rgba(26,86,219,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  font-weight: 800;
  color: #60A5FA;
  flex-shrink: 0;
}

.staff-name {
  font-size: 0.875rem;
  font-weight: 700;
  color: #E8EDF5;
  margin: 0 0 0.2rem;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.67rem;
  font-weight: 700;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
}

.role-owner {
  background: rgba(245,158,11,0.12);
  border: 1px solid rgba(245,158,11,0.28);
  color: #F59E0B;
}

.role-cashier {
  background: rgba(26,86,219,0.12);
  border: 1px solid rgba(26,86,219,0.28);
  color: #60A5FA;
}

.staff-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}

.btn-edit,
.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 32px;
  padding-inline: 0.55rem;
  border-radius: 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid;
  font-family: inherit;
}

.btn-edit {
  color: #C8D5E8;
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.12);
}

.btn-edit:hover {
  background: rgba(255,255,255,0.1);
}

.btn-danger {
  color: #EF4444;
  background: rgba(239,68,68,0.08);
  border-color: rgba(239,68,68,0.25);
}

.btn-danger:hover {
  background: rgba(239,68,68,0.14);
}

.owner-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #F59E0B;
  flex-shrink: 0;
}

.empty-card {
  border-radius: 1rem;
  border: 1px solid rgba(26,86,219,0.2);
  background: rgba(26,86,219,0.08);
  padding: 2rem 1rem;
  text-align: center;
}

.empty-icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.02));
  border: 1px solid rgba(26,86,219,0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
}

.empty-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: #E8EDF5;
}

.empty-sub {
  margin: 0.35rem 0 1rem;
  font-size: 0.78rem;
  color: #637285;
}

@media (max-width: 639px) {
  .staff-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .staff-actions {
    width: 100%;
  }

  .btn-edit,
  .btn-danger {
    flex: 1;
    justify-content: center;
  }
}
</style>
