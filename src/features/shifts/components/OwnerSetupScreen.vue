<script setup lang="ts">
import { useRouter }  from 'vue-router'
import StaffForm      from '@/features/staff/components/StaffForm.vue'

const router = useRouter()

function onDone() {
  router.push('/')
}
</script>

<template>
  <div class="fixed inset-0 bg-[#06090F] flex flex-col items-center justify-center p-6" dir="rtl">
    <div class="text-white text-3xl font-bold mb-2">وافي</div>
    <p class="text-[#637285] mb-8 text-sm text-center">إعداد أول مرة — أنشئ حساب المالك</p>
    <div class="w-full max-w-sm bg-[#0D1828] rounded-3xl p-6">
      <StaffForm @done="onDone" />
    </div>
  </div>
</template>
