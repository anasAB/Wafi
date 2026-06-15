<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuditLog }   from '@/features/audit/composables/useAuditLog'
import { useSessionStore } from '@/store/session.store'
import type { AuditLog } from '@/features/audit/audit.types'

const props = defineProps<{ entityType: string; entityId: string }>()

const session   = useSessionStore()
const { loadEntityHistory } = useAuditLog()
const history   = ref<AuditLog[]>([])
const isOwner   = () => session.activeStaff?.role === 'owner'

async function load() {
  if (!isOwner()) return
  history.value = await loadEntityHistory(props.entityType, props.entityId)
}

onMounted(load)
watch(() => [props.entityType, props.entityId], load)

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
</script>

<template>
  <div v-if="isOwner() && history.length > 0" class="history-wrap" dir="rtl">
    <p class="history-heading">السجل</p>
    <div class="history-list">
      <div v-for="e in history" :key="e.id" class="history-row">
        <div class="history-dot" />
        <div class="history-body">
          <span class="history-event">{{ e.event }}</span>
          <span class="history-meta">{{ e.staffName }} · {{ formatTime(e.createdAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-wrap {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(26,86,219,0.15);
  font-family: 'Tajawal', system-ui, sans-serif;
}
.history-heading {
  font-size: 0.6875rem; font-weight: 700; color: #3D4F6B;
  text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem;
}
.history-list { display: flex; flex-direction: column; gap: 0.375rem; }
.history-row { display: flex; align-items: flex-start; gap: 0.5rem; }
.history-dot {
  width: 0.375rem; height: 0.375rem; border-radius: 50%;
  background: rgba(26,86,219,0.5); flex-shrink: 0; margin-top: 0.375rem;
}
.history-body { display: flex; flex-direction: column; gap: 0.0625rem; }
.history-event { font-size: 0.75rem; color: #C8D5E8; font-weight: 500; }
.history-meta  { font-size: 0.6875rem; color: #3D4F6B; }
</style>
