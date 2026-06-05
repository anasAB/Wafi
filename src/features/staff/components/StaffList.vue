<script setup lang="ts">
import { ref, onMounted }  from 'vue'
import { useStaff }        from '../composables/useStaff'
import StaffForm           from './StaffForm.vue'
import type { Staff }      from '../staff.types'

const { staff, loadStaff, deactivateStaff } = useStaff()
const showForm    = ref(false)
const editStaffId = ref<string | undefined>()

onMounted(() => loadStaff())

function startEdit(s: Staff) { editStaffId.value = s.id; showForm.value = true }
function startAdd()          { editStaffId.value = undefined; showForm.value = true }

async function deactivate(s: Staff) {
  if (!confirm(`هل تريد إلغاء تفعيل ${s.name}؟`)) return
  await deactivateStaff(s.id)
}

function onFormDone() { showForm.value = false; loadStaff() }
</script>

<template>
  <div class="staff-root" dir="rtl">
    <!-- Header -->
    <div class="staff-header">
      <div>
        <h1 class="staff-title">الموظفون</h1>
        <p class="staff-subtitle">إدارة فريق العمل والصلاحيات</p>
      </div>
      <button @click="startAdd" class="btn-primary">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        إضافة موظف
      </button>
    </div>

    <!-- Staff list -->
    <div class="staff-list">
      <div v-for="s in staff" :key="s.id" class="staff-card">
        <!-- Avatar + info -->
        <div class="staff-identity">
          <div class="staff-avatar">{{ s.name.charAt(0) }}</div>
          <div>
            <p class="staff-name">{{ s.name }}</p>
            <span :class="['role-badge', s.role === 'owner' ? 'role-owner' : 'role-cashier']">
              {{ s.role === 'owner' ? 'مالك' : 'كاشير' }}
            </span>
          </div>
        </div>
        <!-- Actions -->
        <div class="staff-actions" v-if="s.role !== 'owner'">
          <button @click="startEdit(s)" class="btn-edit">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
            تغيير PIN
          </button>
          <button @click="deactivate(s)" class="btn-danger">
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

      <!-- Empty state -->
      <div v-if="staff.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" fill="none" stroke="#3D4F6B" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </div>
        <p class="empty-text">لا يوجد موظفون بعد</p>
        <p class="empty-sub">أضف أول موظف لمنحه صلاحيات الوصول</p>
      </div>
    </div>

    <!-- Form modal -->
    <Teleport to="body">
      <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
        <div class="modal-panel">
          <div class="modal-header">
            <h2 class="modal-title">{{ editStaffId ? 'تغيير الرقم السري' : 'موظف جديد' }}</h2>
            <button @click="showForm = false" class="close-btn">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <StaffForm :edit-staff-id="editStaffId" @done="onFormDone" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.staff-root {
  padding: 20px 16px 80px;
  max-width: 600px;
  margin: 0 auto;
  background: #06090F;
  min-height: 100vh;
}

.staff-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}

.staff-title {
  font-size: 20px;
  font-weight: 800;
  color: #E8EDF5;
  margin-bottom: 2px;
}

.staff-subtitle {
  font-size: 12px;
  color: #637285;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding-inline: 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 4px 14px rgba(26,86,219,0.40);
  border: none;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.staff-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.staff-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  border-radius: 14px;
  box-shadow: 0 4px 16px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.07);
}

.staff-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.staff-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(26,86,219,0.25), rgba(26,86,219,0.12));
  border: 1px solid rgba(26,86,219,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 800;
  color: #60A5FA;
  flex-shrink: 0;
}

.staff-name {
  font-size: 14px;
  font-weight: 600;
  color: #E8EDF5;
  margin-bottom: 4px;
}

.role-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 20px;
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
  gap: 8px;
  flex-shrink: 0;
}

.btn-edit {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding-inline: 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #C8D5E8;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  cursor: pointer;
  transition: background 0.15s;
}

.btn-edit:hover {
  background: rgba(255,255,255,0.10);
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding-inline: 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #EF4444;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.25);
  cursor: pointer;
  transition: background 0.15s;
}

.btn-danger:hover {
  background: rgba(239,68,68,0.14);
}

.owner-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  color: #F59E0B;
  flex-shrink: 0;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 40px 20px;
}

.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.02));
  border: 1px solid rgba(26,86,219,0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.empty-text {
  font-size: 15px;
  font-weight: 600;
  color: #637285;
  margin-bottom: 4px;
}

.empty-sub {
  font-size: 12px;
  color: #3D4F6B;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 16px;
}

.modal-panel {
  width: 100%;
  max-width: 340px;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 20px;
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
  padding: 20px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(26,86,219,0.18);
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: #E8EDF5;
}

.close-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  color: #637285;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.close-btn:hover {
  background: rgba(255,255,255,0.10);
  color: #E8EDF5;
}
</style>
