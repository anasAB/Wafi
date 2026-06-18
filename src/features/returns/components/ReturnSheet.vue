<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppToast from '@/components/ui/AppToast.vue'
import ReturnLineItem from './ReturnLineItem.vue'
import AuditHistory from '@/features/audit/components/AuditHistory.vue'
import { useReturnSheet } from '../composables/useReturnSheet'
import { useReturnReasons } from '../composables/useReturnReasons'
import type { RefundMethod, ReturnLine } from '../returns.types'

const props = defineProps<{ saleId: string; saleNumber: string }>()
const emit  = defineEmits<{ (e: 'close'): void; (e: 'confirmed'): void }>()

const { lines, refundMethod, reason, notes, hasCustomer, customerName, refundTotalUsd, refundTotalSyp, canConfirm, load, confirm } =
  useReturnSheet(props.saleId)
const { reasons, loadReasons } = useReturnReasons()

const loading        = ref(false)
const toast          = ref<string | null>(null)
const toastType      = ref<'info' | 'error'>('info')
const confirmed      = ref(false)
const selectedReason = ref('')

onMounted(async () => {
  loading.value = true
  await Promise.all([load(), loadReasons()])
  loading.value = false
})

function updateLine(index: number, updated: ReturnLine) {
  lines.value[index] = updated
}

function selectReason(label: string) {
  selectedReason.value = selectedReason.value === label ? '' : label
  reason.value         = selectedReason.value
}

const REFUND_METHODS: { value: RefundMethod; label: string }[] = [
  { value: 'cash_usd',      label: 'نقد $'        },
  { value: 'cash_syp',      label: 'نقد ل.س'      },
  { value: 'store_credit',  label: 'رصيد حساب'   },
  { value: 'transfer',      label: 'حوالة'         },
]

async function handleConfirm() {
  if (!canConfirm.value) return
  loading.value = true
  try {
    await confirm()
    confirmed.value = true
    toastType.value = 'info'
    toast.value     = 'تم تسجيل المرتجع'
    emit('confirmed')
  } catch (e) {
    toastType.value = 'error'
    toast.value     = e instanceof Error ? e.message : 'حدث خطأ'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="sheet-backdrop" @click.self="emit('close')">
    <div class="sheet" dir="rtl">
      <!-- Handle -->
      <div class="sheet-handle-wrap"><div class="sheet-handle" /></div>

      <!-- Header -->
      <div class="sheet-header">
        <div class="sheet-header-main">
          <div class="sheet-header-text">
            <span class="sheet-title">مرتجع — فاتورة {{ saleNumber }}</span>
            <span class="sheet-sub">اختر المنتجات والكميات المراد إرجاعها</span>
            <!-- Which customer this sale belonged to (#8) -->
            <span v-if="customerName" class="sheet-customer">الزبون: <strong>{{ customerName }}</strong></span>
            <span v-else class="sheet-customer sheet-customer--walkin">زبون عابر — أضف اسمه في الملاحظة إن لزم</span>
          </div>
          <button type="button" class="close-btn" aria-label="إغلاق" @click="emit('close')">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Spinner while loading -->
      <div v-if="loading && lines.length === 0" class="sheet-spinner-wrap">
        <div class="spinner" />
      </div>

      <template v-else>
        <!-- Scrollable item list + reason -->
        <div class="sheet-scroll">
          <ReturnLineItem
            v-for="(line, i) in lines"
            :key="line.productId"
            :line="line"
            @update:line="updateLine(i, $event)"
          />

          <!-- Reason area -->
          <div class="sheet-reason">
            <div class="sheet-reason-label">السبب (اختياري)</div>
            <div v-if="reasons.length > 0" class="reason-chips">
              <button
                v-for="r in reasons"
                :key="r.id"
                type="button"
                class="reason-chip"
                :class="{ 'reason-chip--active': selectedReason === r.label }"
                @click="selectReason(r.label)"
              >
                {{ r.label }}
              </button>
            </div>
            <input
              v-model="notes"
              class="reason-input"
              placeholder="ملاحظة حرة..."
            />
          </div>
        </div>

        <AuditHistory entity-type="return" :entity-id="saleId" />

        <!-- Fixed footer -->
        <div class="sheet-footer">
          <div class="refund-total-row">
            <span class="refund-total-label">إجمالي الاسترداد</span>
            <span class="refund-total-value" dir="ltr">
              {{ refundMethod === 'cash_syp' ? `${refundTotalSyp.toLocaleString()} ل.س` : `$${refundTotalUsd.toFixed(2)}` }}
            </span>
          </div>

          <div class="method-label">طريقة الاسترداد</div>
          <div class="method-buttons">
            <button
              v-for="m in REFUND_METHODS"
              :key="m.value"
              type="button"
              class="method-btn"
              :class="{ 'method-btn--active': refundMethod === m.value }"
              :disabled="m.value === 'store_credit' && !hasCustomer"
              @click="refundMethod = m.value"
            >
              {{ m.label }}
            </button>
          </div>

          <!-- Post-confirm: print option -->
          <div v-if="confirmed" class="post-confirm">
            <button type="button" class="btn-print" @click="emit('close')">
              طباعة إيصال المرتجع
            </button>
          </div>

          <div v-else class="sheet-actions">
            <button type="button" class="btn-cancel" @click="emit('close')">إلغاء</button>
            <button
              type="button"
              class="btn-confirm"
              :disabled="!canConfirm || loading"
              @click="handleConfirm"
            >
              <span v-if="loading" class="spinner-sm" />
              <span v-else>تأكيد الإرجاع</span>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>

<style scoped>
.sheet-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
  font-family: 'Tajawal', system-ui, sans-serif;
}
@media (min-width: 640px) {
  .sheet-backdrop { align-items: center; }
}
.sheet {
  width: calc(100% - 16px);
  max-width: 36rem;
  max-height: 90dvh;
  margin: 0 8px calc(8px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06)), #0D1828;
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 1.25rem;
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}
@media (min-width: 640px) {
  .sheet {
    width: 100%;
    margin: 0;
  }
}
.sheet-handle-wrap { display: flex; justify-content: center; padding: 10px 0 4px; }
.sheet-handle { width: 2.25rem; height: 0.25rem; border-radius: 9999px; background: rgba(255,255,255,0.20); }
.sheet-header {
  padding: 8px 16px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.sheet-header-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.sheet-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-title { font-size: 16px; font-weight: 700; color: #E8EDF5; }
.sheet-sub   { font-size: 12px; color: #637285; }
.sheet-customer { font-size: 12px; color: #C8D5E8; margin-top: 2px; }
.sheet-customer strong { color: #60A5FA; font-weight: 700; }
.sheet-customer--walkin { color: #F59E0B; }

.close-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #637285;
  background: rgba(255,255,255,0.06);
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}

.close-btn:hover {
  background: rgba(255,255,255,0.10);
  color: #E8EDF5;
}

.sheet-scroll { flex: 1; overflow-y: auto; }
.sheet-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(96,165,250,0.55) rgba(255,255,255,0.06);
}

.sheet-scroll::-webkit-scrollbar {
  width: 10px;
}

.sheet-scroll::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.06);
}

.sheet-scroll::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96,165,250,0.75), rgba(26,86,219,0.75));
  border-radius: 999px;
  border: 2px solid rgba(7,11,20,0.8);
}

.sheet-scroll::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147,197,253,0.9), rgba(59,130,246,0.9));
}

.sheet-spinner-wrap { flex: 1; display: flex; justify-content: center; align-items: center; padding: 40px; }
.spinner {
  width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid rgba(26,86,219,0.3); border-top-color: #1A56DB;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.spinner-sm {
  display: inline-block; width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
  animation: spin 0.8s linear infinite;
}
.sheet-reason {
  margin: 10px 12px 14px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(255,255,255,0.03);
}
.sheet-reason-label { font-size: 12px; color: #637285; margin-bottom: 6px; }
.reason-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.reason-chip {
  padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer;
  background: rgba(26,86,219,0.12); border: 1px solid rgba(26,86,219,0.22); color: #94A3B8;
  transition: background 0.15s, color 0.15s;
}
.reason-chip--active { background: #1A56DB; color: white; border-color: #1A56DB; }
.reason-input {
  width: 100%; height: 40px; background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.18); border-radius: 8px;
  padding: 8px 10px; color: #E8EDF5; font-size: 13px; font-family: inherit; box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.reason-input::placeholder { color: #3D4F6B; }
.reason-input:focus {
  border-color: rgba(96,165,250,0.7);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.18);
}
.sheet-footer {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 12px 16px 14px;
  background: linear-gradient(180deg, rgba(13,24,40,0.96), rgba(7,11,20,0.98));
}
.refund-total-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
.refund-total-label { font-size: 14px; color: #637285; }
.refund-total-value { font-size: 16px; font-weight: 700; color: #E8EDF5; }
.method-label { font-size: 12px; color: #637285; margin-bottom: 6px; }
.method-buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.method-btn {
  min-height: 36px;
  padding: 7px 6px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  background: rgba(26,86,219,0.10); border: 1px solid rgba(26,86,219,0.18); color: #637285;
  transition: background 0.15s, color 0.15s; font-family: inherit;
}
.method-btn--active { background: #1A56DB; color: white; border-color: #1A56DB; }
.method-btn:disabled { opacity: 0.3; cursor: default; }

.sheet-actions {
  display: grid;
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr);
  gap: 8px;
}

.btn-cancel {
  width: 100%;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.18);
  background: transparent;
  color: #E8EDF5;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}

.btn-confirm {
  width: 100%; min-height: 44px; padding: 10px 13px; border-radius: 10px;
  background: linear-gradient(135deg, #1A56DB, #1e40af);
  color: white; font-size: 15px; font-weight: 700; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  font-family: inherit;
}
.btn-confirm:disabled { opacity: 0.4; cursor: default; }
.btn-print {
  width: 100%; min-height: 44px; padding: 10px 13px; border-radius: 10px;
  background: transparent; border: 1px solid rgba(26,86,219,0.4);
  color: #60A5FA; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.post-confirm { display: flex; flex-direction: column; gap: 8px; }

@media (max-width: 420px) {
  .method-buttons {
    grid-template-columns: 1fr;
  }

  .sheet-actions {
    grid-template-columns: 1fr;
  }
}
</style>
