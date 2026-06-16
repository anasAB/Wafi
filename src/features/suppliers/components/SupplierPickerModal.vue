<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSuppliers } from '../composables/useSuppliers'
import SupplierForm from './SupplierForm.vue'
import type { NewSupplier } from '../supplier.types'

const emit = defineEmits<{ select: [{ id: string; name: string }]; close: [] }>()

const { suppliers, load, save } = useSuppliers()
const query   = ref('')
const adding  = ref(false)

onMounted(load)

function pick(id: string, name: string) {
  emit('select', { id, name })
}

async function onAdd(data: NewSupplier) {
  const id = await save(data)
  pick(id, data.name)
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card" dir="rtl">
      <header class="modal-head">
        <h3>اختر المورّد</h3>
        <button class="btn-ghost" @click="emit('close')">✕</button>
      </header>

      <template v-if="!adding">
        <input v-model="query" class="search" type="text" placeholder="ابحث عن مورّد…" />
        <ul class="list">
          <li
            v-for="s in suppliers.filter(s => s.name.includes(query))"
            :key="s.id"
            @click="pick(s.id, s.name)"
          >
            <span class="name">{{ s.name }}</span>
            <span v-if="s.phone" class="phone">{{ s.phone }}</span>
          </li>
        </ul>
        <button class="btn-primary" @click="adding = true">+ مورّد جديد</button>
      </template>

      <SupplierForm
        v-else
        :initial="{ name: query }"
        @submit="onAdd"
        @cancel="adding = false"
      />
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-card { background: #0D1828; border-radius: 1rem; padding: 1rem; width: min(480px, 92vw); max-height: 80vh; overflow-y: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.search { width: 100%; padding: 0.6rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.list { list-style: none; padding: 0; margin: 0.75rem 0; display: flex; flex-direction: column; gap: 0.25rem; }
.list li { display: flex; justify-content: space-between; padding: 0.75rem; border-radius: 0.5rem; cursor: pointer; }
.list li:hover { background: #16263C; }
.phone { color: #9CB3D0; font-size: 0.85rem; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; width: 100%; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; }
</style>
