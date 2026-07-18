<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import { useStockTake, StockTakeOverlapError } from '@/features/stock-take/composables/useStockTake'
import { useCategories } from '@/features/categories/composables/useCategories'

const router = useRouter()
const { startSession } = useStockTake()
const { categoriesWithSubcategories, load: loadCategories } = useCategories()

// WAFI-134: scope is a real category picker, not free text — free-text scoping
// filtered on the deprecated products.category column and matched nothing.
const categoryId = ref<string>('')      // '' = all products
const subcategoryId = ref<string>('')   // '' = whole category
const starting = ref(false)
const errorMessage = ref<string | null>(null)
const loadingCategories = ref(true)

onMounted(async () => {
  try { await loadCategories() } finally { loadingCategories.value = false }
})

const selectedCategory = computed(() =>
  categoriesWithSubcategories.value.find(c => c.id === categoryId.value) ?? null)

function onCategoryChange() { subcategoryId.value = '' }

async function start() {
  starting.value = true
  errorMessage.value = null
  try {
    const cat = selectedCategory.value
    const sub = cat?.subcategories.find(s => s.id === subcategoryId.value) ?? null
    const sessionId = await startSession(cat ? {
      categoryId: cat.id,
      subcategoryId: sub?.id ?? null,
      scopeName: sub ? `${cat.name} — ${sub.name}` : cat.name,
    } : null)
    router.push(`/stock-take/${sessionId}`)
  } catch (err) {
    errorMessage.value = err instanceof StockTakeOverlapError
      ? err.message
      : 'تعذّر بدء الجرد. حاول مرة أخرى.'
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="page-root" dir="rtl">
    <AppHeader title="بدء جرد جديد" show-back @back="router.push('/')" />

    <main class="main-content">
      <div class="card">
        <div class="card-icon-wrap">
          <svg class="card-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M6.75 3h10.5A2.25 2.25 0 0119.5 5.25v13.5A2.25 2.25 0 0117.25 21H6.75A2.25 2.25 0 014.5 18.75V5.25A2.25 2.25 0 016.75 3z" />
          </svg>
        </div>
        <p class="card-title">جرد المخزون</p>
        <p class="card-sub">سيتم تجميد الكميات الحالية وطلب عد كل منتج يدويًا. يمكنك تحديد فئة معينة أو جرد كل المخزون.</p>

        <label class="field-label">نطاق الجرد</label>
        <select
          v-model="categoryId"
          data-testid="stock-take-scope-category"
          class="form-input"
          :disabled="loadingCategories"
          @change="onCategoryChange"
        >
          <option value="">كل المنتجات</option>
          <option v-for="c in categoriesWithSubcategories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>

        <template v-if="selectedCategory && selectedCategory.subcategories.length > 0">
          <label class="field-label">فئة فرعية (اختياري)</label>
          <select
            v-model="subcategoryId"
            data-testid="stock-take-scope-subcategory"
            class="form-input"
          >
            <option value="">كل الفئة</option>
            <option v-for="s in selectedCategory.subcategories" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </template>

        <p v-if="errorMessage" class="error-note" role="alert">{{ errorMessage }}</p>

        <button
          type="button"
          class="btn-primary"
          data-testid="stock-take-start-button"
          :disabled="starting"
          @click="start"
        >
          <svg v-if="!starting" class="btn-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {{ starting ? 'جاري البدء...' : 'ابدأ الجرد' }}
        </button>

        <button type="button" class="btn-secondary" @click="router.push('/stock-take/history')">
          سجل الجرد السابق
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: #06090F;
  font-family: 'Tajawal', system-ui, sans-serif;
  color: #E8EDF5;
}

.main-content {
  flex: 1;
  padding: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
@media (min-width: 1024px) {
  .main-content { padding: 1.5rem; }
}

.card {
  width: 100%;
  max-width: 28rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1.75rem 1.25rem;
  border-radius: 1rem;
  background: #0D1828;
  border: 1px solid rgba(255, 255, 255, 0.07);
  text-align: center;
}
@media (min-width: 1024px) {
  .card {
    max-width: 32rem;
    padding: 2.25rem 2rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
}

.card-icon-wrap {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(26, 86, 219, 0.11), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(26, 86, 219, 0.28);
  box-shadow: 0 4px 20px rgba(26, 86, 219, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  color: #93B4F0;
  margin-bottom: 0.25rem;
}
.card-icon { width: 1.75rem; height: 1.75rem; }

.card-title { font-size: 1rem; font-weight: 700; color: #E8EDF5; }
.card-sub { font-size: 0.8125rem; color: #637285; line-height: 1.5; margin-bottom: 0.5rem; }

.field-label {
  align-self: flex-start;
  font-size: 0.75rem;
  color: #637285;
}

.form-input {
  width: 100%;
  height: 44px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.75rem;
  padding: 0 0.875rem;
  color: #E8EDF5;
  font-size: 0.875rem;
  font-family: 'Tajawal', system-ui, sans-serif;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.form-input::placeholder { color: #3D4F6B; }

.error-note {
  align-self: stretch;
  margin: 0;
  border-radius: 0.75rem;
  border: 1px solid rgba(239, 68, 68, 0.38);
  background: rgba(127, 29, 29, 0.24);
  color: #FCA5A5;
  font-size: 0.8125rem;
  line-height: 1.4;
  padding: 0.625rem 0.875rem;
  text-align: right;
}
.form-input:focus {
  border-color: rgba(26, 86, 219, 0.8);
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.25), 0 0 12px rgba(26, 86, 219, 0.15);
}

.btn-primary {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 46px;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: #fff;
  font-size: 0.9375rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(26, 86, 219, 0.40);
  transition: opacity 0.15s, transform 0.15s;
  margin-top: 0.5rem;
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-icon { width: 1rem; height: 1rem; flex-shrink: 0; }

.btn-secondary {
  width: 100%;
  height: 42px;
  border-radius: 0.75rem;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #93B4F0;
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: 'Tajawal', system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn-secondary:hover {
  background: rgba(26, 86, 219, 0.10);
  border-color: rgba(26, 86, 219, 0.35);
}
</style>
