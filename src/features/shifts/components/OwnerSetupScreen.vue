<script setup lang="ts">
import { useRouter }  from 'vue-router'
import StaffForm      from '@/features/staff/components/StaffForm.vue'

const router = useRouter()

function onDone() {
  router.push('/')
}
</script>

<template>
  <div class="lock-root" dir="rtl">
    <div class="lock-card">
      <h1 class="brand">وافي</h1>
      <StaffForm force-role="owner" @done="onDone" />
    </div>
  </div>
</template>

<style scoped>
.lock-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.lock-card {
  width: 100%;
  max-width: 24rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1.5rem;
  border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.16), rgba(26, 86, 219, 0.06));
  border: 1px solid rgba(26, 86, 219, 0.40);
  box-shadow: 0 8px 48px rgba(26, 86, 219, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.09);
  text-align: center;
  gap: 0.5rem;
}

.brand {
  font-family: var(--font-display-ar, 'Tajawal'), serif;
  margin: 0;
  color: var(--color-gold-primary);
  font-size: 2.5rem;
  line-height: 1;
  font-weight: 800;
  margin-bottom: 1rem;
}
</style>
