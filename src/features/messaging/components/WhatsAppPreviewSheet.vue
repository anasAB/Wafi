<script setup lang="ts">
import { ref, watch } from 'vue'
import { resolvePhone } from '../whatsapp'

const props = defineProps<{
  text:  string
  phone: string | null
  title?: string
  imageDataUrl?: string | null
}>()

const emit = defineEmits<{
  (e: 'send',   payload: { phone: string; text: string }): void
  (e: 'cancel'): void
}>()

const editedText    = ref(props.text)
const phoneInput    = ref(props.phone ?? '')
const phoneError    = ref<string | null>(null)

// Keep the textarea in sync if the parent changes the text after mount
// (e.g. async load). Once the owner starts typing we leave it alone.
let userEditedText = false
watch(() => props.text, (val) => {
  if (!userEditedText) editedText.value = val
})

watch(() => props.phone, (val) => {
  phoneInput.value = val ?? ''
})

function onTextInput() {
  userEditedText = true
}

function handleSend() {
  phoneError.value = null

  // If a phone was already resolved upstream by useSendReceipt.prepare, emit it
  // directly — no need to re-validate an already-resolved number.
  if (props.phone && props.phone.length > 0) {
    emit('send', { phone: props.phone, text: editedText.value })
    return
  }

  // Walk-in path: validate the manually-typed number before emitting.
  const resolved = resolvePhone(phoneInput.value.trim())
  if (!resolved) {
    phoneError.value = 'رقم غير صالح — أدخل رقماً دولياً أو محلياً صحيحاً'
    return
  }

  emit('send', { phone: resolved, text: editedText.value })
}
</script>

<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="emit('cancel')">
      <div class="sheet" dir="rtl">
        <!-- Drag handle (mobile only) -->
        <div class="sheet-handle-wrap">
          <div class="sheet-handle" />
        </div>

        <!-- Header -->
        <div class="sheet-header">
          <div class="sheet-header-main">
            <div class="sheet-header-text">
              <span class="sheet-title">{{ title ?? 'إرسال عبر واتساب' }}</span>
              <span class="sheet-sub">راجع النص وعدّله قبل الإرسال</span>
            </div>
            <button
              type="button"
              class="close-btn"
              aria-label="إغلاق"
              @click="emit('cancel')"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Phone input (only when no phone was pre-resolved) -->
        <div v-if="!props.phone" class="sheet-phone-section">
          <label class="phone-label" for="wa-phone-input">رقم الواتساب</label>
          <input
            id="wa-phone-input"
            v-model="phoneInput"
            type="tel"
            class="phone-input"
            :class="{ 'phone-input--error': phoneError }"
            placeholder="مثال: 0912345678 أو +963912345678"
            dir="ltr"
            autocomplete="tel"
            @input="phoneError = null"
          />
          <p v-if="phoneError" class="phone-error-msg">{{ phoneError }}</p>
        </div>

        <!-- Editable receipt preview -->
        <div class="sheet-scroll">
          <div v-if="props.imageDataUrl" class="image-preview-wrap">
            <p class="preview-label">معاينة صورة الكشف</p>
            <img :src="props.imageDataUrl" alt="معاينة كشف الحساب" class="statement-image" />
          </div>

          <label class="preview-label" for="wa-receipt-text">نص الفاتورة</label>
          <textarea
            id="wa-receipt-text"
            v-model="editedText"
            class="receipt-textarea"
            dir="auto"
            rows="14"
            @input="onTextInput"
          />
        </div>

        <!-- Footer actions -->
        <div class="sheet-footer">
          <button type="button" class="btn-cancel" @click="emit('cancel')">إلغاء</button>
          <button type="button" class="btn-send" @click="handleSend">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <!-- WhatsApp logo path (simplified) -->
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M11.953 2C6.465 2 2 6.465 2 11.953c0 1.821.497 3.53 1.359 4.997L2 22l5.218-1.328A9.912 9.912 0 0011.953 22c5.488 0 9.953-4.465 9.953-9.953S17.441 2 11.953 2zm0 18.12a8.16 8.16 0 01-4.159-1.139l-.298-.177-3.098.789.812-3.006-.196-.31A8.12 8.12 0 013.84 11.953c0-4.476 3.638-8.12 8.113-8.12 4.476 0 8.12 3.644 8.12 8.12s-3.644 8.167-8.12 8.167z"/>
            </svg>
            إرسال عبر واتساب
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ─── Backdrop ─────────────────────────────────────────────── */
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 640px) {
  .sheet-backdrop { align-items: center; }
}

/* ─── Sheet ─────────────────────────────────────────────────── */
.sheet {
  width: calc(100% - 16px);
  max-width: 36rem;
  max-height: 90dvh;
  margin: 0 8px calc(8px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.12), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.32);
  border-radius: 1.25rem;
  box-shadow:
    0 12px 56px rgba(0, 0, 0, 0.55),
    0 4px 24px rgba(26, 86, 219, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

@media (min-width: 640px) {
  .sheet { width: 100%; margin: 0; }
}

/* ─── Handle (mobile only) ──────────────────────────────────── */
.sheet-handle-wrap {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
}

.sheet-handle {
  width: 2.25rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.20);
}

@media (min-width: 640px) {
  .sheet-handle-wrap { display: none; }
}

/* ─── Header ────────────────────────────────────────────────── */
.sheet-header {
  padding: 10px 16px 12px;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
  flex-shrink: 0;
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

.close-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9CB3D0;
  background: rgba(26, 86, 219, 0.10);
  border: 1px solid rgba(26, 86, 219, 0.28);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.close-btn:hover {
  background: rgba(26, 86, 219, 0.18);
  color: #E8EDF5;
  border-color: rgba(26, 86, 219, 0.45);
}

/* ─── Phone section (walk-in) ───────────────────────────────── */
.sheet-phone-section {
  padding: 12px 16px 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.phone-label {
  font-size: 12px;
  font-weight: 700;
  color: #637285;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.phone-input {
  width: 100%;
  height: 44px;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.12), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.22);
  border-radius: 0.75rem;
  padding: 0 14px;
  color: #E8EDF5;
  font-size: 15px;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.phone-input:focus {
  border-color: rgba(26, 86, 219, 0.7);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.18);
}

.phone-input--error {
  border-color: rgba(239, 68, 68, 0.6);
}

.phone-input--error:focus {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
}

.phone-input::placeholder { color: #3D4F6B; }

.phone-error-msg {
  font-size: 12px;
  color: #EF4444;
  margin: 0;
}

/* ─── Scrollable receipt preview ────────────────────────────── */
.sheet-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(96, 165, 250, 0.55) rgba(255, 255, 255, 0.06);
}

.sheet-scroll::-webkit-scrollbar { width: 10px; }
.sheet-scroll::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.06); }
.sheet-scroll::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.75), rgba(26, 86, 219, 0.75));
  border-radius: 999px;
  border: 2px solid rgba(7, 11, 20, 0.8);
}
.sheet-scroll::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(147, 197, 253, 0.9), rgba(59, 130, 246, 0.9));
}

.preview-label {
  font-size: 12px;
  font-weight: 700;
  color: #637285;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.image-preview-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.statement-image {
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  border-radius: 0.75rem;
  border: 1px solid rgba(26, 86, 219, 0.24);
  background: rgba(255, 255, 255, 0.04);
}

.receipt-textarea {
  width: 100%;
  min-height: 220px;
  background: rgba(0, 0, 0, 0.30);
  border: 1px solid rgba(26, 86, 219, 0.20);
  border-radius: 0.75rem;
  padding: 12px 14px;
  color: #C8D5E8;
  font-size: 13px;
  font-family: 'Tajawal', monospace, system-ui, sans-serif;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.receipt-textarea:focus {
  border-color: rgba(26, 86, 219, 0.5);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.12);
}

/* ─── Footer ────────────────────────────────────────────────── */
.sheet-footer {
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(26, 86, 219, 0.14);
  flex-shrink: 0;
}

.btn-cancel {
  flex: 0 0 auto;
  height: 48px;
  padding: 0 20px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #C8D5E8;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-cancel:hover {
  border-color: rgba(26, 86, 219, 0.40);
  color: #E8EDF5;
}

.btn-send {
  flex: 1;
  height: 48px;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 800;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #fff;
  background: linear-gradient(135deg, #25D366, #128C7E);
  border: none;
  box-shadow: 0 4px 20px rgba(37, 211, 102, 0.35);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.15s, transform 0.1s;
}

.btn-send:hover  { opacity: 0.90; }
.btn-send:active { transform: scale(0.98); }
</style>
