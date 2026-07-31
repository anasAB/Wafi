<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { openWhatsApp } from '@/features/messaging/whatsapp'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

const route = useRoute()
const description = ref('')
const { logWhatsAppComposed } = useAuditLog()

function send() {
  const supportPhone = import.meta.env.VITE_SUPPORT_WHATSAPP_PHONE as string | undefined
  if (!supportPhone) return

  const lines = [
    'تقرير مشكلة من تطبيق وافي',
    `الصفحة: ${route.path}`,
  ]
  if (description.value.trim()) {
    lines.push(`الوصف: ${description.value.trim()}`)
  }
  openWhatsApp(supportPhone, lines.join('\n'))
  logWhatsAppComposed('support_contact', null, true)
}
</script>

<template>
  <div dir="rtl" class="report-problem">
    <h1>الإبلاغ عن مشكلة</h1>
    <p>صف المشكلة باختصار (اختياري) وسنفتح واتساب لإرسال بلاغك لفريق الدعم.</p>
    <textarea v-model="description" rows="4" placeholder="مثال: البرنامج توقف عند تسجيل عملية بيع"></textarea>
    <button type="button" @click="send">إرسال عبر واتساب</button>
  </div>
</template>
