<script setup lang="ts">
import type { ReceivingDetailData } from '../receiving.types'

defineProps<{ data: ReceivingDetailData }>()
</script>

<template>
  <div class="detail" dir="rtl">
    <header>
      <h3>{{ data.header.supplierName }}</h3>
      <time>{{ new Date(data.header.receivedAt).toLocaleString('ar') }}</time>
    </header>

    <img v-if="data.header.invoicePhotoUrl" :src="data.header.invoicePhotoUrl" class="invoice" alt="صورة الفاتورة" />

    <table class="lines">
      <thead>
        <tr><th>الصنف</th><th>الكمية</th><th>التكلفة</th></tr>
      </thead>
      <tbody>
        <tr v-for="(l, i) in data.lines" :key="i">
          <td>{{ l.productName }}</td>
          <td>{{ l.qtyReceived }}</td>
          <td>{{ l.unitCostUsd.toFixed(2) }}$<span v-if="l.costUpdated" class="badge">حُدّث</span></td>
        </tr>
      </tbody>
    </table>

    <div class="total"><span>الإجمالي</span><strong>{{ data.header.totalCostUsd.toFixed(2) }}$</strong></div>
    <p v-if="data.header.notes" class="notes">{{ data.header.notes }}</p>
  </div>
</template>

<style scoped>
.detail { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
header { display: flex; justify-content: space-between; align-items: baseline; }
time { color: #9CB3D0; font-size: 0.85rem; }
.invoice { max-width: 100%; border-radius: 0.5rem; }
.lines { width: 100%; border-collapse: collapse; }
.lines th, .lines td { text-align: start; padding: 0.5rem; border-bottom: 1px solid #1C2A40; }
.badge { background: #1A56DB; color: #fff; font-size: 0.7rem; border-radius: 0.4rem; padding: 0.1rem 0.4rem; margin-inline-start: 0.4rem; }
.total { display: flex; justify-content: space-between; font-size: 1.1rem; }
.notes { color: #9CB3D0; }
</style>
