<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSuppliers } from './composables/useSuppliers'
import SupplierForm from './components/SupplierForm.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { NewSupplier } from './supplier.types'

const router = useRouter()
const { suppliers, load, save } = useSuppliers()
const adding = ref(false)

onMounted(load)

async function onAdd(data: NewSupplier) {
  await save(data)
  adding.value = false
  await load()
}
</script>

<template>
  <section class="page" dir="rtl">
    <header class="page-head">
      <h1>الموردون</h1>
      <button class="btn-primary" @click="adding = true">+ مورّد جديد</button>
    </header>

    <!-- Add supplier now opens as a standard modal, consistent with every other
         "add" action, instead of expanding inline over the empty state (BUG-029). -->
    <BaseModal v-if="adding" title="مورّد جديد" @close="adding = false">
      <SupplierForm @submit="onAdd" @cancel="adding = false" />
    </BaseModal>

    <!-- Empty state with embedded CTA (consistent with Expenses), instead of a
         bare banner separated from the header button (BUG-003 of the new list). -->
    <EmptyState
      v-if="!suppliers.length"
      title="لا يوجد موردون بعد"
      subtitle="أضف أول مورّد بالضغط على الزر أدناه"
      cta-label="مورّد جديد"
      @cta="adding = true"
    />

    <ul v-else class="list">
      <li v-for="s in suppliers" :key="s.id" @click="router.push(`/suppliers/${s.id}`)">
        <div class="top">
          <span class="name">{{ s.name }}</span>
          <span class="total">{{ s.totalPurchasedUsd.toFixed(0) }}$</span>
        </div>
        <div class="sub">
          <span v-if="s.phone">{{ s.phone }}</span>
          <span v-if="s.lastReceivedAt">آخر استلام: {{ new Date(s.lastReceivedAt).toLocaleDateString('ar') }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.page { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.list li { background: #0D1828; border-radius: 0.75rem; padding: 0.85rem; cursor: pointer; }
.top { display: flex; justify-content: space-between; }
.name { font-weight: 600; }
.total { color: #4ADE80; }
.sub { display: flex; justify-content: space-between; color: #9CB3D0; font-size: 0.8rem; margin-top: 0.25rem; }
.empty { text-align: center; color: #9CB3D0; cursor: default; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; }
</style>
