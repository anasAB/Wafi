<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { FLAG_LABELS, type FlagKey } from './flagRegistry'

// WAFI-131: clean upgrade teaser for a pack the shop hasn't subscribed to —
// never a broken screen. Data keeps syncing; only the UI is gated.
const route  = useRoute()
const router = useRouter()

const packLabel = computed(() => {
  const key = route.query.f as FlagKey | undefined
  return (key && FLAG_LABELS[key]) || 'باقة إضافية'
})
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="ميزة غير مفعّلة" :show-back="true" @back="router.push('/pos')" />
    <main class="main-content">
      <div class="card">
        <div class="lock-icon">🔒</div>
        <p class="card-title">هذه الميزة ضمن {{ packLabel }}</p>
        <p class="card-sub">
          الباقة غير مفعّلة لمتجرك حالياً. تواصل معنا لتفعيلها — بياناتك محفوظة
          وستظهر فور التفعيل.
        </p>
        <button type="button" class="btn-primary" @click="router.push('/pos')">العودة للبيع</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page-root { display: flex; flex-direction: column; min-height: 100dvh; background: #06090F; font-family: 'Tajawal', system-ui, sans-serif; color: #E8EDF5; }
.main-content { flex: 1; padding: 1rem; display: flex; align-items: center; justify-content: center; }
.card { width: 100%; max-width: 26rem; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 2rem 1.5rem; border-radius: 1rem; background: #0D1828; border: 1px solid rgba(255,255,255,0.07); text-align: center; }
.lock-icon { font-size: 2rem; }
.card-title { margin: 0; font-size: 1rem; font-weight: 700; }
.card-sub { margin: 0; font-size: 0.8125rem; color: #637285; line-height: 1.6; }
.btn-primary { width: 100%; height: 44px; border-radius: 0.75rem; background: linear-gradient(135deg, #1A56DB, #1248B3); color: #fff; font-size: 0.875rem; font-weight: 700; border: none; cursor: pointer; margin-top: 0.5rem; font-family: inherit; }
</style>
