<script setup lang="ts">
import type { ReceiptSettings } from '@/features/receipt/receipt.types'

const props = defineProps<{ settings: ReceiptSettings }>()

const DUMMY_LINE = { name: 'Samsung A55', qty: 1, price: 220 }
const DUMMY_TOTAL_USD = 220
const DUMMY_TOTAL_SYP = 3_190_000
</script>

<template>
  <div
    class="bg-white text-gray-900 rounded-xl p-4 font-mono text-xs leading-relaxed border border-gray-200 max-w-xs mx-auto"
    dir="rtl"
  >
    <!-- Shop name -->
    <p
      data-testid="preview-shop-name"
      class="text-center font-bold text-sm mb-0.5"
    >{{ settings.shopName || 'اسم المحل' }}</p>

    <!-- Header text -->
    <p
      v-if="settings.headerText"
      data-testid="preview-header-text"
      class="text-center text-gray-500 mb-0.5"
    >{{ settings.headerText }}</p>

    <!-- Tax number -->
    <p
      v-if="settings.taxNumber"
      data-testid="preview-tax-number"
      class="text-center text-gray-500 mb-1"
    >الرقم الضريبي: {{ settings.taxNumber }}</p>

    <div class="border-t border-dashed border-gray-300 my-2" />

    <!-- Dummy line item -->
    <div
      data-testid="preview-dummy-line"
      class="flex justify-between"
    >
      <span>{{ DUMMY_LINE.name }} ×{{ DUMMY_LINE.qty }}</span>
      <span>${{ DUMMY_LINE.price.toFixed(2) }}</span>
    </div>

    <div class="border-t border-dashed border-gray-300 my-2" />

    <!-- Totals -->
    <div class="flex justify-between font-semibold">
      <span>المجموع</span>
      <span>${{ DUMMY_TOTAL_USD.toFixed(2) }}</span>
    </div>
    <div class="flex justify-between text-gray-500 mt-0.5">
      <span>بالليرة</span>
      <span>{{ DUMMY_TOTAL_SYP.toLocaleString() }} ل.س</span>
    </div>

    <!-- Footer -->
    <template v-if="settings.footerText">
      <div class="border-t border-dashed border-gray-300 my-2" />
      <p
        data-testid="preview-footer-text"
        class="text-center text-gray-500"
      >{{ settings.footerText }}</p>
    </template>
  </div>
</template>
