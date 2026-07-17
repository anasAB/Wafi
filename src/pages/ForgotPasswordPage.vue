<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div dir="rtl" class="forgot-password">
    <h1>نسيت كلمة المرور؟</h1>
    <p>
      لأسباب أمنية، لا يمكن إعادة تعيين كلمة المرور تلقائياً حالياً.
      تواصل مع فريق الدعم عبر واتساب وسنساعدك على استعادة الوصول لحسابك خلال دقائق.
    </p>
    <button type="button" @click="router.push('/login')">العودة لتسجيل الدخول</button>
  </div>
</template>
