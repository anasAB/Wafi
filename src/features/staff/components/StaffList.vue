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
  <div class="p-4 max-w-lg mx-auto" dir="rtl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-white text-xl font-bold">الموظفون</h1>
      <button @click="startAdd"
        class="bg-[#1A56DB] text-white px-4 py-2 rounded-xl text-sm font-medium">
        + إضافة موظف
      </button>
    </div>

    <div class="flex flex-col gap-3">
      <div v-for="s in staff" :key="s.id"
        class="bg-[#0D1828] rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p class="text-white font-medium">{{ s.name }}</p>
          <span :class="['text-xs px-2 py-0.5 rounded-full mt-1 inline-block',
            s.role === 'owner' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400']">
            {{ s.role === 'owner' ? 'مالك' : 'كاشير' }}
          </span>
        </div>
        <div class="flex gap-2" v-if="s.role !== 'owner'">
          <button @click="startEdit(s)"
            class="text-[#637285] text-sm px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10">
            تغيير PIN
          </button>
          <button @click="deactivate(s)"
            class="text-red-400 text-sm px-3 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20">
            إلغاء
          </button>
        </div>
      </div>
    </div>

    <!-- Form modal -->
    <div v-if="showForm" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div class="bg-[#0D1828] rounded-3xl p-6 w-full max-w-sm mx-4">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-white font-semibold">{{ editStaffId ? 'تغيير الرقم السري' : 'موظف جديد' }}</h2>
          <button @click="showForm = false" class="text-[#637285]">✕</button>
        </div>
        <StaffForm :edit-staff-id="editStaffId" @done="onFormDone" />
      </div>
    </div>
  </div>
</template>
