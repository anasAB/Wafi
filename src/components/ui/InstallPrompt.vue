<script setup lang="ts">
import { ref } from 'vue'
import { useInstallPrompt } from '@/composables/useInstallPrompt'

const { canInstall, isIosSafari, promptInstall } = useInstallPrompt()
const dismissed = ref(false)

async function onInstall() {
  await promptInstall()
}
</script>

<template>
  <div v-if="!dismissed && (canInstall || isIosSafari)" class="install-prompt" dir="rtl">
    <button
      v-if="canInstall"
      type="button"
      data-testid="install-btn"
      class="install-btn"
      @click="onInstall"
    >ثبّت التطبيق</button>
    <p v-else data-testid="install-hint" class="install-hint">
      للتثبيت: اضغط مشاركة ← إضافة إلى الشاشة الرئيسية
    </p>
    <button
      type="button"
      class="install-dismiss"
      aria-label="إغلاق"
      @click="dismissed = true"
    >×</button>
  </div>
</template>

<style scoped>
.install-prompt {
  display: flex; align-items: center; gap: 10px;
  margin-top: 14px; padding: 10px 14px;
  background: rgba(26,86,219,0.10);
  border: 1px solid rgba(26,86,219,0.30);
  border-radius: 12px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.install-btn {
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff; border: none; border-radius: 10px;
  padding: 8px 16px; font-weight: 700; font-size: 14px; cursor: pointer;
}
.install-hint { color: #C8D5E8; font-size: 13px; flex: 1; }
.install-dismiss {
  margin-inline-start: auto; background: transparent; border: none;
  color: #637285; font-size: 18px; cursor: pointer; line-height: 1;
}
</style>
