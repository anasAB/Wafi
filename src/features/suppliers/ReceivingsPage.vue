<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReceivings } from './composables/useReceivings'
import ReceivingDetail from './components/ReceivingDetail.vue'
import type { ReceivingDetailData } from './receiving.types'

const { receivings, load, loadDetail } = useReceivings()
const detail = ref<ReceivingDetailData | null>(null)

onMounted(load)

async function open(id: string) {
  detail.value = await loadDetail(id)
}
</script>

<template>
  <section class="page" dir="rtl">
    <h1>استلام البضائع</h1>
    <ul class="list">
      <li v-for="r in receivings" :key="r.id" @click="open(r.id)">
        <div class="top">
          <span class="name">{{ r.supplierName }}</span>
          <strong>{{ r.totalCostUsd.toFixed(2) }}$</strong>
        </div>
        <span class="date">{{ new Date(r.receivedAt).toLocaleString('ar') }}</span>
      </li>
      <li v-if="!receivings.length" class="empty">لا يوجد استلام مسجّل بعد.</li>
    </ul>

    <div v-if="detail" class="overlay" @click.self="detail = null">
      <div class="overlay-card">
        <button class="btn-ghost" @click="detail = null">✕</button>
        <ReceivingDetail :data="detail" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.list li { background: #0D1828; border-radius: 0.75rem; padding: 0.85rem; cursor: pointer; }
.top { display: flex; justify-content: space-between; }
.name { font-weight: 600; }
.date { color: #9CB3D0; font-size: 0.8rem; }
.empty { text-align: center; color: #9CB3D0; cursor: default; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; padding: 0.5rem; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; float: inline-end; }
</style>
