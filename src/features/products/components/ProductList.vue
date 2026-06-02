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
  <div dir="rtl">

    <!-- Search + scan toolbar -->
    <div class="flex gap-2 mb-4">
      <div class="relative flex-1">
        <svg xmlns="http://www.w3.org/2000/svg" class="absolute inset-y-0 end-3 my-auto w-4 h-4 text-text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          v-model="search"
          data-testid="search"
          dir="rtl"
          type="text"
          placeholder="بحث بالاسم أو الباركود..."
          class="w-full rounded-xl pe-10 ps-4 py-2.5 text-sm text-text-primary bg-surface-glass border border-border-glass placeholder:text-text-muted focus:outline-none focus:ring-1"
          style="--tw-ring-color: var(--color-gold-primary)"
        />
      </div>
      <!-- Barcode scan affordance -->
      <button
        type="button"
        title="امسح الباركود بالماسح الضوئي أو اكتبه في خانة البحث"
        class="w-11 h-11 rounded-xl bg-surface-glass border border-border-glass flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors flex-shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75V16.5zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
        </svg>
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-if="!displayed.length"
      class="flex flex-col items-center justify-center py-20 text-center"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 mb-4 text-text-muted opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
      <p class="text-base font-semibold text-text-primary mb-1">
        {{ search ? 'لا توجد نتائج مطابقة' : 'لا يوجد منتجات بعد' }}
      </p>
      <p class="text-sm text-text-muted max-w-xs">
        {{ search ? 'جرّب كلمة بحث مختلفة أو امسح الباركود' : 'أضف منتجك الأول لبدء تتبع المخزون والأسعار' }}
      </p>
    </div>

    <!-- ─── DESKTOP TABLE (lg+) ─── -->
    <div v-if="displayed.length" class="hidden lg:block">
      <table class="w-full border-collapse" dir="rtl">
        <thead>
          <tr class="border-b border-border-glass">
            <th class="text-right py-2.5 px-3 text-xs font-semibold text-text-muted w-14">صورة</th>
            <th class="text-right py-2.5 px-3 text-xs font-semibold text-text-muted">الاسم</th>
            <th class="text-right py-2.5 px-3 text-xs font-semibold text-text-muted w-28">الفئة</th>
            <th class="text-right py-2.5 px-3 text-xs font-semibold text-text-muted w-24">التكلفة</th>
            <th class="text-right py-2.5 px-3 text-xs font-semibold text-text-muted w-24">البيع</th>
            <th class="text-right py-2.5 px-3 text-xs font-semibold text-text-muted w-24">المخزون</th>
            <th class="w-10" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in displayed"
            :key="p.id"
            class="border-b border-border-glass hover:bg-surface-glass transition-colors group cursor-pointer"
            @click="emit('edit', p.id)"
          >
            <!-- Photo -->
            <td class="py-2.5 px-3">
              <div class="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-raised flex items-center justify-center">
                <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.nameAr" class="w-full h-full object-cover" />
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </div>
            </td>
            <!-- Name -->
            <td class="py-2.5 px-3">
              <p class="text-sm font-medium text-text-primary">{{ p.nameAr }}</p>
              <p v-if="p.nameEn" class="text-xs text-text-muted mt-0.5">{{ p.nameEn }}</p>
            </td>
            <!-- Category -->
            <td class="py-2.5 px-3">
              <span class="text-xs text-text-muted">{{ p.category || '—' }}</span>
            </td>
            <!-- Cost -->
            <td class="py-2.5 px-3">
              <span class="text-sm text-text-muted tabular-nums">${{ p.costPriceUsd.toFixed(2) }}</span>
            </td>
            <!-- Price -->
            <td class="py-2.5 px-3">
              <span class="text-sm font-semibold text-gold-primary tabular-nums">${{ p.salePriceUsd.toFixed(2) }}</span>
            </td>
            <!-- Stock -->
            <td class="py-2.5 px-3">
              <div class="flex items-center gap-1.5">
                <span
                  :data-testid="`stock-${p.id}`"
                  class="text-sm font-medium tabular-nums"
                  :class="p.currentStock < 0 ? 'text-red-600' : isLowStock(p) ? 'text-gold-primary' : 'text-text-primary'"
                >{{ p.currentStock }}</span>
                <span
                  v-if="isLowStock(p)"
                  :data-testid="`low-stock-badge-${p.id}`"
                  aria-label="مخزون منخفض"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-gold-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </span>
              </div>
            </td>
            <!-- Actions -->
            <td class="py-2.5 px-2 relative" @click.stop>
              <button
                type="button"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-raised transition-colors opacity-0 group-hover:opacity-100"
                aria-label="الإجراءات"
                @click="toggleKebab(p.id)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                </svg>
              </button>
              <!-- Kebab dropdown -->
              <div
                v-if="openKebab === p.id"
                class="absolute start-0 top-10 z-30 glass-lg rounded-xl overflow-hidden min-w-36 shadow-xl"
                style="border-color: var(--color-border-gold)"
              >
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-primary hover:bg-surface-raised transition-colors text-right"
                  @click="handleEdit(p.id)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  تعديل
                </button>
                <div class="border-t border-border-glass" />
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-surface-raised transition-colors text-right"
                  @click="handleDelete(p.id)"
                >
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
    <div class="flex flex-col gap-2 lg:hidden">
      <div
        v-for="p in displayed"
        :key="p.id"
        :data-testid="`product-card-${p.id}`"
        class="glass-sm p-3 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition-transform hover:bg-surface-raised"
        :style="isLowStock(p) ? 'border-color: rgb(201 168 76 / 0.4)' : ''"
        @click="emit('edit', p.id)"
      >
        <!-- Photo -->
        <div class="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-surface-raised flex items-center justify-center">
          <img v-if="p.photoUrl" :src="p.photoUrl" :alt="p.nameAr" class="w-full h-full object-cover" />
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-text-muted opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
        </div>
        <!-- Name + barcode -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-text-primary truncate">{{ p.nameAr }}</p>
          <p v-if="p.barcode" class="text-xs text-text-muted mt-0.5">{{ p.barcode }}</p>
        </div>
        <!-- Price + stock -->
        <div class="flex flex-col items-end gap-1 flex-shrink-0">
          <p class="text-sm font-semibold text-gold-primary tabular-nums">${{ p.salePriceUsd.toFixed(2) }}</p>
          <p
            :data-testid="`stock-${p.id}`"
            class="text-xs font-medium flex items-center gap-1"
            :class="p.currentStock < 0 ? 'text-red-600' : isLowStock(p) ? 'text-gold-primary' : 'text-text-muted'"
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
          class="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-red-500 transition-colors flex-shrink-0"
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
