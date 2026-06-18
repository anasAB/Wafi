<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuditLog }   from '@/features/audit/composables/useAuditLog'
import { useSessionStore } from '@/store/session.store'
import { eventLabel, formatAuditTime } from '@/features/audit/audit.format'
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
</script>

<template>
  <section v-if="isOwner() && history.length > 0" class="history-card" dir="rtl">
    <p class="section-label">السجل</p>

    <div class="history-list">
      <div v-for="e in history" :key="e.id" class="history-row">
        <span class="history-label">{{ eventLabel(e) }}</span>
        <span class="history-meta">{{ e.staffName }} · {{ formatAuditTime(e.createdAt) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Matches the .form-section card used across the edit forms. */
.history-card {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(26,86,219,0.18);
  border-radius: 0.75rem;
  padding: 16px;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #637285;
  margin: 0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 0.625rem;
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(26,86,219,0.14);
}

.history-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: #E8EDF5;
}

.history-meta {
  /* Was 0.6875rem/#637285 — too small and dim to read. */
  font-size: 0.8125rem;
  color: #93A3B8;
}
</style>
