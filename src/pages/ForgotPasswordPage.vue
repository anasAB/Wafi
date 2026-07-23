<script setup lang="ts">
import { useRouter } from 'vue-router'
import { openWhatsApp } from '@/features/messaging/whatsapp'

const router = useRouter()

function contactSupport() {
  const supportPhone = import.meta.env.VITE_SUPPORT_WHATSAPP_PHONE as string | undefined
  if (!supportPhone) return
  openWhatsApp(supportPhone, 'أحتاج مساعدة في استعادة الوصول لحسابي (نسيت كلمة المرور).')
}
</script>

<template>
  <div dir="rtl" class="forgot-password">
    <h1>نسيت كلمة المرور؟</h1>
    <p>
      لأسباب أمنية، لا يمكن إعادة تعيين كلمة المرور تلقائياً حالياً.
      تواصل مع فريق الدعم عبر واتساب وسنساعدك على استعادة الوصول لحسابك خلال دقائق.
    </p>
    <button type="button" @click="contactSupport">تواصل عبر واتساب</button>
    <button type="button" @click="router.push('/login')">العودة لتسجيل الدخول</button>
  </div>
</template>
