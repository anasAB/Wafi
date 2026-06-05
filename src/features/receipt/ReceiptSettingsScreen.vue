<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import ReceiptTemplatePreview from './components/ReceiptTemplatePreview.vue'
import { useReceiptSettings } from './composables/useReceiptSettings'

const router = useRouter()
const { settings, load, save } = useReceiptSettings()

const shopName   = ref('')
const taxNumber  = ref('')
const headerText = ref('')
const footerText = ref('')
const saving     = ref(false)
const toast      = ref<{ message: string; type: 'success' | 'error' } | null>(null)

const preview = ref({
  shopName: '', taxNumber: '', headerText: '', footerText: '',
})

onMounted(async () => {
  await load()
  shopName.value   = settings.value.shopName
  taxNumber.value  = settings.value.taxNumber
  headerText.value = settings.value.headerText
  footerText.value = settings.value.footerText
  syncPreview()
})

function syncPreview() {
  preview.value = {
    shopName:   shopName.value,
    taxNumber:  taxNumber.value,
    headerText: headerText.value,
    footerText: footerText.value,
  }
}

async function handleSave() {
  saving.value = true
  try {
    await save({
      shopName:   shopName.value.trim(),
      taxNumber:  taxNumber.value.trim(),
      headerText: headerText.value.trim(),
      footerText: footerText.value.trim(),
    })
    toast.value = { message: 'تم حفظ إعدادات الفاتورة', type: 'success' }
  } catch {
    toast.value = { message: 'خطأ في الحفظ', type: 'error' }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- Header: shown on mobile only (sidebar handles desktop navigation) -->
  <div class="lg:hidden">
    <AppHeader
      title="إعدادات الفاتورة"
      :show-back="true"
      @back="router.back()"
    />
  </div>

  <div class="page-body" dir="rtl">

    <!-- Section label -->
    <p class="section-label">معلومات الفاتورة</p>

    <!-- Form card -->
    <div class="form-card">

      <!-- Shop name -->
      <div class="form-row">
        <label class="form-label">اسم المحل</label>
        <input
          v-model="shopName"
          data-testid="input-shop-name"
          type="text"
          placeholder="مثال: محل الإلكترونيات الحديث"
          class="form-input"
          @input="syncPreview"
        />
      </div>

      <!-- Tax number -->
      <div class="form-row">
        <label class="form-label">الرقم الضريبي</label>
        <input
          v-model="taxNumber"
          data-testid="input-tax-number"
          type="text"
          placeholder="12345678"
          class="form-input"
          @input="syncPreview"
        />
      </div>

      <!-- Header text -->
      <div class="form-row">
        <label class="form-label">نص رأس الفاتورة</label>
        <input
          v-model="headerText"
          data-testid="input-header-text"
          type="text"
          placeholder="Electronics & Accessories"
          class="form-input"
          @input="syncPreview"
        />
      </div>

      <!-- Footer text -->
      <div class="form-row form-row--last">
        <label class="form-label">نص ذيل الفاتورة</label>
        <input
          v-model="footerText"
          data-testid="input-footer-text"
          type="text"
          placeholder="شكراً لزيارتكم — نراكم قريباً"
          class="form-input"
          @input="syncPreview"
        />
      </div>
    </div>

    <!-- Save button -->
    <button
      type="button"
      data-testid="save-btn"
      :disabled="saving"
      class="btn-primary"
      @click="handleSave"
    >{{ saving ? 'جاري الحفظ...' : 'حفظ الإعدادات' }}</button>

    <!-- Live preview -->
    <p class="section-label">معاينة الفاتورة</p>
    <div class="preview-card">
      <ReceiptTemplatePreview :settings="preview" />
    </div>

  </div>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>

<style scoped>
/* ─── Layout ─────────────────────────────────────────────── */
.page-body {
  padding: 16px;
  max-width: 512px;
  margin: 0 auto;
  width: 100%;
  padding-bottom: 80px;
  font-family: 'Tajawal', system-ui, sans-serif;
}

@media (min-width: 1024px) {
  .page-body {
    padding: 20px;
    max-width: none;
  }
}

/* ─── Section label ───────────────────────────────────────── */
.section-label {
  font-size: 11px;
  font-weight: 700;
  color: #3D4F6B;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 0 4px;
  margin-bottom: 10px;
  margin-top: 16px;
}

.section-label:first-child { margin-top: 0; }

/* ─── Form card ───────────────────────────────────────────── */
.form-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-radius: 1rem;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  overflow: hidden;
  margin-bottom: 16px;
}

.form-row {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(26, 86, 219, 0.14);
}

.form-row--last {
  border-bottom: none;
}

/* ─── Form label ──────────────────────────────────────────── */
.form-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #637285;
  margin-bottom: 6px;
}

/* ─── Form input ──────────────────────────────────────────── */
.form-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-input::placeholder { color: #3D4F6B; }

.form-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

/* ─── Primary button ──────────────────────────────────────── */
.btn-primary {
  width: 100%;
  height: 44px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: white;
  border: none;
  font-size: 0.875rem;
  font-weight: 700;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.1s;
  margin-bottom: 20px;
}

.btn-primary:hover { opacity: 0.88; }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

/* ─── Preview card ────────────────────────────────────────── */
.preview-card {
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  border-radius: 1rem;
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  padding: 16px;
}
</style>
