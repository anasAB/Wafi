<script setup lang="ts">
import type { ReceivingDetailData } from '../receiving.types'

const props = defineProps<{ data: ReceivingDetailData }>()

function formatHeaderDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  const datePart = new Intl.DateTimeFormat('ar-SY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)

  const timePart = new Intl.DateTimeFormat('ar-SY', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)

  const cleanTime = timePart
    .replace(/،/g, '')
    .replace(/\u200f/g, '')
    .replace(/\u200e/g, '')
    .trim()

  return `${datePart} • الساعة ${cleanTime}`
}
</script>

<template>
  <div class="detail" dir="rtl">
    <header class="detail-head">
      <div class="head-main">
        <h2 class="head-title">تفاصيل الاستلام</h2>
        <p class="head-subtitle">المورّد: {{ data.header.supplierName }}</p>
      </div>
      <time class="head-time">{{ formatHeaderDate(props.data.header.receivedAt) }}</time>
    </header>

    <div class="meta-strip">
      <span class="meta-chip">الأصناف: {{ data.lines.length }}</span>
      <span class="meta-chip">سعر الصرف: {{ Number(data.header.exchangeRateAtReceiving).toLocaleString('en-US') }}</span>
    </div>

    <div v-if="data.header.invoicePhotoUrl" class="invoice-wrap">
      <p class="block-title">صورة الفاتورة</p>
      <img :src="data.header.invoicePhotoUrl" class="invoice" alt="صورة الفاتورة" />
    </div>

    <div class="lines-wrap">
      <p class="block-title">الأصناف المستلمة</p>
      <table class="lines">
        <colgroup>
          <col class="col-name" />
          <col class="col-qty" />
          <col class="col-unit" />
          <col class="col-total" />
        </colgroup>
        <thead>
          <tr>
            <th class="th-name">الصنف</th>
            <th class="th-qty">الكمية</th>
            <th class="th-unit">تكلفة الوحدة</th>
            <th class="th-total">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in data.lines" :key="i">
            <td class="cell-name">{{ l.productName }}</td>
            <td class="cell-qty" dir="ltr">{{ l.qtyReceived }}</td>
            <td class="cell-unit" dir="ltr">${{ l.unitCostUsd.toFixed(2) }}</td>
            <td class="cell-total" dir="ltr">
              <span>${{ (l.qtyReceived * l.unitCostUsd).toFixed(2) }}</span>
              <span v-if="l.costUpdated" class="badge">تم تحديث التكلفة</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="total">
      <span>الإجمالي</span>
      <strong dir="ltr">${{ data.header.totalCostUsd.toFixed(2) }}</strong>
    </div>

    <div v-if="data.header.notes" class="notes-wrap">
      <p class="block-title">ملاحظات</p>
      <p class="notes">{{ data.header.notes }}</p>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  max-height: min(82vh, 720px);
  overflow-y: auto;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  box-shadow: 0 4px 20px rgba(26,86,219,0.10), inset 0 1px 0 rgba(255,255,255,0.07);
}

.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.2rem 0.15rem 0.55rem;
  border-bottom: 1px solid rgba(148,163,184,0.18);
}

.head-main {
  min-width: 0;
}

.head-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #E8EDF5;
}

.head-subtitle {
  margin: 0.24rem 0 0;
  font-size: 0.76rem;
  color: #8FA7C6;
}

.head-time {
  color: #9CB3D0;
  font-size: 0.8rem;
  white-space: nowrap;
  padding: 0.24rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(148,163,184,0.22);
  background: rgba(12,26,44,0.56);
}

.meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border-radius: 999px;
  padding-inline: 0.55rem;
  font-size: 0.7rem;
  color: #9CB3D0;
  border: 1px solid rgba(26,86,219,0.22);
  background: rgba(26,86,219,0.08);
}

.block-title {
  margin: 0 0 0.45rem;
  color: #C8D5E8;
  font-size: 0.8rem;
  font-weight: 700;
}

.invoice-wrap,
.lines-wrap,
.notes-wrap {
  border: 1px solid rgba(26,86,219,0.20);
  border-radius: 0.875rem;
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(11,23,39,0.68));
  padding: 0.7rem;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}

.invoice {
  width: 100%;
  max-height: 260px;
  object-fit: cover;
  border-radius: 0.75rem;
  border: 1px solid rgba(148,163,184,0.25);
}

.lines {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.col-name { width: 40%; }
.col-qty { width: 14%; }
.col-unit { width: 20%; }
.col-total { width: 26%; }

.lines th,
.lines td {
  text-align: right;
  padding: 0.55rem;
  border-bottom: 1px solid rgba(148,163,184,0.16);
  color: #C8D5E8;
  font-size: 0.82rem;
  vertical-align: middle;
}

.lines th {
  color: #9CB3D0;
  font-size: 0.72rem;
  font-weight: 700;
}

.lines tr:last-child td {
  border-bottom: none;
}

.cell-name {
  color: #E8EDF5;
  font-weight: 600;
}

.th-qty, .th-unit, .th-total,
.cell-qty, .cell-unit, .cell-total {
  text-align: left;
  direction: ltr;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.cell-total {
  color: #4ADE80;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.35rem;
}

.th-name, .cell-name {
  text-align: right;
}

.th-name, .th-qty, .th-unit, .th-total {
  white-space: nowrap;
}

.cell-total > span:first-child {
  color: #4ADE80;
  font-weight: 600;
}

.badge {
  display: inline-flex;
  align-items: center;
  margin-inline-start: 0.35rem;
  background: rgba(26,86,219,0.22);
  color: #C8D5E8;
  font-size: 0.66rem;
  border: 1px solid rgba(26,86,219,0.34);
  border-radius: 999px;
  padding: 0.08rem 0.42rem;
}

.total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 0.85rem;
  border: 1px solid rgba(74,222,128,0.28);
  background: rgba(74,222,128,0.08);
  padding: 0.7rem 0.8rem;
  font-size: 0.95rem;
  color: #C8D5E8;
}

.total strong {
  color: #4ADE80;
  font-size: 1.1rem;
}

.notes {
  margin: 0;
  color: #9CB3D0;
  line-height: 1.6;
  white-space: pre-wrap;
}

@media (max-width: 640px) {
  .detail {
    padding: 0.85rem;
  }

  .detail-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
