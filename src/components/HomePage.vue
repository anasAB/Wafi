<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const scrolled = ref(false)
const menuOpen = ref(false)

const onScroll = () => { scrolled.value = window.scrollY > 30 }
onMounted(() => window.addEventListener('scroll', onScroll))
onUnmounted(() => window.removeEventListener('scroll', onScroll))

const toggleMenu = () => { menuOpen.value = !menuOpen.value }
const closeMenu  = () => { menuOpen.value = false }

const stats = [
  { value: '+٢٠,٠٠٠', label: 'شركة تثق بوافي' },
  { value: '١٧٠م+',   label: 'معاملة شهرياً' },
  { value: '١٥+',     label: 'دولة عربية' },
  { value: '٤.٨ / ٥', label: 'تقييم المستخدمين' },
]

const features = [
  { icon: '🏪', title: 'نقطة البيع',         desc: 'واجهة سريعة وبديهية تعمل على أي جهاز. أتمم عملية بيع كاملة في ثوانٍ دون أي تعقيد.',                                color: '#00CC88' },
  { icon: '📦', title: 'إدارة المخزون',       desc: 'تتبع مخزونك في الوقت الحقيقي مع تنبيهات تلقائية وطلبات شراء ذكية بضغطة واحدة.',                                      color: '#4B9EFF' },
  { icon: '📊', title: 'المحاسبة والفواتير',  desc: 'فواتير إلكترونية وقيود محاسبية تلقائية وتقارير مالية لحظية متوافقة مع متطلبات المنطقة.',                             color: '#F0B429' },
  { icon: '📈', title: 'التحليلات والتقارير', desc: 'لوحة تحكم ذكية تمنحك رؤية شاملة من المبيعات والأرباح حتى أداء كل موظف.',                                            color: '#FF6B6B' },
  { icon: '👥', title: 'إدارة العملاء',       desc: 'برامج ولاء وعروض مخصصة تحوّل الزوار العرضيين إلى روّاد دائمين لعملك.',                                              color: '#A78BFA' },
  { icon: '🔗', title: 'التكاملات',           desc: 'اتصال سلس بمنصات التجارة الإلكترونية وبوابات الدفع وأنظمة HR الأكثر انتشاراً في المنطقة.',                          color: '#FB923C' },
]

const sectors = [
  { icon: '🍽️', name: 'المطاعم والكافيهات' },
  { icon: '🛍️', name: 'محلات التجزئة' },
  { icon: '💊',  name: 'الصيدليات' },
  { icon: '🔧', name: 'خدمات وصيانة' },
  { icon: '🛒', name: 'البقالة والسوبرماركت' },
  { icon: '👗', name: 'ملابس وأزياء' },
  { icon: '📱', name: 'إلكترونيات' },
  { icon: '🏥', name: 'عيادات وصحة' },
]

const testimonials = [
  { quote: 'وافي غيّر طريقة إدارتي للمطعم كلياً. الآن أتابع المبيعات والمخزون من هاتفي في أي وقت.',        name: 'أحمد الزهراني', role: 'صاحب سلسلة مطاعم · جدة',     avatar: 'أ', color: '#00CC88' },
  { quote: 'النظام المحاسبي دقيق جداً ووفّر علينا ساعات كانت تُهدر في الإدخال اليدوي. الدعم ممتاز.',      name: 'سارة المنصور',  role: 'محاسبة قانونية · الكويت',     avatar: 'س', color: '#4B9EFF' },
  { quote: 'أفضل استثمار لمحل الملابس. التقارير التفصيلية كشفت أي المنتجات الأكثر ربحاً وساعدتني للتوسع.', name: 'محمد بن خالد',  role: 'تاجر تجزئة · عمّان',          avatar: 'م', color: '#F0B429' },
]

const chartBars = [
  { label: 'سبت',    pct: 42 },
  { label: 'أكت',    pct: 58 },
  { label: 'نوف',    pct: 50 },
  { label: 'ديس',    pct: 73 },
  { label: 'يناير',  pct: 63 },
  { label: 'فبراير', pct: 87, active: true },
]
</script>

<template>
  <div class="wafi" dir="rtl">

    <!-- ===== NAV ===== -->
    <nav class="nav" :class="{ scrolled }">
      <div class="nav-inner">
        <a class="logo" href="#" @click="closeMenu">
          <span class="logo-mark">و</span>
          <span class="logo-name">وافي</span>
        </a>

        <!-- Desktop links (hidden on mobile) -->
        <div class="nav-links">
          <a href="#features">المميزات</a>
          <a href="#sectors">القطاعات</a>
          <a href="#pricing">الأسعار</a>
          <a href="#contact">تواصل معنا</a>
        </div>

        <!-- Desktop CTAs (hidden on mobile) -->
        <div class="nav-ctas">
          <button class="btn-ghost" @click="router.push('/login')">تسجيل الدخول</button>
          <button class="btn-primary" @click="router.push('/signup')">ابدأ مجاناً</button>
        </div>

        <!-- Hamburger (visible on mobile only) -->
        <button class="hamburger" :class="{ open: menuOpen }" @click="toggleMenu" aria-label="القائمة">
          <span></span><span></span><span></span>
        </button>
      </div>

      <!-- Mobile drawer -->
      <div class="mobile-menu" :class="{ open: menuOpen }">
        <a href="#features" @click="closeMenu">المميزات</a>
        <a href="#sectors"  @click="closeMenu">القطاعات</a>
        <a href="#pricing"  @click="closeMenu">الأسعار</a>
        <a href="#contact"  @click="closeMenu">تواصل معنا</a>
        <div class="mobile-menu-ctas">
          <button class="btn-ghost" @click="closeMenu(); router.push('/login')">تسجيل الدخول</button>
          <button class="btn-primary" @click="closeMenu(); router.push('/signup')">ابدأ مجاناً</button>
        </div>
      </div>
    </nav>

    <!-- ===== HERO ===== -->
    <section class="hero">
      <div class="hero-glow g1"></div>
      <div class="hero-glow g2"></div>
      <div class="hero-grid"></div>

      <div class="hero-inner">
        <div class="hero-text">
          <div class="hero-badge">
            <span class="badge-pulse"></span>
            نظام إدارة أعمال متكامل للمنطقة العربية
          </div>
          <h1 class="hero-h1">
            كل ما يحتاجه<br>
            <span class="grad">عملك التجاري</span><br>
            في منصة واحدة
          </h1>
          <p class="hero-p">
            وافي يجمع نقطة البيع، المخزون، المحاسبة، والتحليلات في نظام واحد
            سهل الاستخدام. صُمِّم خصيصاً لأصحاب الأعمال في العالم العربي.
          </p>
          <div class="hero-btns">
            <button class="btn-primary btn-lg">
              جرّب مجاناً لـ ١٤ يوم <span class="btn-arr">←</span>
            </button>
            <button class="btn-outline btn-lg">
              <span class="play-btn">▶</span>
              شاهد كيف يعمل
            </button>
          </div>
          <p class="hero-hint">لا يتطلب بطاقة ائتمان · إعداد فوري في أقل من دقيقة</p>
        </div>

        <!-- Dashboard mockup — hidden on small phones, shown on tablet+ -->
        <div class="hero-viz">
          <div class="dash-card">
            <div class="dash-head">
              <span class="dash-title-text">📊 لوحة التحكم</span>
              <span class="dash-date">اليوم، ١٦ مايو</span>
            </div>
            <div class="dash-metrics">
              <div class="metric">
                <div class="metric-label">إجمالي المبيعات</div>
                <div class="metric-val">٤٨,٢٣١ <small>ر.س</small></div>
                <div class="metric-change up">↑ ١٢.٥٪</div>
              </div>
              <div class="metric-divider"></div>
              <div class="metric">
                <div class="metric-label">الطلبات اليوم</div>
                <div class="metric-val">٣٢٧</div>
                <div class="metric-change up">↑ ٨.٣٪</div>
              </div>
            </div>
            <div class="dash-chart">
              <div
                v-for="(b, i) in chartBars" :key="b.label"
                class="chart-col" :class="{ active: b.active }"
              >
                <div class="chart-bar" :style="{ '--pct': b.pct + '%', animationDelay: (i * 0.09) + 's' }"></div>
                <span class="chart-label">{{ b.label }}</span>
              </div>
            </div>
            <div class="dash-legend">
              <div class="legend-item">
                <span class="leg-dot" style="background:#00CC88"></span>
                <span class="leg-name">مبيعات المطعم</span>
                <span class="leg-val">٢٨,٤٠٠</span>
              </div>
              <div class="legend-item">
                <span class="leg-dot" style="background:#4B9EFF"></span>
                <span class="leg-name">الطلبات الإلكترونية</span>
                <span class="leg-val">١٢,٨٠٠</span>
              </div>
              <div class="legend-item">
                <span class="leg-dot" style="background:#F0B429"></span>
                <span class="leg-name">التوصيل</span>
                <span class="leg-val">٧,٠٣١</span>
              </div>
            </div>
          </div>
          <!-- Floating cards — visible on desktop only -->
          <div class="float-card fc-top">
            <div class="fc-dot" style="background:#00CC88"></div>
            <div class="fc-body">
              <div class="fc-title">فاتورة جديدة</div>
              <div class="fc-sub">تمت المعالجة بنجاح ✓</div>
            </div>
          </div>
          <div class="float-card fc-bot">
            <div class="fc-dot" style="background:#F0B429"></div>
            <div class="fc-body">
              <div class="fc-title">تنبيه مخزون</div>
              <div class="fc-sub">طماطم — باقي ٥ كجم</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== STATS BAR ===== -->
    <div class="stats-row">
      <div class="stats-inner">
        <div v-for="s in stats" :key="s.label" class="stat">
          <div class="stat-val">{{ s.value }}</div>
          <div class="stat-lbl">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <!-- ===== FEATURES ===== -->
    <section id="features" class="section">
      <div class="container">
        <div class="section-tag">المميزات</div>
        <h2 class="section-h">كل أدوات عملك <span class="grad">في مكان واحد</span></h2>
        <p class="section-p">لا مزيد من التنقل بين أنظمة متعددة. وافي يوفر لك كل ما تحتاجه في منصة واحدة متكاملة.</p>
        <div class="feat-grid">
          <div v-for="f in features" :key="f.title" class="feat-card">
            <div class="feat-icon" :style="{ background: f.color + '1A', color: f.color }">{{ f.icon }}</div>
            <h3 class="feat-name">{{ f.title }}</h3>
            <p class="feat-desc">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== POS HIGHLIGHT ===== -->
    <section class="section pos-section">
      <div class="container">
        <div class="two-col">
          <div class="col-text">
            <div class="section-tag">نقطة البيع</div>
            <h2 class="section-h">بيع أسرع،<br><span class="grad">أرباح أعلى</span></h2>
            <p class="section-p">واجهة بيع مصممة للسرعة. أتمم عملية بيع كاملة في ثوانٍ على أي جهاز — تابلت أو هاتف أو حاسوب.</p>
            <ul class="check-list">
              <li><span class="ck">✓</span> يعمل دون اتصال بالإنترنت ويزامن تلقائياً</li>
              <li><span class="ck">✓</span> يدعم الباركود والبحث الفوري</li>
              <li><span class="ck">✓</span> خصومات وعروض ترويجية مرنة</li>
              <li><span class="ck">✓</span> فواتير حرارية وإلكترونية</li>
              <li><span class="ck">✓</span> بوابات دفع متعددة</li>
            </ul>
            <button class="btn-primary">اكتشف نقطة البيع <span>←</span></button>
          </div>
          <div class="col-viz">
            <div class="pos-card">
              <div class="pos-top">
                <span class="pos-label">🏪 نقطة البيع</span>
                <span class="pos-time">١٠:٢٥ ص</span>
              </div>
              <div class="pos-search">🔍 ابحث عن منتج...</div>
              <div class="pos-list">
                <div class="pos-row">
                  <span class="pos-dot" style="background:#00CC88"></span>
                  <span class="pos-name">برجر كلاسيك</span>
                  <span class="pos-qty">×١</span>
                  <span class="pos-price">٢٥ ر.س</span>
                </div>
                <div class="pos-row">
                  <span class="pos-dot" style="background:#4B9EFF"></span>
                  <span class="pos-name">مشروب بارد</span>
                  <span class="pos-qty">×٢</span>
                  <span class="pos-price">٢٤ ر.س</span>
                </div>
                <div class="pos-row">
                  <span class="pos-dot" style="background:#F0B429"></span>
                  <span class="pos-name">بطاطس مقلية</span>
                  <span class="pos-qty">×١</span>
                  <span class="pos-price">١٠ ر.س</span>
                </div>
              </div>
              <div class="pos-total-row">
                <span>الإجمالي</span>
                <span class="pos-total-val">٥٩ ر.س</span>
              </div>
              <button class="pos-pay">إتمام الدفع</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== SECTORS ===== -->
    <section id="sectors" class="section">
      <div class="container">
        <div class="section-tag">القطاعات</div>
        <h2 class="section-h">لكل قطاع <span class="grad">حل مخصص</span></h2>
        <p class="section-p">وافي يناسب طيفاً واسعاً من الأعمال في المنطقة العربية — من المطعم الصغير إلى سلسلة المحلات.</p>
        <div class="sectors-grid">
          <div v-for="s in sectors" :key="s.name" class="sector-card">
            <span class="sector-ico">{{ s.icon }}</span>
            <span class="sector-name">{{ s.name }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== TESTIMONIALS ===== -->
    <section class="section">
      <div class="container">
        <div class="section-tag">آراء العملاء</div>
        <h2 class="section-h">ماذا يقول <span class="grad">أصحاب الأعمال</span></h2>
        <div class="testimonials-grid">
          <div v-for="t in testimonials" :key="t.name" class="t-card">
            <div class="t-stars">★★★★★</div>
            <p class="t-quote">"{{ t.quote }}"</p>
            <div class="t-author">
              <div class="t-avatar" :style="{ background: t.color + '20', color: t.color }">{{ t.avatar }}</div>
              <div>
                <div class="t-name">{{ t.name }}</div>
                <div class="t-role">{{ t.role }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ===== CTA ===== -->
    <section class="cta-section">
      <div class="cta-glow"></div>
      <div class="container cta-inner">
        <div class="cta-eyebrow">ابدأ اليوم</div>
        <h2 class="cta-h">١٤ يوماً مجاناً.<br>بدون أي التزام.</h2>
        <p class="cta-p">جرّب جميع مميزات وافي مجاناً ولا حاجة لبطاقة ائتمان.</p>
        <div class="cta-btns">
          <button class="btn-primary btn-xl">ابدأ التجربة المجانية</button>
          <button class="btn-ghost btn-xl">تحدث مع فريق المبيعات</button>
        </div>
      </div>
    </section>

    <!-- ===== FOOTER ===== -->
    <footer class="footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <a class="logo" href="#">
            <span class="logo-mark">و</span>
            <span class="logo-name">وافي</span>
          </a>
          <p class="footer-tagline">نظام إدارة أعمال متكامل<br>للمنطقة العربية</p>
          <div class="social-row">
            <a href="#" class="social-link">𝕏</a>
            <a href="#" class="social-link">in</a>
            <a href="#" class="social-link">f</a>
            <a href="#" class="social-link">▶</a>
          </div>
        </div>
        <div class="footer-cols">
          <div class="footer-col">
            <h4>المنتج</h4>
            <a href="#">نقطة البيع</a>
            <a href="#">إدارة المخزون</a>
            <a href="#">المحاسبة</a>
            <a href="#">التحليلات</a>
          </div>
          <div class="footer-col">
            <h4>الشركة</h4>
            <a href="#">عن وافي</a>
            <a href="#">المدونة</a>
            <a href="#">الوظائف</a>
            <a href="#">شركاؤنا</a>
          </div>
          <div class="footer-col">
            <h4>الدعم</h4>
            <a href="#">مركز المساعدة</a>
            <a href="#">تواصل معنا</a>
            <a href="#">حالة النظام</a>
            <a href="#">المجتمع</a>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ٢٠٢٦ وافي. جميع الحقوق محفوظة.</span>
        <div class="footer-legal">
          <a href="#">سياسة الخصوصية</a>
          <a href="#">شروط الاستخدام</a>
        </div>
      </div>
    </footer>

  </div>
</template>

<style>
/* ─────────────────────────────────────────────────────────
   MOBILE-FIRST: base styles target phones (~360px+).
   We only add min-width queries to enhance larger screens.
───────────────────────────────────────────────────────── */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { font-family: 'Tajawal', sans-serif; cursor: pointer; }
a      { text-decoration: none; }

.wafi {
  font-family: 'Tajawal', sans-serif;
  background: #05080F;
  color: #E8EDF5;
  overflow-x: hidden;
  direction: rtl;
  text-align: right;
}

/* ── Gradient text ──────────────────────────────────────── */
.grad {
  background: linear-gradient(120deg, #00CC88 30%, #4B9EFF 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── Container: 16px mobile → 24px tablet → 48px desktop ── */
.container {
  width: 100%;
  padding: 0 16px;
}
@media (min-width: 600px)  { .container { padding: 0 24px; } }
@media (min-width: 1024px) { .container { max-width: 1248px; margin: 0 auto; padding: 0 48px; } }

/* ── Buttons ────────────────────────────────────────────── */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #00CC88;
  color: #03070D;
  font-size: 15px;
  font-weight: 800;
  /* 44px min height for touch */
  min-height: 44px;
  padding: 0 20px;
  border-radius: 10px;
  border: none;
  transition: background .2s, transform .2s, box-shadow .2s;
  white-space: nowrap;
}
.btn-primary:hover  { background: #00DFA0; transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,204,136,.35); }
.btn-primary:active { transform: translateY(0); }
.btn-primary.btn-lg { font-size: 16px; min-height: 50px; padding: 0 26px; border-radius: 12px; }
.btn-primary.btn-xl { font-size: 17px; min-height: 54px; padding: 0 34px; border-radius: 12px; }
.btn-arr { font-size: 17px; }

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: #9AABC7;
  font-size: 15px;
  font-weight: 500;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 10px;
  border: none;
  transition: background .2s, color .2s;
}
.btn-ghost:hover     { background: rgba(255,255,255,.06); color: #E8EDF5; }
.btn-ghost.btn-xl    { font-size: 17px; min-height: 54px; padding: 0 26px; border-radius: 12px; }

.btn-outline {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  color: #E8EDF5;
  font-size: 15px;
  font-weight: 600;
  min-height: 50px;
  padding: 0 22px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.14);
  transition: border-color .2s, background .2s;
}
.btn-outline:hover { border-color: rgba(255,255,255,.28); background: rgba(255,255,255,.05); }
.play-btn {
  width: 26px; height: 26px;
  background: rgba(255,255,255,.1);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  flex-shrink: 0;
}

/* ── Section shared ─────────────────────────────────────── */
.section { padding: 64px 0; }
@media (min-width: 768px)  { .section { padding: 80px 0; } }
@media (min-width: 1024px) { .section { padding: 100px 0; } }

.section-tag {
  display: inline-block;
  background: rgba(0,204,136,.1);
  border: 1px solid rgba(0,204,136,.22);
  color: #00CC88;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 5px 13px;
  border-radius: 100px;
  margin-bottom: 16px;
}
.section-h {
  font-size: 28px;
  font-weight: 900;
  line-height: 1.2;
  color: #E8EDF5;
  margin-bottom: 14px;
}
@media (min-width: 600px)  { .section-h { font-size: 36px; } }
@media (min-width: 1024px) { .section-h { font-size: 46px; } }

.section-p {
  font-size: 15px;
  line-height: 1.85;
  color: #6B7C9E;
  margin-bottom: 40px;
}
@media (min-width: 600px)  { .section-p { font-size: 16px; margin-bottom: 48px; } }
@media (min-width: 1024px) { .section-p { max-width: 560px; } }

/* ── NAV ────────────────────────────────────────────────── */
.nav {
  position: fixed;
  top: 0; right: 0; left: 0;
  z-index: 100;
  border-bottom: 1px solid transparent;
  transition: background .3s, border-color .3s, backdrop-filter .3s;
}
.nav.scrolled {
  background: rgba(5,8,15,.85);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-bottom-color: rgba(255,255,255,.07);
}

.nav-inner {
  display: flex;
  align-items: center;
  height: 60px;
  padding: 0 16px;
  gap: 12px;
}
@media (min-width: 600px)  { .nav-inner { padding: 0 24px; height: 66px; } }
@media (min-width: 1024px) { .nav-inner { max-width: 1248px; margin: 0 auto; padding: 0 48px; height: 70px; gap: 40px; } }

.logo {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.logo-mark {
  width: 34px; height: 34px;
  background: #00CC88;
  color: #03070D;
  font-size: 19px;
  font-weight: 900;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
@media (min-width: 1024px) { .logo-mark { width: 38px; height: 38px; font-size: 22px; border-radius: 11px; } }
.logo-name { font-size: 20px; font-weight: 800; color: #E8EDF5; }
@media (min-width: 1024px) { .logo-name { font-size: 22px; } }

/* Desktop-only nav links */
.nav-links { display: none; }
@media (min-width: 900px) {
  .nav-links {
    display: flex;
    gap: 2px;
    flex: 1;
    justify-content: center;
  }
  .nav-links a {
    color: #8A9BBF;
    font-size: 15px;
    font-weight: 500;
    padding: 8px 14px;
    border-radius: 8px;
    min-height: 44px;
    display: flex;
    align-items: center;
    transition: color .2s, background .2s;
  }
  .nav-links a:hover { color: #E8EDF5; background: rgba(255,255,255,.05); }
}

/* Desktop-only CTAs */
.nav-ctas { display: none; }
@media (min-width: 900px) {
  .nav-ctas { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
}

/* Hamburger — mobile only */
.hamburger {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 32px;
  height: 20px;
  background: transparent;
  border: none;
  padding: 0;
  margin-right: auto; /* pushes to left in RTL */
  cursor: pointer;
}
@media (min-width: 900px) { .hamburger { display: none; } }
.hamburger span {
  display: block;
  width: 100%;
  height: 2px;
  background: #E8EDF5;
  border-radius: 2px;
  transition: transform .25s, opacity .25s;
  transform-origin: center;
}
.hamburger.open span:nth-child(1) { transform: translateY(9px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
.hamburger.open span:nth-child(3) { transform: translateY(-9px) rotate(-45deg); }

/* Mobile menu drawer */
.mobile-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px 16px;
  background: rgba(5,8,15,.97);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(255,255,255,.07);
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-height .3s ease, opacity .3s ease, padding .3s;
  padding-top: 0;
  padding-bottom: 0;
}
.mobile-menu.open {
  max-height: 320px;
  opacity: 1;
  padding: 8px 16px 20px;
}
@media (min-width: 900px) { .mobile-menu { display: none; } }
.mobile-menu a {
  color: #9AABC7;
  font-size: 16px;
  font-weight: 500;
  padding: 12px 8px;
  border-radius: 8px;
  transition: color .2s, background .2s;
}
.mobile-menu a:hover { color: #E8EDF5; background: rgba(255,255,255,.05); }
.mobile-menu-ctas {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.07);
  margin-top: 4px;
}
.mobile-menu-ctas .btn-primary,
.mobile-menu-ctas .btn-ghost { flex: 1; justify-content: center; }

/* ── HERO ───────────────────────────────────────────────── */
.hero {
  position: relative;
  min-height: 100svh;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding-top: 60px; /* nav height */
}
@media (min-width: 600px)  { .hero { padding-top: 66px; } }
@media (min-width: 1024px) { .hero { padding-top: 70px; } }

.hero-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 20%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 20%, transparent 75%);
  pointer-events: none;
}
.hero-glow { position: absolute; border-radius: 50%; filter: blur(70px); pointer-events: none; }
.g1 {
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(0,204,136,.14) 0%, transparent 68%);
  top: -100px; right: -100px;
  animation: pulse 8s ease-in-out infinite;
}
.g2 {
  width: 350px; height: 350px;
  background: radial-gradient(circle, rgba(75,158,255,.10) 0%, transparent 68%);
  bottom: -60px; left: 5%;
  animation: pulse 10s ease-in-out infinite 3s;
}
@media (min-width: 1024px) {
  .g1 { width: 700px; height: 700px; top: -200px; right: -180px; }
  .g2 { width: 500px; height: 500px; bottom: -80px; }
}
@keyframes pulse {
  0%, 100% { opacity: .7; transform: scale(1); }
  50%       { opacity: 1; transform: scale(1.08); }
}

/* Hero layout: column on mobile → row on desktop */
.hero-inner {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 48px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}
@media (min-width: 600px)  { .hero-inner { padding: 56px 24px 48px; } }
@media (min-width: 1024px) {
  .hero-inner {
    flex-direction: row;
    align-items: center;
    max-width: 1248px;
    margin: 0 auto;
    padding: 80px 48px;
    gap: 64px;
  }
}

.hero-text {
  flex: 1;
  animation: slide-up .65s ease both;
}
@keyframes slide-up {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  background: rgba(0,204,136,.09);
  border: 1px solid rgba(0,204,136,.22);
  color: #00CC88;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 100px;
  margin-bottom: 22px;
  animation: slide-up .65s .08s ease both;
}
@media (min-width: 600px) { .hero-badge { font-size: 13px; margin-bottom: 28px; } }

.badge-pulse {
  width: 7px; height: 7px;
  background: #00CC88;
  border-radius: 50%;
  flex-shrink: 0;
  animation: blink 2.2s ease infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: .25; }
}

.hero-h1 {
  font-size: 36px;
  font-weight: 900;
  line-height: 1.16;
  letter-spacing: -.5px;
  color: #E8EDF5;
  margin-bottom: 18px;
  animation: slide-up .65s .13s ease both;
}
@media (min-width: 480px)  { .hero-h1 { font-size: 44px; } }
@media (min-width: 600px)  { .hero-h1 { font-size: 52px; letter-spacing: -1px; margin-bottom: 22px; } }
@media (min-width: 1024px) { .hero-h1 { font-size: 64px; } }
@media (min-width: 1280px) { .hero-h1 { font-size: 70px; } }

.hero-p {
  font-size: 15px;
  line-height: 1.85;
  color: #637285;
  margin-bottom: 28px;
  animation: slide-up .65s .18s ease both;
}
@media (min-width: 600px)  { .hero-p { font-size: 16px; margin-bottom: 32px; } }
@media (min-width: 1024px) { .hero-p { font-size: 17px; max-width: 500px; margin-bottom: 36px; } }

.hero-btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 18px;
  animation: slide-up .65s .23s ease both;
}
@media (min-width: 420px) { .hero-btns { flex-direction: row; flex-wrap: wrap; } }
.hero-btns .btn-primary,
.hero-btns .btn-outline { width: 100%; justify-content: center; }
@media (min-width: 420px) {
  .hero-btns .btn-primary,
  .hero-btns .btn-outline { width: auto; justify-content: flex-start; }
}

.hero-hint {
  font-size: 12px;
  color: #3A4D66;
  animation: slide-up .65s .28s ease both;
}
@media (min-width: 600px) { .hero-hint { font-size: 13px; } }

/* Hero viz: hidden on very small, shown from 480px */
.hero-viz {
  display: none;
}
@media (min-width: 480px) {
  .hero-viz {
    display: block;
    width: 100%;
    position: relative;
    animation: slide-up .65s .2s ease both;
  }
}
@media (min-width: 1024px) {
  .hero-viz { flex: 1; max-width: 460px; }
}

/* Floating cards — desktop only (would overflow on tablet) */
.float-card { display: none; }
@media (min-width: 1024px) {
  .float-card {
    display: flex;
    position: absolute;
    align-items: center;
    gap: 11px;
    background: #0D1828;
    border: 1px solid rgba(255,255,255,.11);
    border-radius: 14px;
    padding: 12px 16px;
    box-shadow: 0 20px 40px rgba(0,0,0,.45);
    z-index: 2;
    white-space: nowrap;
  }
  .fc-top { top: -18px; left: -24px; animation: float-y 4s ease-in-out infinite; }
  .fc-bot { bottom: -14px; right: -18px; animation: float-y 5s ease-in-out infinite 1.8s; }
}
.fc-dot   { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.fc-title { font-size: 12px; font-weight: 700; color: #E8EDF5; margin-bottom: 2px; }
.fc-sub   { font-size: 11px; color: #637285; }
@keyframes float-y {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-8px); }
}

/* Dashboard card */
.dash-card {
  background: linear-gradient(145deg, #0D1828, #0A1220);
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 32px 64px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
  position: relative;
  z-index: 1;
}
@media (min-width: 1024px) { .dash-card { border-radius: 20px; padding: 24px; } }

.dash-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.dash-title-text { font-size: 13px; font-weight: 700; color: #E8EDF5; }
.dash-date        { font-size: 11px; color: #364A66; }

.dash-metrics {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: rgba(255,255,255,.03);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.05);
  margin-bottom: 18px;
}
.metric            { flex: 1; }
.metric-divider    { width: 1px; height: 40px; background: rgba(255,255,255,.07); flex-shrink: 0; }
.metric-label      { font-size: 11px; color: #3A4D66; margin-bottom: 4px; }
.metric-val        { font-size: 18px; font-weight: 900; color: #E8EDF5; line-height: 1.2; }
.metric-val small  { font-size: 11px; font-weight: 500; color: #637285; }
.metric-change     { font-size: 11px; font-weight: 600; margin-top: 3px; }
.metric-change.up  { color: #00CC88; }

.dash-chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 76px;
  margin-bottom: 16px;
}
@media (min-width: 1024px) { .dash-chart { height: 86px; gap: 7px; } }
.chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  height: 100%;
  justify-content: flex-end;
}
.chart-bar {
  width: 100%;
  height: var(--pct, 50%);
  background: rgba(75,158,255,.22);
  border-radius: 4px 4px 0 0;
  transform: scaleY(0);
  transform-origin: bottom center;
  animation: bar-grow .55s cubic-bezier(.22,1,.36,1) forwards;
}
.chart-col.active .chart-bar {
  background: linear-gradient(180deg, #00CC88, #00A870);
  box-shadow: 0 0 10px rgba(0,204,136,.4);
}
.chart-label { font-size: 9px; color: #364A66; white-space: nowrap; }
@keyframes bar-grow { to { transform: scaleY(1); } }

.dash-legend       { display: flex; flex-direction: column; gap: 7px; }
.legend-item       { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.leg-dot           { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.leg-name          { flex: 1; color: #637285; }
.leg-val           { font-weight: 800; color: #C8D5E8; font-size: 13px; }

/* ── STATS BAR ──────────────────────────────────────────── */
.stats-row {
  border-top: 1px solid rgba(255,255,255,.07);
  border-bottom: 1px solid rgba(255,255,255,.07);
  background: rgba(255,255,255,.018);
}
.stats-inner {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
@media (min-width: 768px) {
  .stats-inner { grid-template-columns: repeat(4, 1fr); max-width: 1248px; margin: 0 auto; padding: 0 48px; }
}
.stat {
  padding: 24px 16px;
  text-align: center;
  border-left: 1px solid rgba(255,255,255,.07);
}
.stat:nth-child(odd) { border-left: none; }
.stat:nth-child(3),
.stat:nth-child(4)   { border-top: 1px solid rgba(255,255,255,.07); }
@media (min-width: 768px) {
  .stat                  { padding: 28px 20px; border-left: 1px solid rgba(255,255,255,.07); }
  .stat:nth-child(odd)   { border-left: 1px solid rgba(255,255,255,.07); }
  .stat:first-child      { border-left: none; }
  .stat:nth-child(3),
  .stat:nth-child(4)     { border-top: none; }
}
.stat-val { font-size: 24px; font-weight: 900; color: #00CC88; letter-spacing: -.5px; }
.stat-lbl { font-size: 12px; color: #5E7390; margin-top: 5px; }
@media (min-width: 768px) { .stat-val { font-size: 28px; } .stat-lbl { font-size: 13px; } }

/* ── FEATURES GRID ──────────────────────────────────────── */
.feat-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 540px)  { .feat-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; } }
@media (min-width: 1024px) { .feat-grid { grid-template-columns: repeat(3, 1fr); gap: 18px; } }

.feat-card {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 14px;
  padding: 22px;
  transition: transform .25s, border-color .25s, box-shadow .25s, background .25s;
}
@media (min-width: 1024px) {
  .feat-card { border-radius: 16px; padding: 28px; }
  .feat-card:hover { background: #101E32; border-color: rgba(255,255,255,.13); transform: translateY(-5px); box-shadow: 0 24px 48px rgba(0,0,0,.35); }
}
.feat-icon {
  width: 48px; height: 48px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 16px;
}
@media (min-width: 1024px) { .feat-icon { width: 52px; height: 52px; font-size: 24px; border-radius: 14px; margin-bottom: 20px; } }
.feat-name { font-size: 16px; font-weight: 700; color: #E8EDF5; margin-bottom: 8px; }
.feat-desc { font-size: 14px; line-height: 1.7; color: #637285; }

/* ── POS HIGHLIGHT ──────────────────────────────────────── */
.pos-section { background: linear-gradient(180deg, rgba(0,204,136,.02) 0%, transparent 60%); }

/* Stack by default, side-by-side on desktop */
.two-col { display: flex; flex-direction: column; gap: 36px; }
@media (min-width: 900px) { .two-col { flex-direction: row; align-items: center; gap: 72px; } }

.col-text { flex: 1; }
.col-viz  { flex: 1; display: flex; justify-content: center; }

.check-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
}
.check-list li {
  display: flex;
  align-items: center;
  font-size: 14px;
  color: #8A9BBF;
}
@media (min-width: 600px) { .check-list li { font-size: 15px; } }
.ck {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px; height: 22px;
  background: rgba(0,204,136,.13);
  color: #00CC88;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
  margin-left: 12px;
  flex-shrink: 0;
}

.pos-card {
  background: linear-gradient(145deg, #0D1828, #0A1220);
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 18px;
  padding: 20px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 32px 64px rgba(0,0,0,.4);
}
@media (min-width: 1024px) { .pos-card { border-radius: 20px; padding: 24px; } }

.pos-top       { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.pos-label     { font-size: 14px; font-weight: 700; color: #E8EDF5; }
.pos-time      { font-size: 12px; color: #364A66; }
.pos-search    {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: #364A66;
  margin-bottom: 12px;
}
.pos-list      { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
.pos-row       { display: flex; align-items: center; gap: 10px; padding: 11px 10px; border-radius: 10px; }
.pos-dot       { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.pos-name      { flex: 1; font-size: 13px; color: #C8D5E8; font-weight: 500; }
.pos-qty       { font-size: 12px; color: #364A66; }
.pos-price     { font-size: 13px; font-weight: 700; color: #E8EDF5; }
.pos-total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 10px;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.05);
  border-radius: 10px;
  margin-bottom: 12px;
  font-size: 14px;
  color: #8A9BBF;
}
.pos-total-val { font-size: 20px; font-weight: 900; color: #E8EDF5; }
.pos-pay {
  width: 100%;
  background: #00CC88;
  color: #03070D;
  font-size: 15px;
  font-weight: 800;
  padding: 14px;
  border-radius: 12px;
  border: none;
  min-height: 48px;
  transition: background .2s, box-shadow .2s;
}
.pos-pay:hover { background: #00DFA0; box-shadow: 0 10px 28px rgba(0,204,136,.4); }

/* ── SECTORS ────────────────────────────────────────────── */
.sectors-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (min-width: 600px)  { .sectors-grid { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 1024px) { .sectors-grid { grid-template-columns: repeat(4, 1fr); gap: 14px; } }

.sector-card {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 13px;
  padding: 18px 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 13px;
  font-weight: 600;
  color: #8A9BBF;
  min-height: 56px;
  transition: background .2s, border-color .2s, color .2s, transform .2s;
}
@media (min-width: 600px)  { .sector-card { font-size: 14px; padding: 20px 16px; border-radius: 14px; } }
@media (min-width: 1024px) { .sector-card { padding: 22px 18px; } .sector-card:hover { background: #101E32; border-color: rgba(0,204,136,.22); color: #E8EDF5; transform: translateY(-3px); } }
.sector-ico { font-size: 22px; flex-shrink: 0; }

/* ── TESTIMONIALS ───────────────────────────────────────── */
.testimonials-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 900px)  { .testimonials-grid { grid-template-columns: repeat(3, 1fr); gap: 18px; } }

.t-card {
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
@media (min-width: 1024px) {
  .t-card { border-radius: 16px; padding: 28px; transition: transform .25s, border-color .25s, box-shadow .25s; }
  .t-card:hover { border-color: rgba(255,255,255,.13); transform: translateY(-5px); box-shadow: 0 24px 48px rgba(0,0,0,.35); }
}
.t-stars  { color: #F0B429; font-size: 13px; letter-spacing: 3px; }
.t-quote  { font-size: 14px; line-height: 1.8; color: #8A9BBF; flex: 1; }
@media (min-width: 600px) { .t-quote { font-size: 15px; } }
.t-author { display: flex; align-items: center; gap: 11px; }
.t-avatar {
  width: 42px; height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 900;
  flex-shrink: 0;
}
.t-name { font-size: 14px; font-weight: 700; color: #E8EDF5; }
.t-role { font-size: 12px; color: #364A66; }

/* ── CTA ────────────────────────────────────────────────── */
.cta-section {
  position: relative;
  overflow: hidden;
  padding: 80px 0;
  text-align: center;
  border-top: 1px solid rgba(255,255,255,.06);
}
@media (min-width: 768px)  { .cta-section { padding: 100px 0; } }
@media (min-width: 1024px) { .cta-section { padding: 120px 0; } }
.cta-glow {
  position: absolute;
  width: 700px; height: 400px;
  background: radial-gradient(ellipse, rgba(0,204,136,.11) 0%, transparent 65%);
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.cta-inner { position: relative; z-index: 1; }
.cta-eyebrow {
  display: inline-block;
  background: rgba(0,204,136,.1);
  border: 1px solid rgba(0,204,136,.22);
  color: #00CC88;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 5px 13px;
  border-radius: 100px;
  margin-bottom: 20px;
}
.cta-h {
  font-size: 30px;
  font-weight: 900;
  color: #E8EDF5;
  line-height: 1.2;
  margin-bottom: 14px;
}
@media (min-width: 480px)  { .cta-h { font-size: 38px; } }
@media (min-width: 768px)  { .cta-h { font-size: 48px; } }
@media (min-width: 1024px) { .cta-h { font-size: 56px; } }
.cta-p { font-size: 15px; color: #637285; margin-bottom: 36px; }
@media (min-width: 600px) { .cta-p { font-size: 17px; margin-bottom: 44px; } }
.cta-btns { display: flex; flex-direction: column; gap: 10px; align-items: center; }
@media (min-width: 480px) { .cta-btns { flex-direction: row; justify-content: center; flex-wrap: wrap; } }

/* ── FOOTER ─────────────────────────────────────────────── */
.footer { border-top: 1px solid rgba(255,255,255,.07); padding-top: 48px; }
@media (min-width: 768px) { .footer { padding-top: 64px; } }

.footer-inner {
  display: flex;
  flex-direction: column;
  gap: 36px;
  padding: 0 16px 44px;
}
@media (min-width: 600px)  { .footer-inner { padding: 0 24px 48px; } }
@media (min-width: 768px)  { .footer-inner { flex-direction: row; gap: 60px; } }
@media (min-width: 1024px) { .footer-inner { max-width: 1248px; margin: 0 auto; padding: 0 48px 60px; gap: 80px; } }

.footer-brand { flex: 1.2; }
.footer-tagline { font-size: 14px; line-height: 1.75; color: #364A66; margin-top: 14px; margin-bottom: 20px; }
.social-row  { display: flex; gap: 8px; }
.social-link {
  width: 38px; height: 38px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5E7390;
  font-size: 13px;
  transition: background .2s, color .2s, border-color .2s;
}
.social-link:hover { background: rgba(255,255,255,.1); color: #E8EDF5; border-color: rgba(255,255,255,.15); }

.footer-cols { display: flex; gap: 32px; flex-wrap: wrap; }
@media (min-width: 480px)  { .footer-cols { gap: 40px; flex-wrap: nowrap; } }
@media (min-width: 1024px) { .footer-cols { gap: 56px; } }

.footer-col { display: flex; flex-direction: column; gap: 10px; min-width: 100px; }
.footer-col h4 { font-size: 13px; font-weight: 700; color: #E8EDF5; margin-bottom: 4px; }
.footer-col a  { font-size: 14px; color: #364A66; transition: color .2s; min-height: 32px; display: flex; align-items: center; }
.footer-col a:hover { color: #8A9BBF; }

.footer-bottom {
  border-top: 1px solid rgba(255,255,255,.06);
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: center;
  font-size: 12px;
  color: #364A66;
}
@media (min-width: 600px)  { .footer-bottom { padding: 18px 24px; } }
@media (min-width: 768px)  { .footer-bottom { flex-direction: row; justify-content: space-between; align-items: center; text-align: right; } }
@media (min-width: 1024px) { .footer-bottom { max-width: 1248px; margin: 0 auto; padding: 18px 48px; font-size: 13px; } }
.footer-legal { display: flex; gap: 16px; justify-content: center; }
@media (min-width: 768px) { .footer-legal { justify-content: flex-start; } }
.footer-legal a { color: #364A66; transition: color .2s; }
.footer-legal a:hover { color: #637285; }
</style>
