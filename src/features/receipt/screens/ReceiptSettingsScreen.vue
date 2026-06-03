<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import ReceiptTemplatePreview from '../components/ReceiptTemplatePreview.vue'
import { useReceiptSettings } from '../composables/useReceiptSettings'

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
  <!-- Header: shown on mobile only -->
  <div class="md:hidden">
    <AppHeader
      title="إعدادات الفاتورة"
      :show-back="true"
      @back="router.back()"
    />
  </div>

  <div class="px-4 py-4 md:p-5 max-w-lg mx-auto w-full md:max-w-none" dir="rtl">

    <!-- Form -->
    <p class="text-xs font-semibold text-text-muted mb-2 px-1 md:px-0 tracking-widest uppercase">معلومات الفاتورة</p>
    <div class="glass-sm overflow-hidden mb-5">

      <!-- Shop name -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <label class="block text-sm text-text-muted mb-1.5">اسم المحل</label>
        <input
          v-model="shopName"
          data-testid="input-shop-name"
          type="text"
          placeholder="محل الإلكترونيات الحديث"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

      <!-- Tax number -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <label class="block text-sm text-text-muted mb-1.5">الرقم الضريبي</label>
        <input
          v-model="taxNumber"
          data-testid="input-tax-number"
          type="text"
          placeholder="12345678"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

      <!-- Header text -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <label class="block text-sm text-text-muted mb-1.5">نص الرأس</label>
        <input
          v-model="headerText"
          data-testid="input-header-text"
          type="text"
          placeholder="Electronics & Accessories"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

      <!-- Footer text -->
      <div class="px-4 py-3.5">
        <label class="block text-sm text-text-muted mb-1.5">نص الذيل</label>
        <input
          v-model="footerText"
          data-testid="input-footer-text"
          type="text"
          placeholder="شكراً لزيارتكم — نراكم قريباً"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

    </div>

    <!-- Save button -->
    <button
      type="button"
      data-testid="save-btn"
      :disabled="saving"
      class="w-full h-11 rounded-xl text-sm font-semibold text-bg-void mb-6 disabled:opacity-50 transition-colors"
      style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
      @click="handleSave"
    >{{ saving ? '...' : 'حفظ' }}</button>

    <!-- Live preview -->
    <p class="text-xs font-semibold text-text-muted mb-3 px-1 md:px-0 tracking-widest uppercase">معاينة الفاتورة</p>
    <ReceiptTemplatePreview :settings="preview" />

  </div>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>
