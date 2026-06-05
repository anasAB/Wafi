<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppToast from '@/components/ui/AppToast.vue'
import ReturnLineItem from './ReturnLineItem.vue'
import { useReturnSheet } from '../composables/useReturnSheet'
import { useReturnReasons } from '../composables/useReturnReasons'
import type { RefundMethod, ReturnLine } from '../returns.types'

const props = defineProps<{ saleId: string; saleNumber: string }>()
const emit  = defineEmits<{ (e: 'close'): void; (e: 'confirmed'): void }>()

const { lines, refundMethod, reason, notes, hasCustomer, refundTotalUsd, canConfirm, load, confirm } =
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
        <span class="sheet-title">مرتجع — فاتورة {{ saleNumber }}</span>
        <span class="sheet-sub">اختر المنتجات والكميات المراد إرجاعها</span>
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

        <!-- Fixed footer -->
        <div class="sheet-footer">
          <div class="refund-total-row">
            <span class="refund-total-label">إجمالي الاسترداد</span>
            <span class="refund-total-value" dir="ltr">${{ refundTotalUsd.toFixed(2) }}</span>
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

          <button
            v-else
            type="button"
            class="btn-confirm"
            :disabled="!canConfirm || loading"
            @click="handleConfirm"
          >
            <span v-if="loading" class="spinner-sm" />
            <span v-else>تأكيد الإرجاع</span>
          </button>
        </div>
      </template>
    </div>
  </div>

  <AppToast v-if="toast" :message="toast" :type="toastType" @dismiss="toast = null" />
</template>

<style scoped>
.sheet-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: flex-end; z-index: 50;
}
.sheet {
  width: 100%; max-height: 90dvh; display: flex; flex-direction: column;
  background: #0D1828;
  border-top: 1px solid rgba(26,86,219,0.28);
  border-radius: 1.25rem 1.25rem 0 0;
  box-shadow: 0 -4px 32px rgba(26,86,219,0.18);
}
.sheet-handle-wrap { display: flex; justify-content: center; padding: 10px 0 4px; }
.sheet-handle { width: 40px; height: 4px; border-radius: 2px; background: #374151; }
.sheet-header {
  padding: 12px 16px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column; gap: 2px;
}
.sheet-title { font-size: 16px; font-weight: 700; color: #E8EDF5; }
.sheet-sub   { font-size: 12px; color: #637285; }
.sheet-scroll { flex: 1; overflow-y: auto; }
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
.sheet-reason { padding: 10px 16px; }
.sheet-reason-label { font-size: 12px; color: #637285; margin-bottom: 6px; }
.reason-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.reason-chip {
  padding: 4px 10px; border-radius: 20px; font-size: 12px; cursor: pointer;
  background: rgba(26,86,219,0.12); border: 1px solid rgba(26,86,219,0.22); color: #94A3B8;
  transition: background 0.15s, color 0.15s;
}
.reason-chip--active { background: #1A56DB; color: white; border-color: #1A56DB; }
.reason-input {
  width: 100%; background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.18); border-radius: 8px;
  padding: 8px 10px; color: #E8EDF5; font-size: 13px; font-family: inherit; box-sizing: border-box;
}
.reason-input::placeholder { color: #3D4F6B; }
.sheet-footer {
  border-top: 1px solid rgba(255,255,255,0.06);
  padding: 12px 16px; background: #0D1828;
}
.refund-total-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
.refund-total-label { font-size: 14px; color: #637285; }
.refund-total-value { font-size: 16px; font-weight: 700; color: #E8EDF5; }
.method-label { font-size: 12px; color: #637285; margin-bottom: 6px; }
.method-buttons { display: flex; gap: 6px; margin-bottom: 12px; }
.method-btn {
  flex: 1; padding: 7px 4px; border-radius: 8px; font-size: 12px; cursor: pointer;
  background: rgba(26,86,219,0.10); border: 1px solid rgba(26,86,219,0.18); color: #637285;
  transition: background 0.15s, color 0.15s; font-family: inherit;
}
.method-btn--active { background: #1A56DB; color: white; border-color: #1A56DB; }
.method-btn:disabled { opacity: 0.3; cursor: default; }
.btn-confirm {
  width: 100%; padding: 13px; border-radius: 10px;
  background: linear-gradient(135deg, #1A56DB, #1e40af);
  color: white; font-size: 15px; font-weight: 700; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  font-family: inherit;
}
.btn-confirm:disabled { opacity: 0.4; cursor: default; }
.btn-print {
  width: 100%; padding: 13px; border-radius: 10px;
  background: transparent; border: 1px solid rgba(26,86,219,0.4);
  color: #60A5FA; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.post-confirm { display: flex; flex-direction: column; gap: 8px; }
</style>
