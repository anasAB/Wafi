<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'

/* ── Types ─────────────────────────────────────────────── */
type PosState  = 'idle' | 'cart' | 'payment' | 'receipt'
type SyncState = 'synced' | 'syncing' | 'offline' | 'error'
type PayMethod = 'cash-usd' | 'cash-syp' | 'card' | 'credit'

interface Product {
  id: number; name: string; price: number
  stock: number; threshold: number; cat: string
}
interface CartItem {
  productId: number; name: string
  unitPrice: number; quantity: number
}

/* ── Theme ──────────────────────────────────────────────── */
const isDark = ref(false)

/* ── Sync indicator ────────────────────────────────────── */
const syncState   = ref<SyncState>('synced')
const offlineOps  = ref(3)
function cycleSyncState() {
  const s: SyncState[] = ['synced', 'syncing', 'offline', 'error']
  syncState.value = s[(s.indexOf(syncState.value) + 1) % s.length]
}

/* ── Exchange rate ──────────────────────────────────────── */
const exchangeRate = ref(13500)

/* ── Products catalogue ─────────────────────────────────── */
const PRODUCTS: Product[] = [
  { id: 1,  name: 'آيفون ١٤ برو',      price: 899,  stock: 3,  threshold: 5,  cat: 'هواتف'   },
  { id: 2,  name: 'سامسونج S٢٣',       price: 749,  stock: 0,  threshold: 3,  cat: 'هواتف'   },
  { id: 3,  name: 'AirPods Pro',        price: 199,  stock: 12, threshold: 10, cat: 'إكسسوار' },
  { id: 4,  name: 'شاحن MagSafe 50W',  price: 45,   stock: 8,  threshold: 5,  cat: 'شواحن'   },
  { id: 5,  name: 'كابل USB-C مجدول',  price: 8,    stock: 2,  threshold: 20, cat: 'كابلات'  },
  { id: 6,  name: 'غطاء حماية شفاف',   price: 12,   stock: 45, threshold: 10, cat: 'إكسسوار' },
  { id: 7,  name: 'iPad Pro 12.9"',     price: 1099, stock: 1,  threshold: 2,  cat: 'أجهزة'   },
  { id: 8,  name: 'Apple Watch S9',     price: 399,  stock: 4,  threshold: 3,  cat: 'ساعات'   },
  { id: 9,  name: 'راوتر واي فاي',      price: 55,   stock: 15, threshold: 5,  cat: 'شبكات'   },
  { id: 10, name: 'بطارية 20K',         price: 25,   stock: 20, threshold: 10, cat: 'شواحن'   },
  { id: 11, name: 'سماعة JBL Clip',    price: 89,   stock: 7,  threshold: 5,  cat: 'إكسسوار' },
  { id: 12, name: 'فلاش 128GB',        price: 15,   stock: 30, threshold: 10, cat: 'إكسسوار' },
]

const categories = computed(() => {
  const cats = [...new Set(PRODUCTS.map(p => p.cat))]
  return [{ id: 'all', label: 'الكل' }, ...cats.map(c => ({ id: c, label: c }))]
})

/* ── Search + Filter ────────────────────────────────────── */
const searchQuery    = ref('')
const activeCat      = ref('all')
const searchInputEl  = ref<HTMLInputElement | null>(null)
const barcodeFlash   = ref(false)

const filteredProducts = computed(() => {
  let list = PRODUCTS
  if (activeCat.value !== 'all') list = list.filter(p => p.cat === activeCat.value)
  const q = searchQuery.value.trim().toLowerCase()
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q))
  return list
})

function focusSearch() {
  nextTick(() => searchInputEl.value?.focus())
}

/* ── POS state ──────────────────────────────────────────── */
const posState     = ref<PosState>('idle')
const cartExpanded = ref(false)

watch(posState, (s) => {
  if (s === 'idle' || s === 'cart') focusSearch()
  if (s !== 'cart') cartExpanded.value = false
})

/* ── Cart ───────────────────────────────────────────────── */
const cart         = ref<CartItem[]>([])
const cartDiscount = ref(0)
const cartNote     = ref('')

const subTotal   = computed(() => cart.value.reduce((s, i) => s + i.unitPrice * i.quantity, 0))
const orderTotal = computed(() => Math.max(0, subTotal.value - cartDiscount.value))

function addToCart(p: Product) {
  const ex = cart.value.find(i => i.productId === p.id)
  if (ex) { ex.quantity++ } else {
    cart.value.push({ productId: p.id, name: p.name, unitPrice: p.price, quantity: 1 })
  }
  if (posState.value === 'idle') posState.value = 'cart'
}

function removeItem(id: number) {
  cart.value = cart.value.filter(i => i.productId !== id)
  if (cart.value.length === 0) posState.value = 'idle'
}

function changeQty(id: number, delta: number) {
  const item = cart.value.find(i => i.productId === id)
  if (!item) return
  item.quantity = Math.max(1, item.quantity + delta)
}

/* ── Discount sheet ─────────────────────────────────────── */
const showDiscountSheet = ref(false)
const discountTab       = ref<'pct' | 'fixed'>('pct')
const discountInput     = ref('')

const discountAmt = computed(() => {
  const n = parseFloat(discountInput.value)
  if (!n || n <= 0) return 0
  return discountTab.value === 'pct'
    ? Math.min(subTotal.value * n / 100, subTotal.value)
    : Math.min(n, subTotal.value)
})
const discountInvalid = computed(() =>
  discountTab.value === 'pct'
    ? parseFloat(discountInput.value) > 100
    : discountAmt.value >= subTotal.value && discountInput.value !== ''
)
function applyDiscount() {
  cartDiscount.value = discountAmt.value
  discountInput.value = ''
  showDiscountSheet.value = false
}

/* ── Note sheet ─────────────────────────────────────────── */
const showNoteSheet = ref(false)
const noteInput     = ref('')
function openNote()  { noteInput.value = cartNote.value; showNoteSheet.value = true }
function saveNote()  { cartNote.value = noteInput.value; showNoteSheet.value = false }

/* ── Payment ────────────────────────────────────────────── */
const payMethod1       = ref<PayMethod>('cash-usd')
const payMethod2       = ref<PayMethod>('card')
const splitEnabled     = ref(false)
const tender1          = ref('')
const tender2          = ref('')
const customerSearch   = ref('')

const tender1USD = computed(() => {
  const n = parseFloat(tender1.value) || 0
  return payMethod1.value === 'cash-syp' ? n / exchangeRate.value : n
})
const tender2USD = computed(() => {
  const n = parseFloat(tender2.value) || 0
  return payMethod2.value === 'cash-syp' ? n / exchangeRate.value : n
})

const changeUSD = computed(() => {
  if (splitEnabled.value) return null
  if (payMethod1.value === 'card' || payMethod1.value === 'credit') return null
  return tender1USD.value - orderTotal.value
})

const splitSum   = computed(() => tender1USD.value + tender2USD.value)
const splitDiff  = computed(() => splitSum.value - orderTotal.value)

const canConfirm = computed(() => {
  if (orderTotal.value === 0) return false
  if (!splitEnabled.value) {
    if (payMethod1.value === 'card')   return true
    if (payMethod1.value === 'credit') return customerSearch.value.trim().length > 0
    return tender1USD.value >= orderTotal.value
  }
  return Math.abs(splitDiff.value) < 0.005
})

const confirming = ref(false)
async function confirmPayment() {
  if (!canConfirm.value) return
  confirming.value = true
  await new Promise(r => setTimeout(r, 500))
  confirming.value = false
  if (syncState.value === 'offline') offlineOps.value++
  posState.value = 'receipt'
  startCountdown()
}

/* ── Receipt countdown ──────────────────────────────────── */
let cdTimer: ReturnType<typeof setInterval> | null = null
const cdProgress = ref(100)

function startCountdown() {
  cdProgress.value = 100
  cdTimer = setInterval(() => {
    cdProgress.value -= 2
    if (cdProgress.value <= 0) returnToIdle()
  }, 100)
}

function resetCountdown() {
  if (cdTimer) clearInterval(cdTimer)
  cdProgress.value = 100
  cdTimer = setInterval(() => {
    cdProgress.value -= 2
    if (cdProgress.value <= 0) returnToIdle()
  }, 100)
}

function returnToIdle() {
  if (cdTimer) clearInterval(cdTimer)
  cart.value = []
  cartDiscount.value = 0
  cartNote.value = ''
  tender1.value = ''; tender2.value = ''
  splitEnabled.value = false
  payMethod1.value = 'cash-usd'
  customerSearch.value = ''
  posState.value = 'idle'
  cdProgress.value = 100
  focusSearch()
}

onUnmounted(() => { if (cdTimer) clearInterval(cdTimer) })

/* ── Three-dot menu sheet ───────────────────────────────── */
const showMenuSheet = ref(false)

/* ── Helpers ────────────────────────────────────────────── */
function fmtUSD(n: number) { return '$' + n.toFixed(2) }
function fmtSYP(n: number) { return (n | 0).toLocaleString('ar-SA') + ' ل.س' }
function toEastern(n: number) {
  return n.toString().replace(/[0-9]/g, ch => '٠١٢٣٤٥٦٧٨٩'[+ch])
}

const syncIcon = computed(() => {
  if (syncState.value === 'synced')  return { color: '#059669', label: '' }
  if (syncState.value === 'syncing') return { color: '#1A56DB', label: 'جاري المزامنة…' }
  if (syncState.value === 'offline') return { color: '#D97706', label: `أوفلاين · ${toEastern(offlineOps.value)} عمليات` }
  return { color: '#DC2626', label: 'خطأ في المزامنة' }
})

const PAY_METHODS: { id: PayMethod; label: string }[] = [
  { id: 'cash-usd', label: 'نقد دولار' },
  { id: 'cash-syp', label: 'نقد ليرة'  },
  { id: 'card',     label: 'بطاقة'     },
  { id: 'credit',   label: 'على الحساب' },
]
</script>

<template>
  <div class="pos-shell" :class="{ dark: isDark }" dir="rtl">

    <!-- ── Dev bar ─────────────────────────────────────────── -->
    <div class="dev-bar">
      <button @click="isDark = !isDark"   class="dev-btn">{{ isDark ? '☀️' : '🌙' }}</button>
      <button @click="cycleSyncState"     class="dev-btn">Sync: {{ syncState }}</button>
      <button @click="posState = 'idle';  cart = []; cartDiscount = 0" class="dev-btn" :class="{ active: posState === 'idle' }">فارغ</button>
    </div>

    <!-- ══ Zone A — Top Bar ══════════════════════════════════ -->
    <header class="zone-a">
      <!-- Shop + cashier (right in RTL) -->
      <div class="za-shop">
        <div class="za-shop-name">محل النور</div>
        <div class="za-cashier">أحمد · ٢س ١٥د</div>
      </div>

      <!-- Sync indicator (center) -->
      <div class="za-sync" @click="cycleSyncState" title="حالة المزامنة">
        <span
          class="sync-dot"
          :class="{ 'spin-arc': syncState === 'syncing' }"
          :style="{ background: syncIcon.color }"
        ></span>
        <span v-if="syncIcon.label" class="sync-label" :style="{ color: syncIcon.color }">
          {{ syncIcon.label }}
        </span>
      </div>

      <!-- Three-dot menu (left in RTL) -->
      <button class="za-menu-btn" @click="showMenuSheet = true" aria-label="القائمة">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5"  r="1.5"/>
          <circle cx="12" cy="12" r="1.5"/>
          <circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
    </header>

    <!-- ══ Zones container ════════════════════════════════════ -->
    <div class="zones-wrap">

      <!-- ── Zone B — Product Discovery ──────────────────────── -->
      <div class="zone-b" :class="{ 'zb-dimmed': posState === 'payment', 'zb-collapsed': cartExpanded }">

        <!-- Search bar -->
        <div class="search-wrap">
          <div class="search-bar" :class="{ 'blink-border': barcodeFlash }">
            <svg class="search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref="searchInputEl"
              v-model="searchQuery"
              class="search-input"
              type="search"
              placeholder="ابحث أو امسح الباركود…"
              dir="rtl"
              inputmode="search"
              autocomplete="off"
              :disabled="posState === 'payment'"
            />
            <button class="barcode-btn" aria-label="مسح الباركود" @click="addToCart(PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)])">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M3 5v-2h2"/><path d="M19 3h2v2"/><path d="M21 19v2h-2"/><path d="M5 21H3v-2"/>
                <line x1="7" y1="6" x2="7" y2="18"/><line x1="10" y1="6" x2="10" y2="18"/>
                <line x1="14" y1="6" x2="14" y2="18"/><line x1="17" y1="6" x2="17" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Category tabs -->
        <div class="cat-tabs-wrap">
          <div class="cat-tabs">
            <button
              v-for="c in categories" :key="c.id"
              class="cat-tab"
              :class="{ active: activeCat === c.id }"
              @click="activeCat = c.id"
            >{{ c.label }}</button>
          </div>
        </div>

        <!-- Product grid -->
        <div class="product-grid" :class="{ 'grid-hidden': cartExpanded }">

          <!-- Not-found state -->
          <div v-if="filteredProducts.length === 0" class="grid-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <div class="grid-empty-title">ما لقينا هالمنتج</div>
            <button class="grid-empty-add">+ إضافة منتج مخصص</button>
          </div>

          <template v-else>
            <button
              v-for="p in filteredProducts" :key="p.id"
              class="prod-card"
              :class="{ 'pc-out': p.stock === 0 }"
              @click="addToCart(p)"
              :disabled="posState === 'payment'"
            >
              <!-- Stock badges -->
              <span v-if="p.stock === 0" class="pc-badge out-badge">نفد</span>
              <span v-else-if="p.stock < p.threshold" class="pc-low-dot" title="مخزون منخفض"></span>

              <!-- Product image placeholder -->
              <div class="pc-img">{{ p.name.charAt(0) }}</div>

              <div class="pc-name">{{ p.name }}</div>
              <div class="pc-price-usd" dir="ltr">{{ fmtUSD(p.price) }}</div>
              <div class="pc-price-syp">{{ fmtSYP(p.price * exchangeRate) }}</div>
            </button>
          </template>

        </div>
      </div><!-- /.zone-b -->

      <!-- ── Zone C — Cart / Checkout ─────────────────────────── -->
      <div class="zone-c" :class="{ 'zc-expanded': cartExpanded }">

        <!-- Drag handle (expands/collapses cart) -->
        <button
          v-if="posState === 'cart'"
          class="drag-handle-wrap"
          @click="cartExpanded = !cartExpanded"
          :aria-label="cartExpanded ? 'تصغير السلة' : 'تكبير السلة'"
        >
          <div class="drag-handle"></div>
        </button>

        <!-- ── STATE 1: IDLE ─────────────────────────────────── -->
        <div v-if="posState === 'idle'" class="cart-idle">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.61L23 6H6"/>
          </svg>
          <div class="cart-idle-text">امسح الباركود أو اختر منتج</div>
          <button class="open-drawer-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
            </svg>
            فتح الصندوق
          </button>
        </div>

        <!-- ── STATES 2 + 3: CART + PAYMENT ─────────────────── -->
        <template v-if="posState === 'cart' || posState === 'payment'">
          <div class="zc-content">

            <Transition name="zc-slide" mode="out-in">

              <!-- Cart view -->
              <div v-if="posState === 'cart'" key="cart" class="cart-view">

                <!-- Cart header -->
                <div class="cart-header">
                  <span class="cart-title">السلة</span>
                  <span class="cart-count">{{ toEastern(cart.length) }} منتجات</span>
                </div>

                <!-- Cart line items -->
                <div class="cart-items">
                  <div v-for="item in cart" :key="item.productId" class="cart-row">
                    <!-- Product info (right side in RTL) -->
                    <div class="cr-info">
                      <div class="cr-name">{{ item.name }}</div>
                      <div class="cr-unit" dir="ltr">{{ fmtUSD(item.unitPrice) }} / قطعة</div>
                    </div>
                    <!-- Qty controls -->
                    <div class="cr-qty">
                      <button class="qty-btn" @click="changeQty(item.productId, -1)" aria-label="تقليل">−</button>
                      <span class="qty-num">{{ toEastern(item.quantity) }}</span>
                      <button class="qty-btn" @click="changeQty(item.productId, 1)"  aria-label="زيادة">+</button>
                    </div>
                    <!-- Line total + delete -->
                    <div class="cr-total-wrap">
                      <div class="cr-total" dir="ltr">{{ fmtUSD(item.unitPrice * item.quantity) }}</div>
                      <button class="cr-delete" @click="removeItem(item.productId)" aria-label="حذف">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Cart footer: totals + action buttons -->
                <div class="cart-footer">
                  <div class="cf-row">
                    <span class="cf-label">المجموع</span>
                    <span class="cf-val" dir="ltr">{{ fmtUSD(subTotal) }}</span>
                  </div>
                  <div v-if="cartDiscount > 0" class="cf-row cf-discount">
                    <span class="cf-label disc-lbl">
                      خصم
                      <button class="disc-remove" @click="cartDiscount = 0" aria-label="إزالة الخصم">×</button>
                    </span>
                    <span class="cf-val disc-val" dir="ltr">−{{ fmtUSD(cartDiscount) }}</span>
                  </div>
                  <div class="cf-row cf-total">
                    <span class="cf-total-lbl">الإجمالي</span>
                    <div class="cf-total-right">
                      <div class="cf-total-usd" dir="ltr">{{ fmtUSD(orderTotal) }}</div>
                      <div class="cf-total-syp">{{ fmtSYP(orderTotal * exchangeRate) }}</div>
                    </div>
                  </div>

                  <!-- Action row -->
                  <div class="cart-actions">
                    <button class="cart-action-btn" @click="showDiscountSheet = true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
                      </svg>
                      إضافة خصم
                    </button>
                    <button class="cart-action-btn" :class="{ 'has-note': cartNote }" @click="openNote">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                      {{ cartNote ? 'تعديل الملاحظة' : 'إضافة ملاحظة' }}
                    </button>
                  </div>
                </div>

              </div><!-- /cart-view -->

              <!-- Payment view -->
              <div v-else-if="posState === 'payment'" key="payment" class="payment-view">

                <!-- Payment header -->
                <div class="pay-header">
                  <button class="pay-back" @click="posState = 'cart'" aria-label="العودة للسلة">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    العودة للسلة
                  </button>
                  <span class="pay-title">الدفع</span>
                </div>

                <!-- Amount due banner -->
                <div class="pay-amount-banner">
                  <div class="pab-label">المبلغ المطلوب</div>
                  <div class="pab-usd" dir="ltr">{{ fmtUSD(orderTotal) }}</div>
                  <div class="pab-syp">{{ fmtSYP(orderTotal * exchangeRate) }}</div>
                </div>

                <!-- Payment method tiles -->
                <div class="pay-methods-label">طريقة الدفع</div>
                <div class="pay-methods">
                  <button
                    v-for="m in PAY_METHODS" :key="m.id"
                    class="pay-tile"
                    :class="{ active: payMethod1 === m.id }"
                    @click="payMethod1 = m.id; splitEnabled = false; tender1 = ''"
                  >
                    <!-- Cash USD -->
                    <svg v-if="m.id === 'cash-usd'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                    <!-- Cash SYP -->
                    <svg v-else-if="m.id === 'cash-syp'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                    </svg>
                    <!-- Card -->
                    <svg v-else-if="m.id === 'card'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                      <path d="M4 15h.01M8 15h2"/>
                    </svg>
                    <!-- Credit -->
                    <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                    <span>{{ m.label }}</span>
                  </button>
                </div>

                <!-- Cash USD input -->
                <div v-if="payMethod1 === 'cash-usd' && !splitEnabled" class="pay-input-wrap">
                  <label class="pay-input-label" for="tender1-usd">المبلغ المدفوع بالدولار</label>
                  <input
                    id="tender1-usd"
                    v-model="tender1"
                    type="number"
                    class="pay-input"
                    dir="ltr"
                    inputmode="decimal"
                    :placeholder="orderTotal.toFixed(2)"
                  />
                  <div v-if="tender1" class="pay-change" :class="changeUSD! >= 0 ? 'change-ok' : 'change-short'">
                    <template v-if="changeUSD! > 0.005">
                      الباقي: {{ fmtUSD(changeUSD!) }}
                      <span class="change-syp">{{ fmtSYP(changeUSD! * exchangeRate) }}</span>
                    </template>
                    <template v-else-if="changeUSD! < -0.005">ناقص: {{ fmtUSD(-changeUSD!) }}</template>
                    <template v-else>بالضبط ✓</template>
                  </div>
                </div>

                <!-- Cash SYP input -->
                <div v-else-if="payMethod1 === 'cash-syp' && !splitEnabled" class="pay-input-wrap">
                  <label class="pay-input-label" for="tender1-syp">المبلغ المدفوع بالليرة</label>
                  <input
                    id="tender1-syp"
                    v-model="tender1"
                    type="number"
                    class="pay-input"
                    dir="ltr"
                    inputmode="numeric"
                    :placeholder="(orderTotal * exchangeRate).toFixed(0)"
                  />
                  <div v-if="tender1" class="pay-change" :class="changeUSD! >= 0 ? 'change-ok' : 'change-short'">
                    يعادل {{ fmtUSD(tender1USD) }}
                  </div>
                </div>

                <!-- Card: no input needed -->
                <div v-else-if="payMethod1 === 'card' && !splitEnabled" class="pay-card-info">
                  سيتم تسجيل الدفع ببطاقة بمبلغ {{ fmtUSD(orderTotal) }}
                </div>

                <!-- Credit account: customer search -->
                <div v-else-if="payMethod1 === 'credit' && !splitEnabled" class="pay-credit-wrap">
                  <label class="pay-input-label" for="cust-search">اختر الزبون</label>
                  <input
                    id="cust-search"
                    v-model="customerSearch"
                    type="text"
                    class="pay-input"
                    placeholder="ابحث باسم الزبون أو رقمه"
                    dir="rtl"
                  />
                </div>

                <!-- Split payment -->
                <div v-if="splitEnabled" class="split-wrap">
                  <div class="split-row">
                    <select v-model="payMethod1" class="split-method-sel">
                      <option v-for="m in PAY_METHODS.slice(0,3)" :key="m.id" :value="m.id">{{ m.label }}</option>
                    </select>
                    <input v-model="tender1" type="number" class="split-input" dir="ltr" placeholder="0.00" inputmode="decimal" />
                  </div>
                  <div class="split-row">
                    <select v-model="payMethod2" class="split-method-sel">
                      <option v-for="m in PAY_METHODS.slice(0,3)" :key="m.id" :value="m.id">{{ m.label }}</option>
                    </select>
                    <input v-model="tender2" type="number" class="split-input" dir="ltr" placeholder="0.00" inputmode="decimal" />
                  </div>
                  <div class="split-status" :class="Math.abs(splitDiff) < 0.005 ? 'split-ok' : 'split-short'">
                    المدفوع: {{ fmtUSD(splitSum) }}
                    <template v-if="Math.abs(splitDiff) >= 0.005">
                      · {{ splitDiff < 0 ? 'ناقص' : 'زيادة' }} {{ fmtUSD(Math.abs(splitDiff)) }}
                    </template>
                    <template v-else> ✓</template>
                  </div>
                </div>

                <!-- Split toggle link -->
                <button
                  v-if="!splitEnabled && payMethod1 !== 'credit'"
                  class="split-link"
                  @click="splitEnabled = true"
                >+ إضافة طريقة دفع</button>
                <button
                  v-else-if="splitEnabled"
                  class="split-link"
                  @click="splitEnabled = false; tender2 = ''"
                >− حذف الدفع المنقسم</button>

              </div><!-- /payment-view -->

            </Transition>

          </div><!-- /.zc-content (scrollable) -->

          <!-- Sticky bottom button -->
          <div class="zc-sticky-btn">
            <!-- Checkout button (cart state) -->
            <button
              v-if="posState === 'cart'"
              class="checkout-btn"
              :disabled="cart.length === 0"
              @click="posState = 'payment'"
            >
              <span>الدفع</span>
              <span v-if="orderTotal > 0" dir="ltr"> {{ fmtUSD(orderTotal) }}</span>
            </button>

            <!-- Confirm payment button (payment state) -->
            <button
              v-else-if="posState === 'payment'"
              class="confirm-btn"
              :disabled="!canConfirm || confirming"
              @click="confirmPayment"
            >
              <span v-if="confirming" class="btn-spinner"></span>
              <span v-else>تأكيد الدفع</span>
            </button>
          </div>

        </template>

      </div><!-- /.zone-c -->

    </div><!-- /.zones-wrap -->

    <!-- ══ STATE 4: RECEIPT — full-screen overlay ════════════ -->
    <Transition name="receipt-fade">
      <div v-if="posState === 'receipt'" class="receipt-overlay" role="dialog" aria-label="تمت البيعة">

        <!-- Countdown progress bar -->
        <div class="receipt-cd-bar">
          <div class="receipt-cd-fill" :style="{ width: cdProgress + '%' }"></div>
        </div>

        <div class="receipt-content">
          <!-- Success animation -->
          <div class="receipt-check">
            <svg class="check-svg" viewBox="0 0 52 52">
              <circle class="check-circle" cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="2"/>
              <polyline class="check-mark" points="14.1 27.2 21.1 34.2 38.1 17.8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </div>

          <div class="receipt-title">تمت البيعة</div>
          <div class="receipt-meta" dir="ltr">
            {{ fmtUSD(orderTotal) }}
            <span class="receipt-items">· {{ toEastern(cart.length) }} منتجات</span>
          </div>

          <div v-if="(changeUSD ?? 0) > 0.005 && !splitEnabled" class="receipt-change">
            الباقي المُعطى: {{ fmtUSD(changeUSD!) }}
          </div>

          <!-- Action buttons -->
          <div class="receipt-actions">
            <button class="receipt-btn print-btn" @click="resetCountdown">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              طباعة
            </button>
            <button class="receipt-btn wa-btn" @click="resetCountdown">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.554 4.122 1.522 5.855L0 24l6.254-1.494A11.953 11.953 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.795 9.795 0 01-5.004-1.372l-.36-.214-3.712.886.886-3.617-.235-.372A9.797 9.797 0 012.182 12C2.182 6.573 6.573 2.182 12 2.182S21.818 6.573 21.818 12 17.427 21.818 12 21.818z"/>
              </svg>
              واتساب
            </button>
          </div>

          <button class="receipt-skip" @click="returnToIdle">تخطي</button>
        </div>

      </div>
    </Transition>

    <!-- ══ Discount Bottom Sheet ════════════════════════════ -->
    <Transition name="sheet">
      <div v-if="showDiscountSheet" class="sheet-overlay" @click.self="showDiscountSheet = false" role="dialog" aria-label="إضافة خصم">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <span class="sheet-title">الخصم</span>
            <button class="sheet-close" @click="showDiscountSheet = false" aria-label="إغلاق">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <!-- Tabs -->
          <div class="disc-tabs">
            <button class="disc-tab" :class="{ active: discountTab === 'pct' }"   @click="discountTab = 'pct';   discountInput = ''">نسبة مئوية</button>
            <button class="disc-tab" :class="{ active: discountTab === 'fixed' }" @click="discountTab = 'fixed'; discountInput = ''">مبلغ ثابت</button>
          </div>

          <div class="disc-input-wrap">
            <input
              v-model="discountInput"
              type="number"
              class="disc-big-input"
              dir="ltr"
              inputmode="decimal"
              :placeholder="discountTab === 'pct' ? '0' : '0.00'"
              :class="{ 'input-error': discountInvalid }"
            />
            <span class="disc-suffix">{{ discountTab === 'pct' ? '%' : '$' }}</span>
          </div>

          <div v-if="discountAmt > 0 && !discountInvalid" class="disc-preview">
            خصم {{ fmtUSD(discountAmt) }} على مجموع {{ fmtUSD(subTotal) }} = {{ fmtUSD(subTotal - discountAmt) }}
          </div>
          <div v-if="discountInvalid" class="disc-error">الخصم لا يمكن أن يتجاوز المجموع</div>

          <button class="disc-apply-btn" :disabled="discountAmt <= 0 || discountInvalid" @click="applyDiscount">
            تطبيق الخصم
          </button>
        </div>
      </div>
    </Transition>

    <!-- ══ Note Bottom Sheet ════════════════════════════════ -->
    <Transition name="sheet">
      <div v-if="showNoteSheet" class="sheet-overlay" @click.self="showNoteSheet = false" role="dialog" aria-label="ملاحظة">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <span class="sheet-title">ملاحظة على البيعة</span>
            <button class="sheet-close" @click="showNoteSheet = false" aria-label="إغلاق">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div style="padding: 16px 20px 8px">
            <input
              v-model="noteInput"
              type="text"
              class="note-input"
              placeholder="مثلاً: توصيل للمنزل، اتصل قبل الإرسال"
              dir="rtl"
            />
          </div>
          <button class="disc-apply-btn" @click="saveNote" style="margin-top: 0">حفظ الملاحظة</button>
        </div>
      </div>
    </Transition>

    <!-- ══ Three-dot Menu Sheet ════════════════════════════ -->
    <Transition name="sheet">
      <div v-if="showMenuSheet" class="sheet-overlay" @click.self="showMenuSheet = false" role="dialog" aria-label="القائمة">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div class="menu-list">
            <button class="menu-item">تبديل الكاشير</button>
            <button class="menu-item">إغلاق الوردية</button>
            <button class="menu-item">إعدادات الطابعة</button>
            <button class="menu-item">استرجاع مبيعة</button>
            <button class="menu-item menu-item-danger" @click="showMenuSheet = false">تسجيل الخروج</button>
          </div>
        </div>
      </div>
    </Transition>

  </div><!-- /.pos-shell -->
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');

/* ═══════════════════════════════════════════════
   CSS VARIABLES — Light Mode
═══════════════════════════════════════════════ */
.pos-shell {
  --bg:           #FFFFFF;
  --bg-muted:     #F3F4F6;
  --bg-card:      #FFFFFF;
  --bg-input:     #FFFFFF;
  --border:       #E5E7EB;
  --text-dark:    #111928;
  --text-body:    #4B5563;
  --text-muted:   #6B7280;
  --text-faint:   #9CA3AF;

  --primary:      #1A56DB;
  --primary-lt:   #EBF1FD;
  --primary-hover:#1447BE;

  --success:      #059669;
  --success-bg:   #D1FAE5;
  --success-dark: #065F46;

  --error:        #DC2626;
  --error-bg:     #FEE2E2;

  --zone-b-bg:    #F9FAFB;
  --zone-c-bg:    #FFFFFF;
  --zone-border:  #E5E7EB;
  --zone-c-shadow: 0 -2px 12px rgba(0,0,0,.08);

  --nav-bg:       rgba(255,255,255,.96);
  --shadow-sheet: 0 -4px 32px rgba(0,0,0,.12);
}

/* ── Dark Mode ──────────────────────────────────────────── */
.pos-shell.dark {
  --bg:           #05080F;
  --bg-muted:     #0D1828;
  --bg-card:      #0D1828;
  --bg-input:     #111D2E;
  --border:       rgba(255,255,255,.08);
  --text-dark:    #E8EDF5;
  --text-body:    #C8D5E8;
  --text-muted:   #637285;
  --text-faint:   #3D4F6B;

  --primary:      #3B82F6;
  --primary-lt:   rgba(59,130,246,.12);
  --primary-hover:#60A5FA;

  --success:      #10B981;
  --success-bg:   rgba(16,185,129,.10);
  --success-dark: #34D399;

  --error:        #EF4444;
  --error-bg:     rgba(239,68,68,.08);

  --zone-b-bg:    #070B14;
  --zone-c-bg:    #07090F;
  --zone-border:  rgba(255,255,255,.06);
  --zone-c-shadow: 0 -2px 16px rgba(0,0,0,.4);

  --shadow-sheet: 0 -4px 40px rgba(0,0,0,.5);
}

/* ═══════════════════════════════════════════════
   BASE
═══════════════════════════════════════════════ */
.pos-shell {
  height: 100svh;
  max-width: 430px;
  margin: 0 auto;
  background: var(--bg);
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* Dev bar */
.dev-bar {
  display: flex;
  gap: 6px;
  padding: 6px 10px;
  background: #111827;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.dev-btn {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 5px;
  background: rgba(255,255,255,.08);
  color: #9CA3AF;
  border: 1px solid rgba(255,255,255,.1);
  cursor: pointer;
  font-family: 'Tajawal', sans-serif;
  transition: all .15s;
}
.dev-btn.active { background: #1A56DB; color: #fff; border-color: #1A56DB; }

/* ═══════════════════════════════════════════════
   ZONE A — TOP BAR
═══════════════════════════════════════════════ */
.zone-a {
  height: 56px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  flex-shrink: 0;
  z-index: 10;
}

.za-shop { display: flex; flex-direction: column; gap: 1px; }
.za-shop-name { font-size: 14px; font-weight: 700; color: var(--text-dark); }
.za-cashier   { font-size: 11px; color: var(--text-muted); }

.za-sync {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  user-select: none;
}
.sync-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sync-dot.spin-arc {
  border-radius: 50%;
  border: 2px solid transparent;
  animation: spin-arc .8s linear infinite;
}
@keyframes spin-arc {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.sync-label { font-size: 11px; font-weight: 600; }

.za-menu-btn {
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: var(--text-muted); border-radius: 8px;
  transition: background .15s, color .15s;
}
.za-menu-btn:hover { background: var(--bg-muted); color: var(--text-dark); }

/* ═══════════════════════════════════════════════
   ZONES CONTAINER
═══════════════════════════════════════════════ */
.zones-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* ═══════════════════════════════════════════════
   ZONE B — PRODUCT DISCOVERY
═══════════════════════════════════════════════ */
.zone-b {
  flex: 1;
  min-height: 0;
  background: var(--zone-b-bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: opacity .2s;
}
.zone-b.zb-dimmed { opacity: .4; pointer-events: none; }
.zone-b.zb-collapsed { flex: 0 0 auto; min-height: 0; max-height: 96px; }

/* Search bar */
.search-wrap {
  padding: 10px 14px 0;
  flex-shrink: 0;
}
.search-bar {
  display: flex;
  align-items: center;
  height: 48px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  gap: 0;
  transition: border-color .2s, box-shadow .2s;
}
.search-bar:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(26,86,219,.10);
}
.search-bar.blink-border { border-color: var(--success); }

.search-ico  { flex-shrink: 0; padding: 0 10px; color: var(--text-faint); }
.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  color: var(--text-dark);
  min-width: 0;
}
.search-input::placeholder { color: var(--text-faint); }

.barcode-btn {
  width: 48px; height: 48px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: var(--text-muted);
  border-right: 1px solid var(--border);
  transition: background .15s, color .15s;
}
.barcode-btn:hover { background: var(--bg-muted); color: var(--primary); }

/* Category tabs */
.cat-tabs-wrap {
  padding: 8px 14px 6px;
  flex-shrink: 0;
}
.cat-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.cat-tabs::-webkit-scrollbar { display: none; }
.cat-tab {
  padding: 5px 14px;
  height: 36px;
  border-radius: 100px;
  border: 1.5px solid var(--border);
  background: var(--bg-card);
  color: var(--text-body);
  font-family: 'Tajawal', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
  flex-shrink: 0;
}
.cat-tab.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 700; }
.cat-tab:hover:not(.active) { border-color: var(--primary); color: var(--primary); }

/* Product grid */
.product-grid {
  flex: 1;
  overflow-y: auto;
  padding: 4px 14px 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-content: start;
  -webkit-overflow-scrolling: touch;
}
.product-grid.grid-hidden { display: none; }

.grid-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 0;
  color: var(--text-muted);
}
.grid-empty-title { font-size: 14px; font-weight: 600; }
.grid-empty-add {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  color: var(--primary);
  background: var(--primary-lt);
  border: none; border-radius: 8px;
  padding: 8px 16px; cursor: pointer;
}

.prod-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
  text-align: right;
  font-family: 'Tajawal', sans-serif;
  position: relative;
  transition: border-color .15s, transform .1s;
}
.prod-card:not(:disabled):hover  { border-color: var(--primary); }
.prod-card:not(:disabled):active { transform: scale(.97); }
.prod-card.pc-out { opacity: .7; }

.pc-badge {
  position: absolute;
  top: 7px;
  left: 7px;
  font-size: 9px; font-weight: 700;
  padding: 2px 6px;
  border-radius: 100px;
}
.out-badge { background: var(--error-bg); color: var(--error); }

.pc-low-dot {
  position: absolute;
  top: 9px; left: 9px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #D97706;
}

.pc-img {
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-muted);
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  color: var(--text-faint);
  max-height: 72px;
}

.pc-name      { font-size: 12px; font-weight: 600; color: var(--text-dark); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pc-price-usd { font-size: 13px; font-weight: 700; color: var(--text-dark); }
.pc-price-syp { font-size: 10px; color: var(--text-muted); }

/* ═══════════════════════════════════════════════
   ZONE C — CART / CHECKOUT
═══════════════════════════════════════════════ */
.zone-c {
  flex: 0 0 auto;
  height: 44svh;
  background: var(--zone-c-bg);
  border-top: 1px solid var(--zone-border);
  box-shadow: var(--zone-c-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: height .28s cubic-bezier(.4,0,.2,1);
}
.zone-c.zc-expanded { height: 72svh; }

/* Drag handle */
.drag-handle-wrap {
  background: transparent;
  border: none;
  cursor: row-resize;
  padding: 8px 0 4px;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
  touch-action: none;
}
.drag-handle {
  width: 36px; height: 4px;
  background: var(--border);
  border-radius: 100px;
}

/* Idle state */
.cart-idle {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  padding: 16px;
}
.cart-idle-text   { font-size: 14px; color: var(--text-muted); }
.open-drawer-btn {
  display: flex; align-items: center; gap: 6px;
  font-family: 'Tajawal', sans-serif;
  font-size: 12px; font-weight: 600;
  color: var(--text-faint);
  background: transparent;
  border: none; cursor: pointer;
  padding: 6px 12px;
  transition: color .15s;
  margin-top: 8px;
}
.open-drawer-btn:hover { color: var(--text-muted); }

/* zc-content wraps scrollable + sticky btn */
.zc-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.zc-sticky-btn {
  flex-shrink: 0;
  padding: 8px 14px;
  background: var(--zone-c-bg);
  border-top: 1px solid var(--border);
}

/* Cart view */
.cart-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  min-height: 0;
}

.cart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px 4px;
  flex-shrink: 0;
}
.cart-title { font-size: 13px; font-weight: 700; color: var(--text-dark); }
.cart-count { font-size: 12px; color: var(--text-muted); }

.cart-items { flex: 0 0 auto; }
.cart-row {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  min-height: 60px;
}

.cr-info    { flex: 1; min-width: 0; }
.cr-name    { font-size: 13px; font-weight: 600; color: var(--text-dark); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-unit    { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.cr-qty {
  display: flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.qty-btn {
  width: 30px; height: 30px;
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 16px; font-weight: 700;
  color: var(--text-dark);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.qty-btn:hover { background: var(--primary-lt); border-color: var(--primary); color: var(--primary); }
.qty-num { font-size: 14px; font-weight: 700; color: var(--text-dark); min-width: 20px; text-align: center; }

.cr-total-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; flex-shrink: 0; }
.cr-total  { font-size: 13px; font-weight: 700; color: var(--text-dark); }
.cr-delete {
  background: transparent; border: none; cursor: pointer;
  color: var(--text-faint); padding: 4px;
  transition: color .15s;
}
.cr-delete:hover { color: var(--error); }

/* Cart footer */
.cart-footer {
  padding: 10px 14px 4px;
  flex-shrink: 0;
}
.cf-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}
.cf-label    { font-size: 13px; color: var(--text-muted); }
.cf-val      { font-size: 13px; font-weight: 600; color: var(--text-body); }
.cf-discount { }
.disc-lbl    { display: flex; align-items: center; gap: 6px; color: #D97706; font-weight: 600; }
.disc-val    { color: #D97706; }
.disc-remove {
  background: transparent; border: none; cursor: pointer;
  color: #D97706; font-size: 14px; padding: 0; line-height: 1;
}

.cf-total      { padding: 8px 0 4px; border-top: 1px solid var(--border); margin-top: 4px; align-items: flex-start; }
.cf-total-lbl  { font-size: 15px; font-weight: 700; color: var(--text-dark); }
.cf-total-right { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
.cf-total-usd  { font-size: 15px; font-weight: 700; color: var(--text-dark); }
.cf-total-syp  { font-size: 11px; color: var(--text-muted); }

.cart-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.cart-action-btn {
  display: flex; align-items: center; gap: 6px;
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: all .15s;
  min-height: 36px;
}
.cart-action-btn:hover { color: var(--primary); border-color: var(--primary); background: var(--primary-lt); }
.cart-action-btn.has-note { color: var(--primary); border-color: var(--primary); }

/* ── Checkout button ──────────────────────────────────── */
.checkout-btn {
  width: 100%;
  height: 52px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background .15s;
}
.checkout-btn:not(:disabled):hover { background: var(--primary-hover); }
.checkout-btn:disabled { opacity: .45; cursor: not-allowed; }

/* ═══════════════════════════════════════════════
   PAYMENT VIEW
═══════════════════════════════════════════════ */
.payment-view {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 4px;
  flex-shrink: 0;
}
.pay-back {
  display: flex; align-items: center; gap: 4px;
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  color: var(--primary);
  background: transparent; border: none;
  cursor: pointer; padding: 6px 0;
}
.pay-title { font-size: 15px; font-weight: 700; color: var(--text-dark); }

.pay-amount-banner {
  margin: 6px 14px 10px;
  background: var(--primary-lt);
  border: 1px solid rgba(26,86,219,.18);
  border-radius: 10px;
  padding: 14px 16px;
  text-align: center;
}
.pab-label { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
.pab-usd   { font-size: 32px; font-weight: 700; color: var(--text-dark); line-height: 1; }
.pab-syp   { font-size: 13px; color: var(--text-muted); margin-top: 4px; }

.pay-methods-label { font-size: 12px; font-weight: 700; color: var(--text-muted); padding: 0 14px 8px; }
.pay-methods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 0 14px;
}
.pay-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 72px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  color: var(--text-body);
  cursor: pointer;
  transition: all .15s;
}
.pay-tile:hover  { border-color: var(--primary); color: var(--primary); }
.pay-tile.active { background: var(--primary-lt); border-color: var(--primary); color: var(--primary); border-width: 2px; }

.pay-input-wrap, .pay-credit-wrap {
  padding: 10px 14px 0;
}
.pay-input-label {
  font-size: 12px; font-weight: 700; color: var(--text-muted);
  display: block; margin-bottom: 6px;
}
.pay-input {
  width: 100%;
  height: 52px;
  background: var(--bg-input);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  font-family: 'Tajawal', sans-serif;
  font-size: 20px; font-weight: 700;
  color: var(--text-dark);
  outline: none;
  box-sizing: border-box;
  transition: border-color .2s, box-shadow .2s;
}
.pay-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(26,86,219,.10); }
.pay-input::-webkit-outer-spin-button,
.pay-input::-webkit-inner-spin-button { -webkit-appearance: none; }

.pay-change {
  font-size: 14px; font-weight: 700;
  margin-top: 8px;
  display: flex; align-items: center; gap: 8px;
}
.change-ok    { color: var(--success); }
.change-short { color: var(--error);   }
.change-syp   { font-size: 12px; font-weight: 500; opacity: .75; }

.pay-card-info {
  margin: 10px 14px 0;
  font-size: 13px; color: var(--text-muted);
  padding: 12px 14px;
  background: var(--bg-muted);
  border-radius: 8px;
}

/* Split payment */
.split-wrap {
  padding: 10px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.split-row {
  display: flex;
  gap: 8px;
}
.split-method-sel {
  height: 48px;
  background: var(--bg-input);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  color: var(--text-dark);
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  padding: 0 10px;
  outline: none;
  flex-shrink: 0;
  min-width: 100px;
}
.split-input {
  flex: 1;
  height: 48px;
  background: var(--bg-input);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 0 12px;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px; font-weight: 700;
  color: var(--text-dark);
  outline: none;
}
.split-input:focus { border-color: var(--primary); }
.split-input::-webkit-outer-spin-button,
.split-input::-webkit-inner-spin-button { -webkit-appearance: none; }

.split-status {
  font-size: 13px; font-weight: 700;
  padding: 4px 0;
}
.split-ok    { color: var(--success); }
.split-short { color: var(--error);   }

.split-link {
  display: block;
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 700;
  color: var(--primary);
  background: transparent; border: none;
  padding: 10px 14px 0;
  cursor: pointer;
  text-align: right;
  transition: opacity .15s;
}
.split-link:hover { opacity: .7; }

/* Confirm payment button */
.confirm-btn {
  width: 100%;
  height: 52px;
  background: var(--success);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px; font-weight: 700;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, opacity .15s;
}
.confirm-btn:not(:disabled):hover { background: #047857; }
.confirm-btn:disabled { opacity: .45; cursor: not-allowed; }
.btn-spinner {
  width: 20px; height: 20px;
  border: 2.5px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ═══════════════════════════════════════════════
   STATE 4 — RECEIPT OVERLAY
═══════════════════════════════════════════════ */
.receipt-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
}

.receipt-cd-bar {
  width: 100%;
  height: 3px;
  background: var(--bg-muted);
  flex-shrink: 0;
}
.receipt-cd-fill {
  height: 100%;
  background: var(--primary);
  transition: width .1s linear;
}

.receipt-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 24px;
  text-align: center;
  max-width: 340px;
  margin: 0 auto;
}

.receipt-check {
  width: 80px; height: 80px;
}
.check-svg {
  width: 100%; height: 100%;
  color: var(--success);
}
.check-circle {
  stroke-dasharray: 166;
  stroke-dashoffset: 166;
  animation: draw-circle .5s ease forwards;
}
.check-mark {
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
  animation: draw-check .35s ease .4s forwards;
}
@keyframes draw-circle { to { stroke-dashoffset: 0; } }
@keyframes draw-check  { to { stroke-dashoffset: 0; } }

.receipt-title { font-size: 22px; font-weight: 700; color: var(--text-dark); }
.receipt-meta  { font-size: 17px; font-weight: 700; color: var(--text-dark); }
.receipt-items { font-size: 13px; font-weight: 500; color: var(--text-muted); }
.receipt-change { font-size: 13px; color: var(--text-muted); }

.receipt-actions {
  display: flex;
  gap: 10px;
  width: 100%;
}
.receipt-btn {
  flex: 1;
  height: 48px;
  border-radius: 10px;
  font-family: 'Tajawal', sans-serif;
  font-size: 14px; font-weight: 700;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  border: 1.5px solid var(--border);
  background: var(--bg-card);
  color: var(--text-dark);
  transition: background .15s;
}
.receipt-btn:hover { background: var(--bg-muted); }
.wa-btn { border-color: #22C55E; color: #15803D; }
.wa-btn:hover { background: #F0FDF4; }

.receipt-skip {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px; font-weight: 600;
  color: var(--text-muted);
  background: transparent; border: none;
  cursor: pointer; padding: 8px;
  transition: color .15s;
}
.receipt-skip:hover { color: var(--text-dark); }

/* ═══════════════════════════════════════════════
   BOTTOM SHEETS
═══════════════════════════════════════════════ */
.sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}
.pos-shell.dark .sheet-overlay { background: rgba(0,0,0,.65); }

.bottom-sheet {
  background: var(--bg);
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-height: 80svh;
  overflow-y: auto;
  box-shadow: var(--shadow-sheet);
  padding-bottom: 16px;
}
.sheet-handle {
  width: 36px; height: 4px;
  background: var(--border);
  border-radius: 100px;
  margin: 12px auto 0;
}
.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.sheet-title { font-size: 16px; font-weight: 700; color: var(--text-dark); }
.sheet-close {
  width: 30px; height: 30px;
  background: var(--bg-muted); border: none; border-radius: 50%;
  color: var(--text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.sheet-close:hover { background: var(--border); }

/* Discount sheet */
.disc-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}
.disc-tab {
  flex: 1;
  padding: 12px;
  font-family: 'Tajawal', sans-serif;
  font-size: 14px; font-weight: 600;
  color: var(--text-muted);
  background: transparent; border: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all .15s;
}
.disc-tab.active { color: var(--primary); border-bottom-color: var(--primary); }

.disc-input-wrap {
  display: flex;
  align-items: center;
  padding: 20px 20px 8px;
  gap: 10px;
}
.disc-big-input {
  flex: 1;
  height: 64px;
  font-size: 36px; font-weight: 700;
  background: var(--bg-input);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 0 16px;
  color: var(--text-dark);
  outline: none;
  text-align: center;
  font-family: 'Tajawal', sans-serif;
}
.disc-big-input:focus { border-color: var(--primary); }
.disc-big-input.input-error { border-color: var(--error); }
.disc-big-input::-webkit-outer-spin-button,
.disc-big-input::-webkit-inner-spin-button { -webkit-appearance: none; }

.disc-suffix { font-size: 24px; font-weight: 700; color: var(--text-muted); flex-shrink: 0; }

.disc-preview {
  font-size: 13px; color: var(--text-muted);
  padding: 0 20px 8px;
}
.disc-error {
  font-size: 13px; color: var(--error);
  padding: 0 20px 8px;
}

.disc-apply-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(100% - 40px);
  margin: 8px 20px 0;
  height: 52px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px; font-weight: 700;
  cursor: pointer;
  transition: background .15s, opacity .15s;
}
.disc-apply-btn:not(:disabled):hover { background: var(--primary-hover); }
.disc-apply-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Note input */
.note-input {
  width: 100%;
  height: 48px;
  background: var(--bg-input);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 0 14px;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  color: var(--text-dark);
  outline: none;
  box-sizing: border-box;
}
.note-input:focus { border-color: var(--primary); }
.note-input::placeholder { color: var(--text-faint); }

/* Menu sheet */
.menu-list {
  display: flex;
  flex-direction: column;
  padding: 8px 0 8px;
}
.menu-item {
  background: transparent; border: none;
  padding: 15px 20px;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px; font-weight: 600;
  color: var(--text-dark);
  cursor: pointer;
  text-align: right;
  transition: background .1s;
  border-bottom: 1px solid var(--border);
}
.menu-item:last-child { border-bottom: none; }
.menu-item:hover { background: var(--bg-muted); }
.menu-item-danger { color: var(--error); }

/* ═══════════════════════════════════════════════
   TRANSITIONS
═══════════════════════════════════════════════ */
.zc-slide-enter-active,
.zc-slide-leave-active { transition: opacity .18s ease, transform .18s ease; }
.zc-slide-enter-from   { opacity: 0; transform: translateX(-12px); }
.zc-slide-leave-to     { opacity: 0; transform: translateX(12px); }

.sheet-enter-active,
.sheet-leave-active { transition: opacity .22s ease; }
.sheet-enter-active .bottom-sheet,
.sheet-leave-active .bottom-sheet { transition: transform .22s cubic-bezier(.4,0,.2,1); }
.sheet-enter-from   { opacity: 0; }
.sheet-enter-from .bottom-sheet { transform: translateY(100%); }
.sheet-leave-to     { opacity: 0; }
.sheet-leave-to .bottom-sheet { transform: translateY(100%); }

.receipt-fade-enter-active,
.receipt-fade-leave-active { transition: opacity .2s ease; }
.receipt-fade-enter-from,
.receipt-fade-leave-to     { opacity: 0; }
</style>
