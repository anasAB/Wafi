<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSuppliers } from './composables/useSuppliers'
import { useReceivings } from './composables/useReceivings'
import ReceivingSheet from './components/ReceivingSheet.vue'
import type { Supplier } from './supplier.types'

const route = useRoute()
const supplierId = route.params.id as string

const { getById } = useSuppliers()
const { receivings, loadForSupplier } = useReceivings()

const supplier = ref<Supplier | null>(null)
const showSheet = ref(false)

async function refresh() {
  supplier.value = await getById(supplierId)
  await loadForSupplier(supplierId)
}

onMounted(refresh)

async function onSaved() {
  showSheet.value = false
  await refresh()
}
</script>

<template>
  <section class="page" dir="rtl">
    <header v-if="supplier" class="info">
      <h1>{{ supplier.name }}</h1>
      <p v-if="supplier.phone">{{ supplier.phone }}</p>
      <p v-if="supplier.contactPerson">{{ supplier.contactPerson }}</p>
      <p v-if="supplier.address">{{ supplier.address }}</p>
      <p v-if="supplier.notes" class="muted">{{ supplier.notes }}</p>
    </header>

    <button class="btn-primary" @click="showSheet = true">تسجيل استلام بضاعة</button>

    <h2>سجلّ الاستلام</h2>
    <ul class="list">
      <li v-for="r in receivings" :key="r.id">
        <span>{{ new Date(r.receivedAt).toLocaleDateString('ar') }}</span>
        <strong>{{ r.totalCostUsd.toFixed(2) }}$</strong>
      </li>
      <li v-if="!receivings.length" class="empty">لا يوجد استلام مسجّل.</li>
    </ul>

    <div v-if="showSheet" class="overlay">
      <div class="overlay-card">
        <ReceivingSheet
          :preset-supplier="supplier ? { id: supplier.id, name: supplier.name } : undefined"
          @saved="onSaved"
          @close="showSheet = false"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.info p { margin: 0.15rem 0; }
.muted { color: #9CB3D0; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.list li { background: #0D1828; border-radius: 0.75rem; padding: 0.85rem; display: flex; justify-content: space-between; }
.empty { color: #9CB3D0; justify-content: center; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.75rem; border-radius: 0.5rem; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 40; }
.overlay-card { background: #0A1320; border-radius: 1rem; width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; }
</style>
