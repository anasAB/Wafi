<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { useProducts } from '@/features/products/composables/useProducts'
import { useDeviceStore } from '@/store/device.store'

const props = withDefaults(defineProps<{
  selectedProductIds?: string[]
}>(), {
  selectedProductIds: () => [],
})

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

const selectedIdsSet = computed(() => new Set(props.selectedProductIds))

const matches = computed(() =>
  products.value.filter((p) => {
    if (selectedIdsSet.value.has(p.id)) return false
    return p.nameAr.includes(query.value) || (p.barcode ?? '').includes(query.value)
  }),
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
  <BaseModal title="أضف منتجاً للاستلام" @close="emit('close')">
    <div class="sheet-body" dir="rtl">
      <template v-if="!adding">
        <div class="search-wrap">
          <svg class="search-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            v-model="query"
            class="search-input"
            type="text"
            placeholder="ابحث أو امسح الباركود..."
            autofocus
          />
          <button
            v-if="query"
            type="button"
            class="search-clear-btn"
            aria-label="مسح البحث"
            @click="query = ''"
          >×</button>
        </div>

        <div class="results-list">
          <button
            v-for="p in matches"
            :key="p.id"
            type="button"
            class="result-row"
            @click="pick(p)"
          >
            <span class="result-name">{{ p.nameAr }}</span>
            <span class="result-cost" dir="ltr">${{ p.costPriceUsd.toFixed(2) }}</span>
          </button>

          <p v-if="matches.length === 0" class="empty-text">لا توجد منتجات مطابقة</p>
        </div>

        <button type="button" class="btn-secondary" @click="startAdd">+ منتج جديد «{{ query || 'بدون اسم' }}»</button>
      </template>

      <div v-else class="quick-add">
        <label class="field-label">الاسم
          <input v-model="newName" class="field-input" type="text" />
        </label>
        <label class="field-label">الباركود
          <input v-model="newBarcode" class="field-input" type="text" />
        </label>

        <div class="price-grid">
          <label class="field-label">سعر البيع ($)
            <input v-model.number="newSale" class="field-input" type="number" min="0" step="0.01" dir="ltr" />
          </label>
          <label class="field-label">سعر التكلفة ($)
            <input v-model.number="newCost" class="field-input" type="number" min="0" step="0.01" dir="ltr" />
          </label>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="actions">
        <button type="button" class="btn-ghost" @click="adding ? (adding = false) : emit('close')">
          {{ adding ? 'رجوع' : 'إلغاء' }}
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="adding ? !newName.trim() : false"
          @click="adding ? confirmAdd() : startAdd()"
        >
          {{ adding ? 'إضافة' : 'منتج جديد' }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-family: 'Tajawal', system-ui, sans-serif;
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 15rem;
  overflow-y: auto;
  padding-inline-end: 0.25rem;
}

.result-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(26,86,219,0.20);
  background: rgba(26,86,219,0.08);
  padding: 0.65rem 0.75rem;
  text-align: right;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.result-row:hover {
  background: rgba(26,86,219,0.16);
  border-color: rgba(26,86,219,0.32);
}

.result-name {
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 600;
}

.result-cost {
  color: #9CB3D0;
  font-size: 0.8rem;
}

.empty-text {
  margin: 0;
  text-align: center;
  color: #637285;
  font-size: 0.8rem;
  padding: 0.6rem 0;
}

.quick-add {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: #C8D5E8;
  font-size: 0.8rem;
}

.field-input {
  width: 100%;
  height: 40px;
  border-radius: 0.75rem;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.07);
  color: #E8EDF5;
  padding: 0.5rem 0.75rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.field-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

.price-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.actions {
  width: 100%;
  display: flex;
  gap: 0.6rem;
}

.btn-primary {
  flex: 1;
  height: 44px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  border: none;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26,86,219,0.40);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  width: 100%;
  height: 40px;
  border-radius: 0.75rem;
  border: 1px dashed rgba(26,86,219,0.45);
  color: #60A5FA;
  background: rgba(26,86,219,0.06);
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
}

.btn-secondary:hover {
  background: rgba(26,86,219,0.12);
}

.btn-ghost {
  min-width: 6.5rem;
  height: 44px;
  border-radius: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.18);
  color: #E8EDF5;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
}
</style>
