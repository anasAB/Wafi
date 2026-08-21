<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useOwnerHealth } from './composables/useOwnerHealth'

const router = useRouter()
const { state, load } = useOwnerHealth()

onMounted(() => {
  load()
})

const STATUS_LABEL: Record<string, string> = {
  issue: 'Issue',
  attention: 'Attention',
  healthy: 'Healthy',
  'no-data': 'No recent health data',
  'timezone-not-configured': "Health monitoring isn't set up yet",
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="صحة النظام" @back="router.back()" />

    <main class="page-main">
      <div v-if="state.loading" class="status-loading">Loading…</div>

      <template v-else>
        <div
          class="status-card"
          :class="`status-${state.status}`"
        >
          <span class="status-dot" aria-hidden="true" />
          <span class="status-label">{{ STATUS_LABEL[state.status] }}</span>
        </div>

        <p v-if="state.status === 'timezone-not-configured'" class="status-hint">
          Configure your shop's timezone to start health monitoring.
        </p>

        <ul v-if="state.messages.length" class="message-list">
          <li v-for="(message, i) in state.messages" :key="i" class="message-item">
            {{ message }}
          </li>
        </ul>
      </template>
    </main>
  </div>
</template>

<style scoped>
.page-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.page-main {
  flex: 1;
  padding: 1rem;
}

.status-loading {
  padding: 2rem 0;
  text-align: center;
  opacity: 0.7;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-weight: 600;
}

.status-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  display: inline-block;
}

.status-issue .status-dot { background: #dc2626; }
.status-attention .status-dot { background: #d97706; }
.status-healthy .status-dot { background: #16a34a; }
.status-no-data .status-dot,
.status-timezone-not-configured .status-dot { background: #6b7280; }

.status-hint {
  margin-top: 0.75rem;
  opacity: 0.8;
}

.message-list {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0;
  list-style: none;
}

.message-item {
  padding: 0.6rem 0.85rem;
  border-radius: 0.4rem;
  background: rgba(13, 24, 40, 0.04);
}
</style>
