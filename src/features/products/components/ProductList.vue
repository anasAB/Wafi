<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Product } from '@/features/pos/pos.types'

const props = defineProps<{
  products:        Product[]
  filterLowStock?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit',   id: string): void
  (e: 'delete', id: string): void
}>()

const search    = ref('')
const openKebab = ref<string | null>(null)

const displayed = computed(() => {
  let list = props.filterLowStock
    ? props.products.filter(p => p.currentStock <= p.lowStockThreshold)
    : props.products

  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    list = list.filter(p =>
      p.nameAr.toLowerCase().includes(q) ||
      (p.nameEn ?? '').toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q)
    )
  }

  return list
})

function isLowStock(p: Product): boolean {
  return p.currentStock <= p.lowStockThreshold
}

function toggleKebab(id: string) {
  openKebab.value = openKebab.value === id ? null : id
}

function closeKebab() {
  openKebab.value = null
}

function handleEdit(id: string) {
  closeKebab()
  emit('edit', id)
}

function handleDelete(id: string) {
  closeKebab()
  emit('delete', id)
}
</script>

<template>
  <div class="list-root" dir="rtl">

    <!-- Search + scan toolbar -->
    <div class="toolbar">
      <div class="search-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" class="search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          v-model="search"
          data-testid="search"
          dir="rtl"
          type="text"
          placeholder="بحث بالاسم أو الباركود..."
          class="search-input"
          @focus="($event.target as HTMLInputElement).style.borderColor = 'rgba(26,86,219,0.8)'"
          @blur="($event.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.18)'"
        />
      </div>
      <!-- Barcode scan affordance -->
      <button
        type="button"
        title="امسح الباركود بالماسح الضوئي أو اكتبه في خانة البحث"
        class="scan-btn"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="scan-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75V16.5zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
        </svg>
      </button>
    </div>

    <!-- Empty state -->
    <div v-if="!displayed.length" class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" class="empty-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
      <p class="empty-title">
        {{ search ? 'لا توجد نتائج مطابقة' : 'لا يوجد منتجات بعد' }}
      </p>
      <p class="empty-subtitle">
        {{ search ? 'جرّب كلمة بحث مختلفة أو امسح الباركود' : 'أضف منتجك الأول لبدء تتبع المخزون والأسعار' }}
      </p>
    </div>

    <!-- ─── DESKTOP TABLE (lg+) ─── -->
    <div v-if="displayed.length" class="table-wrap hidden lg:block">
      <table class="data-table" dir="rtl">
        <thead>
          <tr class="table-head-row">
            <th class="th w-14">صورة</th>
            <th class="th">الاسم</th>
            <th class="th w-28">الفئة</th>
            <th class="th w-24">التكلفة</th>
            <th class="th w-24">البيع</th>
            <th class="th w-24">المخزون</th>
            <th class="w-10" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in displayed"
            :key="p.id"
            class="table-row group"
            @click="emit('edit', p.id)"
          >
            <!-- Photo -->
            <td class="td">
              <div class="thumb-wrap">
                <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.nameAr" class="thumb-img" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="thumb-placeholder" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </div>
            </td>
            <!-- Name -->
            <td class="td">
              <p class="product-name">{{ p.nameAr }}</p>
              <p v-if="p.nameEn" class="product-name-en">{{ p.nameEn }}</p>
            </td>
            <!-- Category -->
            <td class="td">
              <span class="text-muted text-xs">{{ p.category || '—' }}</span>
            </td>
            <!-- Cost -->
            <td class="td">
              <span class="cost-price">${{ p.costPriceUsd.toFixed(2) }}</span>
            </td>
            <!-- Sale Price -->
            <td class="td">
              <span class="sale-price">${{ p.salePriceUsd.toFixed(2) }}</span>
            </td>
            <!-- Stock -->
            <td class="td">
              <div class="stock-cell">
                <span
                  :data-testid="`stock-${p.id}`"
                  class="stock-num"
                  :class="p.currentStock < 0 ? 'stock-neg' : isLowStock(p) ? 'stock-low' : 'stock-ok'"
                >{{ p.currentStock }}</span>
                <span
                  v-if="isLowStock(p)"
                  :data-testid="`low-stock-badge-${p.id}`"
                  aria-label="مخزون منخفض"
                  class="low-stock-icon"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </span>
              </div>
            </td>
            <!-- Actions -->
            <td class="td relative" @click.stop>
              <button
                type="button"
                class="kebab-btn opacity-0 group-hover:opacity-100"
                aria-label="الإجراءات"
                @click="toggleKebab(p.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                </svg>
              </button>
              <!-- Kebab dropdown -->
              <div v-if="openKebab === p.id" class="kebab-dropdown">
                <button type="button" class="kebab-item" @click="handleEdit(p.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  تعديل
                </button>
                <div class="kebab-divider" />
                <button type="button" class="kebab-item kebab-danger" @click="handleDelete(p.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  حذف
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Outside click overlay to close kebab -->
      <div v-if="openKebab" class="fixed inset-0 z-20" @click="closeKebab" />
    </div>

    <!-- ─── MOBILE CARDS (< lg) — also always rendered for test compatibility ─── -->
    <div class="mobile-list lg:hidden">
      <div
        v-for="p in displayed"
        :key="p.id"
        :data-testid="`product-card-${p.id}`"
        class="mobile-card"
        :class="isLowStock(p) ? 'mobile-card-low' : 'mobile-card-normal'"
        @click="emit('edit', p.id)"
      >
        <!-- Photo -->
        <div class="mobile-thumb">
          <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.nameAr" class="thumb-img" />
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-muted opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
        </div>
        <!-- Name + barcode -->
        <div class="mobile-info">
          <p class="product-name truncate">{{ p.nameAr }}</p>
          <p v-if="p.barcode" class="text-xs text-muted mt-0.5">{{ p.barcode }}</p>
        </div>
        <!-- Price + stock -->
        <div class="mobile-meta">
          <p class="sale-price">${{ p.salePriceUsd.toFixed(2) }}</p>
          <p
            :data-testid="`stock-${p.id}`"
            class="mobile-stock"
            :class="p.currentStock < 0 ? 'stock-neg' : isLowStock(p) ? 'stock-low' : 'text-muted'"
          >
            <span v-if="isLowStock(p)" :data-testid="`low-stock-badge-${p.id}`" aria-label="مخزون منخفض">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </span>
            {{ p.currentStock }}
          </p>
        </div>
        <!-- Delete -->
        <button
          type="button"
          class="mobile-delete"
          aria-label="حذف"
          @click.stop="emit('delete', p.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-root {
  font-family: 'Tajawal', system-ui, sans-serif;
}

/* ── Toolbar ─────────────────────────────────────── */
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.search-wrap {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 12px;
  margin: auto 0;
  width: 16px;
  height: 16px;
  color: #637285;
  pointer-events: none;
}

.search-input {
  width: 100%;
  border-radius: 0.75rem;
  padding: 10px 40px 10px 16px;
  font-size: 14px;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.search-input::placeholder {
  color: #3D4F6B;
}

.search-input:focus {
  border-color: rgba(26,86,219,0.8);
  box-shadow: 0 0 0 3px rgba(26,86,219,0.25), 0 0 12px rgba(26,86,219,0.15);
}

.scan-btn {
  width: 44px;
  height: 44px;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  color: #637285;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}

.scan-btn:hover {
  color: #E8EDF5;
}

.scan-icon {
  width: 20px;
  height: 20px;
}

/* ── Empty state ─────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  text-align: center;
}

.empty-icon {
  width: 64px;
  height: 64px;
  color: #637285;
  opacity: 0.20;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0 0 6px 0;
}

.empty-subtitle {
  font-size: 13px;
  color: #637285;
  max-width: 280px;
  margin: 0;
}

/* ── Desktop Table ───────────────────────────────── */
.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.table-head-row {
  border-bottom: 1px solid rgba(26,86,219,0.14);
}

.th {
  text-align: right;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #637285;
  white-space: nowrap;
}

.table-row {
  border-bottom: 1px solid rgba(255,255,255,0.05);
  cursor: pointer;
  transition: background 0.12s;
}

.table-row:hover {
  background: rgba(26,86,219,0.06);
}

.td {
  padding: 10px 12px;
  vertical-align: middle;
}

/* ── Thumbnail ───────────────────────────────────── */
.thumb-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.18);
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  width: 16px;
  height: 16px;
  color: #637285;
  opacity: 0.4;
}

/* ── Product names ───────────────────────────────── */
.product-name {
  font-size: 14px;
  font-weight: 600;
  color: #E8EDF5;
  margin: 0;
}

.product-name-en {
  font-size: 12px;
  color: #637285;
  margin: 2px 0 0 0;
}

/* ── Prices ──────────────────────────────────────── */
.cost-price {
  font-size: 13px;
  color: #637285;
  font-variant-numeric: tabular-nums;
}

.sale-price {
  font-size: 13px;
  font-weight: 700;
  color: #60A5FA;
  font-variant-numeric: tabular-nums;
}

/* ── Stock ───────────────────────────────────────── */
.stock-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stock-num {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stock-ok  { color: #E8EDF5; }
.stock-low { color: #F59E0B; }
.stock-neg { color: #EF4444; }

.low-stock-icon {
  color: #F59E0B;
}

/* ── Kebab button ────────────────────────────────── */
.kebab-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #637285;
  cursor: pointer;
  transition: color 0.12s, background 0.12s, opacity 0.15s;
}

.kebab-btn:hover {
  color: #E8EDF5;
  background: rgba(26,86,219,0.08);
}

/* ── Kebab dropdown ──────────────────────────────── */
.kebab-dropdown {
  position: absolute;
  inset-inline-start: 0;
  top: 40px;
  z-index: 30;
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 0.75rem;
  overflow: hidden;
  min-width: 144px;
  box-shadow: 0 8px 48px rgba(26,86,219,0.22);
}

.kebab-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 13px;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: right;
  transition: background 0.12s;
}

.kebab-item:hover {
  background: rgba(26,86,219,0.12);
}

.kebab-danger {
  color: #EF4444;
}

.kebab-divider {
  height: 1px;
  background: rgba(26,86,219,0.14);
}

/* ── Mobile Cards ────────────────────────────────── */
.mobile-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mobile-card {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  border-radius: 1rem;
  transition: transform 0.1s, background 0.12s;
}

.mobile-card:active {
  transform: scale(0.99);
}

.mobile-card-normal {
  background: linear-gradient(135deg, rgba(26,86,219,0.08), rgba(255,255,255,0.03));
  border: 1px solid rgba(255,255,255,0.07);
}

.mobile-card-low {
  background: linear-gradient(135deg, rgba(26,86,219,0.11), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.35);
}

.mobile-card:hover {
  background: rgba(26,86,219,0.10);
}

.mobile-thumb {
  width: 44px;
  height: 44px;
  border-radius: 0.75rem;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(26,86,219,0.08);
  border: 1px solid rgba(26,86,219,0.18);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobile-info {
  flex: 1;
  min-width: 0;
}

.mobile-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.mobile-stock {
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mobile-delete {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: #637285;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.12s;
}

.mobile-delete:hover {
  color: #EF4444;
}

/* ── Utility ─────────────────────────────────────── */
.text-muted {
  color: #637285;
}
</style>
