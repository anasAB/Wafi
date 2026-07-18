<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useDevices, type ManagedDevice } from './composables/useDevices'

// WAFI-130: Settings → الأجهزة. List the shop's registered devices with human
// labels, code (= receipt prefix), last seen, temporary flag; rename and
// deactivate. Deactivation blocks NEW shifts on the target device after sync.
const router = useRouter()
const { devices, load, rename, setActive } = useDevices()

const loading      = ref(true)
const editingId    = ref<string | null>(null)
const editLabel    = ref('')
const confirmOff   = ref<ManagedDevice | null>(null)
const errorMessage = ref<string | null>(null)

onMounted(async () => {
  try { await load() } finally { loading.value = false }
})

function startRename(d: ManagedDevice) {
  editingId.value = d.id
  editLabel.value = d.label ?? ''
}

async function saveRename() {
  if (!editingId.value) return
  await rename(editingId.value, editLabel.value)
  editingId.value = null
}

async function toggleActive(d: ManagedDevice) {
  errorMessage.value = null
  if (d.isActive) { confirmOff.value = d; return }
  await setActive(d.id, true)
}

async function confirmDeactivate() {
  const d = confirmOff.value
  confirmOff.value = null
  if (!d) return
  try {
    await setActive(d.id, false)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'تعذّر إيقاف الجهاز'
  }
}

function fmtSeen(iso: string | null): string {
  if (!iso) return 'لم يُشاهد بعد'
  return new Intl.DateTimeFormat('ar-SY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="الأجهزة" :show-back="true" @back="router.back()" />
  </div>

  <div class="page-body" dir="rtl">
    <div class="intro-card">
      <p class="intro-title">أجهزة المتجر</p>
      <p class="intro-sub">
        كل جهاز يحمل رمزاً خاصاً يظهر في أرقام الفواتير. أوقف أي جهاز مفقود أو
        خارج الخدمة — لن يستطيع فتح وردية جديدة بعد المزامنة التالية.
      </p>
    </div>

    <div v-if="loading" class="empty-note">جارٍ التحميل…</div>

    <div v-else-if="devices.length === 0" class="empty-note">
      لا توجد أجهزة مسجلة بعد — يسجل كل جهاز نفسه تلقائياً عند أول استخدام.
    </div>

    <div v-else class="device-list">
      <div
        v-for="d in devices"
        :key="d.id"
        class="device-card"
        :class="{ 'device-card--off': !d.isActive }"
        :data-testid="`device-${d.code}`"
      >
        <div class="device-head">
          <span class="device-code" dir="ltr">{{ d.code }}</span>
          <span v-if="d.isThisDevice" class="chip chip--this">هذا الجهاز</span>
          <span v-if="d.isTemporary" class="chip chip--temp">رمز مؤقت</span>
          <span v-if="!d.isActive" class="chip chip--off">موقوف</span>
        </div>

        <template v-if="editingId === d.id">
          <div class="rename-row">
            <input
              v-model="editLabel"
              class="rename-input"
              placeholder="مثال: كاشير ١"
              data-testid="device-rename-input"
              @keydown.enter="saveRename"
            />
            <button type="button" class="btn-small btn-small--primary" @click="saveRename">حفظ</button>
            <button type="button" class="btn-small" @click="editingId = null">إلغاء</button>
          </div>
        </template>
        <template v-else>
          <p class="device-label">{{ d.label || 'بدون اسم' }}</p>
        </template>

        <p class="device-meta">آخر ظهور: {{ fmtSeen(d.lastSeenAt) }}</p>

        <div class="device-actions">
          <button type="button" class="btn-small" data-testid="device-rename" @click="startRename(d)">إعادة تسمية</button>
          <button
            type="button"
            class="btn-small"
            :class="d.isActive ? 'btn-small--danger' : 'btn-small--primary'"
            :disabled="d.isActive && d.isThisDevice"
            data-testid="device-toggle"
            @click="toggleActive(d)"
          >{{ d.isActive ? 'إيقاف' : 'إعادة تفعيل' }}</button>
        </div>
        <p v-if="d.isActive && d.isThisDevice" class="device-hint">لا يمكن إيقاف الجهاز الذي تستخدمه الآن</p>
      </div>
    </div>

    <p v-if="errorMessage" class="error-note" role="alert">{{ errorMessage }}</p>
  </div>

  <AppDialog
    v-if="confirmOff"
    title="إيقاف الجهاز"
    :message="`سيُمنع الجهاز ${confirmOff.code} من فتح ورديات جديدة بعد مزامنته التالية. بياناته تبقى محفوظة. متابعة؟`"
    confirm-label="نعم، أوقفه"
    cancel-label="إلغاء"
    :danger="true"
    @confirm="confirmDeactivate"
    @cancel="confirmOff = null"
  />
</template>

<style scoped>
.page-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; font-family: 'Tajawal', system-ui, sans-serif; color: #E8EDF5; }
.intro-card { border-radius: 1rem; background: #0D1828; border: 1px solid rgba(255,255,255,0.07); padding: 1rem; }
.intro-title { margin: 0; font-size: 0.9375rem; font-weight: 700; }
.intro-sub { margin: 0.25rem 0 0; font-size: 0.75rem; color: #637285; line-height: 1.6; }

.empty-note { padding: 2rem 1rem; text-align: center; font-size: 0.8125rem; color: #637285; }

.device-list { display: flex; flex-direction: column; gap: 0.625rem; }
.device-card { border-radius: 1rem; background: #0D1828; border: 1px solid rgba(255,255,255,0.07); padding: 0.875rem 1rem; display: flex; flex-direction: column; gap: 0.375rem; }
.device-card--off { opacity: 0.72; border-color: rgba(239,68,68,0.28); }

.device-head { display: flex; align-items: center; gap: 0.5rem; }
.device-code { font-family: monospace; font-size: 1rem; font-weight: 800; color: #60A5FA; background: rgba(26,86,219,0.12); border: 1px solid rgba(26,86,219,0.35); border-radius: 8px; padding: 1px 10px; }
.chip { font-size: 0.625rem; font-weight: 700; border-radius: 9999px; padding: 2px 8px; }
.chip--this { color: #4ADE80; background: rgba(22,101,52,0.22); border: 1px solid rgba(34,197,94,0.32); }
.chip--temp { color: #FBBF24; background: rgba(120,80,8,0.22); border: 1px solid rgba(251,191,36,0.30); }
.chip--off  { color: #FCA5A5; background: rgba(127,29,29,0.26); border: 1px solid rgba(239,68,68,0.38); }

.device-label { margin: 0; font-size: 0.875rem; font-weight: 700; }
.device-meta { margin: 0; font-size: 0.6875rem; color: #637285; }
.device-hint { margin: 0; font-size: 0.6875rem; color: #637285; }

.device-actions { display: flex; gap: 0.5rem; margin-top: 0.25rem; }
.btn-small { height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.05); color: #A8B8CC; font-family: inherit; font-size: 0.75rem; font-weight: 700; cursor: pointer; }
.btn-small:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-small--primary { color: #fff; background: #1A56DB; border-color: #1A56DB; }
.btn-small--danger { color: #FCA5A5; background: rgba(127,29,29,0.3); border-color: rgba(239,68,68,0.4); }

.rename-row { display: flex; gap: 0.5rem; }
.rename-input { flex: 1; height: 36px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 0 0.75rem; color: #E8EDF5; font-size: 0.8125rem; font-family: inherit; outline: none; }
.rename-input:focus { border-color: rgba(26,86,219,0.8); }

.error-note { margin: 0; border-radius: 0.75rem; border: 1px solid rgba(239,68,68,0.38); background: rgba(127,29,29,0.24); color: #FCA5A5; font-size: 0.8125rem; padding: 0.625rem 0.875rem; }
</style>
