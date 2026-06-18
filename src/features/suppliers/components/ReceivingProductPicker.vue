<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useProducts } from '@/features/products/composables/useProducts'
import { useDeviceStore } from '@/store/device.store'

const emit = defineEmits<{
  select: [{ id: string; nameAr: string; costPriceUsd: number }]
  close: []
}>()

const { products, load, save } = useProducts()
const device = useDeviceStore()

const query  = ref('')
const adding = ref(false)

// quick-add fields
const newName  = ref('')
const newBarcode = ref('')
const newSale  = ref<number>(0)
const newCost  = ref<number>(0)

onMounted(load)

const matches = computed(() =>
  products.value.filter(p =>
    p.nameAr.includes(query.value) || (p.barcode ?? '').includes(query.value),
  ),
)

function pick(p: { id: string; nameAr: string; costPriceUsd: number }) {
  emit('select', { id: p.id, nameAr: p.nameAr, costPriceUsd: p.costPriceUsd })
}

function startAdd() {
  newName.value = query.value
  newBarcode.value = ''
  newSale.value = 0
  newCost.value = 0
  adding.value = true
}

async function confirmAdd() {
  if (!newName.value.trim()) return
  await save({
    shopId: device.shopId,
    nameAr: newName.value.trim(),
    barcode: newBarcode.value.trim() || undefined,
    salePriceUsd: Number(newSale.value) || 0,
    costPriceUsd: Number(newCost.value) || 0,
    currentStock: 0,
    lowStockThreshold: 0,
    isActive: true,
  })
  await load()
  const created = products.value.find(p => p.nameAr === newName.value.trim())
  if (created) pick(created)
  adding.value = false
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card" dir="rtl">
      <header class="modal-head">
        <h3>أضف منتجاً للاستلام</h3>
        <button class="close-btn" aria-label="إغلاق" @click="emit('close')">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <template v-if="!adding">
        <input v-model="query" class="search" type="text" placeholder="ابحث أو امسح الباركود…" autofocus />
        <ul class="list">
          <li v-for="p in matches" :key="p.id" @click="pick(p)">
            <span class="name">{{ p.nameAr }}</span>
            <span class="cost">التكلفة: {{ p.costPriceUsd }}$</span>
          </li>
        </ul>
        <button class="btn-primary" @click="startAdd">+ منتج جديد «{{ query }}»</button>
      </template>

      <div v-else class="quick-add">
        <label>الاسم<input v-model="newName" type="text" /></label>
        <label>الباركود<input v-model="newBarcode" type="text" /></label>
        <label>سعر البيع ($)<input v-model.number="newSale" type="number" min="0" step="0.01" /></label>
        <label>سعر التكلفة ($)<input v-model.number="newCost" type="number" min="0" step="0.01" /></label>
        <div class="actions">
          <button class="btn-ghost" @click="adding = false">رجوع</button>
          <button class="btn-primary" :disabled="!newName.trim()" @click="confirmAdd">إضافة</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-card { background: #0D1828; border-radius: 1rem; padding: 1rem; width: min(480px, 92vw); max-height: 80vh; overflow-y: auto; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.close-btn {
  width: 2rem; height: 2rem; border-radius: 0.625rem;
  display: flex; align-items: center; justify-content: center;
  color: #637285; background: rgba(255,255,255,0.06); border: none; cursor: pointer;
  transition: background 0.12s;
}
.close-btn:hover { background: rgba(255,255,255,0.10); }
.search { width: 100%; padding: 0.6rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.list { list-style: none; padding: 0; margin: 0.75rem 0; display: flex; flex-direction: column; gap: 0.25rem; }
.list li { display: flex; justify-content: space-between; padding: 0.75rem; border-radius: 0.5rem; cursor: pointer; }
.list li:hover { background: #16263C; }
.cost { color: #9CB3D0; font-size: 0.85rem; }
.quick-add { display: flex; flex-direction: column; gap: 0.5rem; }
.quick-add label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
.quick-add input { padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #2A3A52; background: #0A1320; color: #fff; }
.actions { display: flex; gap: 0.5rem; }
.btn-primary { background: #1A56DB; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; }
.btn-primary:disabled { opacity: 0.5; }
.btn-ghost { background: transparent; color: #9CB3D0; border: none; padding: 0.6rem 1.2rem; }
</style>
