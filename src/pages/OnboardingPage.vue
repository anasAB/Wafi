<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { store } from '../store'

const router = useRouter()

const sidebarOpen = ref(false)

const userName     = computed(() => store.userName    || 'أحمد')
const businessName = computed(() => store.businessName || 'عملك التجاري')

const setupCards = ref([
  {
    id: 'products',
    icon: '📦',
    title: 'أضف منتجاتك الأولى',
    desc: 'أضف ٥ منتجات وستكون جاهزاً للبيع في دقيقتين. الأسرع طريقاً للمبيعة الأولى.',
    cta: 'ابدأ بإضافة منتج',
    time: '~٣ دقائق',
    primary: true,
    done: false,
  },
  {
    id: 'pos',
    icon: '🏪',
    title: 'افتح نقطة البيع',
    desc: 'اكتشف شاشة البيع وجرّب تسجيل معاملة تجريبية قبل البدء الفعلي.',
    cta: 'افتح نقطة البيع',
    time: '~٢ دقائق',
    primary: false,
    done: false,
  },
  {
    id: 'team',
    icon: '👥',
    title: 'أضف موظفيك',
    desc: 'دعوة موظفيك وتحديد صلاحيات كل شخص — من يبيع، من يدير المخزون.',
    cta: 'أضف موظفاً',
    time: '~١ دقيقة',
    primary: false,
    done: false,
  },
  {
    id: 'profile',
    icon: '🏢',
    title: 'أكمل بيانات نشاطك',
    desc: 'أضف شعارك وعنوانك ورقمك الضريبي — تظهر على كل فاتورة تُصدرها.',
    cta: 'أكمل البيانات',
    time: '~٢ دقائق',
    primary: false,
    done: false,
  },
])

const doneCount  = computed(() => setupCards.value.filter(c => c.done).length)
const progress   = computed(() => Math.round((doneCount.value / setupCards.value.length) * 100))
const allDone    = computed(() => doneCount.value === setupCards.value.length)

function markDone(id: string) {
  const c = setupCards.value.find(c => c.id === id)
  if (c) c.done = !c.done
}

const navItems = [
  { icon: '🏠', label: 'لوحة التحكم', active: true,  to: '/dashboard' },
  { icon: '🏪', label: 'نقطة البيع',  active: false, to: null },
  { icon: '📦', label: 'المخزون',     active: false, to: null },
  { icon: '📊', label: 'المحاسبة',    active: false, to: null },
  { icon: '📈', label: 'التقارير',    active: false, to: null },
  { icon: '👥', label: 'العملاء',     active: false, to: null },
]

function goTo(item: typeof navItems[0]) {
  sidebarOpen.value = false
  if (item.to) router.push(item.to)
}
</script>

<template>
  <div class="ob" dir="rtl">

    <!-- ── Mobile top bar ─────────────────────────────────── -->
    <header class="ob-topbar">
      <RouterLink to="/" class="ob-logo">
        <span class="ob-logo-mark">و</span>
        <span class="ob-logo-name">وافي</span>
      </RouterLink>
      <div class="ob-topbar-actions">
        <button class="icon-btn" aria-label="الإشعارات">🔔</button>
        <div class="user-chip">
          <div class="user-av">{{ userName.charAt(0) }}</div>
          <span class="user-nm">{{ userName }}</span>
        </div>
      </div>
      <button class="hamburger-ob" @click="sidebarOpen = !sidebarOpen" aria-label="القائمة">
        <span></span><span></span><span></span>
      </button>
    </header>

    <!-- ── Layout ─────────────────────────────────────────── -->
    <div class="ob-layout">

      <!-- ── Sidebar (RIGHT side in RTL) ─────────────────── -->
      <aside class="ob-sidebar" :class="{ open: sidebarOpen }">
        <div class="sidebar-logo">
          <RouterLink to="/" class="ob-logo" @click="sidebarOpen = false">
            <span class="ob-logo-mark">و</span>
            <span class="ob-logo-name">وافي</span>
          </RouterLink>
        </div>

        <nav class="sidebar-nav">
          <a
            v-for="item in navItems" :key="item.label"
            href="#"
            class="sidebar-item"
            :class="{ active: item.active }"
            @click.prevent="goTo(item)"
          >
            <span class="sidebar-icon">{{ item.icon }}</span>
            <span class="sidebar-label">{{ item.label }}</span>
            <span v-if="item.active" class="sidebar-dot"></span>
          </a>
        </nav>

        <div class="sidebar-bottom">
          <a href="#" class="sidebar-item">
            <span class="sidebar-icon">⚙️</span>
            <span class="sidebar-label">الإعدادات</span>
          </a>
          <div class="sidebar-user">
            <div class="sidebar-av">{{ userName.charAt(0) }}</div>
            <div class="sidebar-info">
              <div class="sidebar-name">{{ userName }}</div>
              <div class="sidebar-biz">{{ businessName }}</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- Sidebar overlay on mobile -->
      <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>

      <!-- ── Main content ─────────────────────────────────── -->
      <main class="ob-main">

        <!-- Welcome banner -->
        <div class="welcome-banner">
          <div class="welcome-text">
            <h1 class="welcome-h">مرحباً، {{ userName }}! 🎉</h1>
            <p class="welcome-sub">حسابك جاهز. اتّبع الخطوات أدناه للبدء بعملك.</p>
          </div>
          <div class="progress-section">
            <div class="progress-meta">
              <span class="prog-count">{{ doneCount }} / {{ setupCards.length }} خطوات مكتملة</span>
              <span class="prog-pct">{{ progress }}٪</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: progress + '%' }"></div>
            </div>
          </div>
        </div>

        <!-- Setup cards -->
        <div class="setup-label">ابدأ من هنا</div>
        <div class="cards-grid">
          <div
            v-for="card in setupCards" :key="card.id"
            class="setup-card"
            :class="{ primary: card.primary, done: card.done }"
          >
            <div class="card-top">
              <div class="card-icon-wrap" :class="{ done: card.done }">
                <span v-if="!card.done" class="card-icon">{{ card.icon }}</span>
                <span v-else class="card-icon">✓</span>
              </div>
              <div class="card-badges">
                <span v-if="card.primary && !card.done" class="card-badge-primary">ابدأ هنا</span>
                <span v-if="card.done" class="card-badge-done">مكتمل</span>
              </div>
            </div>

            <h3 class="card-title">{{ card.title }}</h3>
            <p class="card-desc">{{ card.desc }}</p>

            <div class="card-footer">
              <div class="card-time">⏱ {{ card.time }}</div>
              <div class="card-actions">
                <button
                  v-if="!card.done"
                  class="card-cta"
                  :class="{ 'card-cta-primary': card.primary }"
                  @click="markDone(card.id)"
                >
                  {{ card.cta }} →
                </button>
                <button
                  v-else
                  class="card-undo"
                  @click="markDone(card.id)"
                >
                  تراجع
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- All done CTA -->
        <Transition name="done-fade">
          <div v-if="allDone" class="all-done-banner">
            <div class="done-emoji">🎉</div>
            <div class="done-text">
              <div class="done-title">أنت جاهز تماماً!</div>
              <div class="done-sub">متجرك مُعدّ ويمكنك الآن إدارة أعمالك من لوحة التحكم.</div>
            </div>
            <button class="done-cta" @click="router.push('/dashboard')">
              انتقل للوحة التحكم ←
            </button>
          </div>
        </Transition>

        <!-- Help strip -->
        <div class="help-strip">
          <div class="help-text">
            <span class="help-icon">💬</span>
            <div>
              <div class="help-title">تحتاج مساعدة؟</div>
              <div class="help-sub">فريق الدعم يتحدث العربية ومتاح الآن</div>
            </div>
          </div>
          <div class="help-actions">
            <button class="help-btn">ابدأ محادثة</button>
            <button class="help-btn-ghost">مركز المساعدة</button>
          </div>
        </div>

        <!-- Locked preview teaser -->
        <div class="preview-teaser">
          <div class="preview-overlay">
            <span class="preview-icon">📊</span>
            <p class="preview-msg">أكمل الإعداد لرؤية لوحة البيانات الكاملة</p>
            <div class="preview-fake-bars">
              <div class="fake-bar" style="height:45%"></div>
              <div class="fake-bar" style="height:68%"></div>
              <div class="fake-bar" style="height:55%"></div>
              <div class="fake-bar" style="height:82%"></div>
              <div class="fake-bar" style="height:70%"></div>
              <div class="fake-bar" style="height:90%"></div>
            </div>
          </div>
        </div>

      </main>

    </div>

    <!-- ── Mobile bottom nav ────────────────────────────────── -->
    <nav class="ob-bottom-nav">
      <a v-for="item in navItems.slice(0,5)" :key="item.label" href="#"
         class="bn-item" :class="{ active: item.active }" @click.prevent="goTo(item)">
        <span class="bn-icon">{{ item.icon }}</span>
        <span class="bn-label">{{ item.label }}</span>
      </a>
    </nav>

  </div>
</template>

<style>
.ob {
  display: flex;
  flex-direction: column;
  min-height: 100svh;
  background: #05080F;
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
  color: #E8EDF5;
}

/* ── Top bar (mobile) ───────────────────────────────────── */
.ob-topbar {
  display: flex;
  align-items: center;
  height: 58px;
  padding: 0 16px;
  background: #080C18;
  border-bottom: 1px solid rgba(255,255,255,.07);
  position: sticky;
  top: 0;
  z-index: 50;
  gap: 12px;
}
@media (min-width: 900px) { .ob-topbar { display: none; } }

.ob-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; }
.ob-logo-mark {
  width: 32px; height: 32px;
  background: #00CC88; color: #03070D;
  font-size: 18px; font-weight: 900;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.ob-logo-name { font-size: 18px; font-weight: 800; color: #E8EDF5; }

.ob-topbar-actions { display: flex; align-items: center; gap: 8px; margin-right: auto; }
.icon-btn {
  width: 36px; height: 36px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #637285;
}
.user-chip { display: none; }
@media (min-width: 480px) {
  .user-chip { display: flex; align-items: center; gap: 8px; }
  .user-nm   { font-size: 14px; font-weight: 600; color: #9AABC7; }
}
.user-av {
  width: 30px; height: 30px;
  background: rgba(0,204,136,.2);
  color: #00CC88;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800;
}

.hamburger-ob {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 28px; height: 18px;
  background: transparent; border: none; cursor: pointer;
}
.hamburger-ob span { display: block; width: 100%; height: 2px; background: #637285; border-radius: 2px; }

/* ── Layout ─────────────────────────────────────────────── */
.ob-layout {
  display: flex;
  flex: 1;
  /* RTL: first child (sidebar) → RIGHT side physically */
}

/* ── Sidebar ─────────────────────────────────────────────── */
.ob-sidebar {
  width: 240px;
  flex-shrink: 0;
  background: #080C18;
  border-left: 1px solid rgba(255,255,255,.07);
  display: none;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100svh;
  overflow-y: auto;
}
@media (min-width: 900px) {
  .ob-sidebar { display: flex; }
}
/* Mobile slide-in */
@media (max-width: 899px) {
  .ob-sidebar {
    display: flex;
    position: fixed;
    top: 0; right: 0; bottom: 0;
    z-index: 200;
    transform: translateX(100%);
    transition: transform .3s ease;
    box-shadow: -20px 0 60px rgba(0,0,0,.5);
  }
  .ob-sidebar.open { transform: translateX(0); }
}

.sidebar-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 190;
}

.sidebar-logo {
  padding: 24px 20px 16px;
  border-bottom: 1px solid rgba(255,255,255,.06);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 10px;
  flex: 1;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-radius: 10px;
  color: #637285;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all .2s;
  position: relative;
  min-height: 44px;
}
.sidebar-item:hover { background: rgba(255,255,255,.05); color: #E8EDF5; }
.sidebar-item.active { background: rgba(0,204,136,.1); color: #00CC88; font-weight: 700; }
.sidebar-icon { font-size: 18px; flex-shrink: 0; }
.sidebar-label { flex: 1; }
.sidebar-dot {
  width: 6px; height: 6px;
  background: #00CC88; border-radius: 50%;
  position: absolute;
  left: 14px;
}

.sidebar-bottom {
  padding: 10px 10px 16px;
  border-top: 1px solid rgba(255,255,255,.06);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: background .2s;
}
.sidebar-user:hover { background: rgba(255,255,255,.05); }
.sidebar-av {
  width: 34px; height: 34px;
  background: rgba(0,204,136,.2);
  color: #00CC88;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800;
  flex-shrink: 0;
}
.sidebar-info { min-width: 0; }
.sidebar-name { font-size: 13px; font-weight: 700; color: #E8EDF5; }
.sidebar-biz  { font-size: 11px; color: #364A66; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Main content ───────────────────────────────────────── */
.ob-main {
  flex: 1;
  min-width: 0;
  padding: 24px 16px 100px; /* bottom for mobile nav */
}
@media (min-width: 600px)  { .ob-main { padding: 28px 24px 100px; } }
@media (min-width: 900px)  { .ob-main { padding: 36px 40px 48px; } }

/* ── Welcome banner ─────────────────────────────────────── */
.welcome-banner {
  background: linear-gradient(135deg, rgba(0,204,136,.07) 0%, rgba(75,158,255,.04) 100%);
  border: 1px solid rgba(0,204,136,.14);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 32px;
}
@media (min-width: 600px) { .welcome-banner { padding: 28px 32px; } }

.welcome-h   { font-size: 22px; font-weight: 900; color: #E8EDF5; margin-bottom: 6px; }
@media (min-width: 600px) { .welcome-h { font-size: 26px; } }
.welcome-sub { font-size: 14px; color: #637285; margin-bottom: 22px; }

.progress-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}
.prog-count { color: #8A9BBF; font-weight: 600; }
.prog-pct   { color: #00CC88; font-weight: 800; }

.progress-track {
  height: 6px;
  background: rgba(255,255,255,.07);
  border-radius: 6px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #00CC88, #4B9EFF);
  border-radius: 6px;
  transition: width .5s cubic-bezier(.22,1,.36,1);
  min-width: 6px;
}

/* ── Setup cards ─────────────────────────────────────────── */
.setup-label {
  font-size: 12px;
  font-weight: 700;
  color: #3D4F6B;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 14px;
}

.cards-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-bottom: 32px;
}
@media (min-width: 640px)  { .cards-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1200px) { .cards-grid { grid-template-columns: repeat(4, 1fr); gap: 16px; } }

.setup-card {
  background: #0D1828;
  border: 1.5px solid rgba(255,255,255,.07);
  border-radius: 16px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color .25s, box-shadow .25s, background .25s;
}
.setup-card:hover:not(.done) { border-color: rgba(255,255,255,.16); box-shadow: 0 12px 32px rgba(0,0,0,.3); }
.setup-card.primary {
  border-color: rgba(0,204,136,.28);
  background: linear-gradient(145deg, rgba(0,204,136,.06), #0D1828);
  position: relative;
}
.setup-card.done {
  opacity: .65;
  border-color: rgba(0,204,136,.2);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.card-icon-wrap {
  width: 48px; height: 48px;
  background: rgba(255,255,255,.05);
  border-radius: 13px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  transition: background .3s;
}
.setup-card.primary .card-icon-wrap { background: rgba(0,204,136,.12); }
.card-icon-wrap.done { background: rgba(0,204,136,.15); font-size: 18px; color: #00CC88; }
.card-icon { font-size: 22px; }

.card-badges { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.card-badge-primary {
  font-size: 10px;
  font-weight: 700;
  background: rgba(0,204,136,.15);
  color: #00CC88;
  border: 1px solid rgba(0,204,136,.25);
  padding: 3px 9px;
  border-radius: 100px;
}
.card-badge-done {
  font-size: 10px;
  font-weight: 700;
  background: rgba(75,158,255,.12);
  color: #4B9EFF;
  border: 1px solid rgba(75,158,255,.22);
  padding: 3px 9px;
  border-radius: 100px;
}

.card-title { font-size: 15px; font-weight: 700; color: #E8EDF5; }
.card-desc  { font-size: 13px; line-height: 1.65; color: #637285; flex: 1; }

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.06);
  gap: 8px;
  flex-wrap: wrap;
}
.card-time { font-size: 11px; color: #3D4F6B; flex-shrink: 0; }

.card-cta {
  font-family: 'Tajawal', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: #8A9BBF;
  background: transparent;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  min-height: 34px;
  transition: all .2s;
  white-space: nowrap;
}
.card-cta:hover { border-color: rgba(255,255,255,.22); color: #E8EDF5; }
.card-cta.card-cta-primary {
  background: #00CC88;
  color: #03070D;
  border-color: transparent;
}
.card-cta.card-cta-primary:hover {
  background: #00DFA0;
  box-shadow: 0 6px 18px rgba(0,204,136,.35);
}

.card-undo {
  font-family: 'Tajawal', sans-serif;
  font-size: 12px;
  color: #3D4F6B;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 10px;
  min-height: 34px;
  transition: color .2s;
}
.card-undo:hover { color: #637285; }

/* ── Help strip ──────────────────────────────────────────── */
.help-strip {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.help-text { display: flex; align-items: center; gap: 14px; }
.help-icon { font-size: 24px; flex-shrink: 0; }
.help-title { font-size: 14px; font-weight: 700; color: #E8EDF5; }
.help-sub   { font-size: 12px; color: #637285; margin-top: 2px; }
.help-actions { display: flex; gap: 8px; }
.help-btn {
  font-family: 'Tajawal', sans-serif;
  font-size: 14px;
  font-weight: 700;
  background: #00CC88;
  color: #03070D;
  border: none;
  border-radius: 9px;
  padding: 8px 18px;
  min-height: 40px;
  cursor: pointer;
  transition: background .2s;
}
.help-btn:hover { background: #00DFA0; }
.help-btn-ghost {
  font-family: 'Tajawal', sans-serif;
  font-size: 14px;
  font-weight: 600;
  background: transparent;
  color: #637285;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 9px;
  padding: 8px 18px;
  min-height: 40px;
  cursor: pointer;
  transition: all .2s;
}
.help-btn-ghost:hover { color: #E8EDF5; border-color: rgba(255,255,255,.22); }

/* ── Preview teaser ─────────────────────────────────────── */
.preview-teaser {
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 14px;
  overflow: hidden;
  height: 140px;
  position: relative;
  background: #080C18;
}
.preview-overlay {
  position: absolute; inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: linear-gradient(180deg, rgba(5,8,15,.3) 0%, rgba(5,8,15,.85) 60%);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.preview-icon { font-size: 28px; }
.preview-msg  { font-size: 13px; color: #637285; }
.preview-fake-bars {
  position: absolute; bottom: 0; left: 0; right: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 0 16px;
  height: 80px;
  z-index: -1;
}
.fake-bar { flex: 1; background: rgba(75,158,255,.15); border-radius: 4px 4px 0 0; }

/* ── Mobile bottom nav ──────────────────────────────────── */
.ob-bottom-nav {
  display: flex;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: rgba(8,12,24,.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-top: 1px solid rgba(255,255,255,.08);
  z-index: 100;
  height: 60px;
}
@media (min-width: 900px) { .ob-bottom-nav { display: none; } }

.bn-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: #364A66;
  text-decoration: none;
  transition: color .2s;
}
.bn-item.active { color: #00CC88; }
.bn-icon  { font-size: 20px; }
.bn-label { font-size: 9px; font-weight: 600; }

/* All-done banner */
.all-done-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: linear-gradient(145deg, #071F0F 0%, #0B3018 60%, #07200F 100%);
  border: 1px solid rgba(0,204,136,.35);
  border-radius: 20px;
  padding: 28px 24px;
  margin-bottom: 20px;
  text-align: center;
}
.done-emoji { font-size: 40px; line-height: 1; }
.done-title { font-size: 20px; font-weight: 800; color: #E8F5EC; margin-bottom: 4px; }
.done-sub   { font-size: 13px; color: rgba(0,204,136,.7); line-height: 1.5; }
.done-cta {
  margin-top: 8px;
  background: #00CC88;
  color: #021008;
  border: none;
  border-radius: 12px;
  padding: 14px 28px;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s, transform .15s;
}
.done-cta:hover { background: #00E599; transform: translateY(-1px); }

.done-fade-enter-active { transition: opacity .4s ease, transform .4s ease; }
.done-fade-leave-active { transition: opacity .2s ease; }
.done-fade-enter-from   { opacity: 0; transform: translateY(12px); }
.done-fade-leave-to     { opacity: 0; }
</style>
