<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { featureFlags } from '@/config/featureFlags'

const stats = [
  { value: '10s',    label: 'وقت البيع' },
  { value: '2',      label: 'عملتان' },
  { value: '∞',      label: 'بدون إنترنت' },
  { value: '30 دق',  label: 'للتهيئة' },
]

const features = [
  { icon: '⚡', title: 'دائماً يعمل',         body: 'يعمل بدون إنترنت ويتزامن عند العودة تلقائياً.' },
  { icon: '🌐', title: 'عربي + دولار + ليرة', body: 'سعر الصرف بيدك. تبديل فوري بين العملتين.' },
  { icon: '📱', title: 'أي جهاز تملكه',       body: 'موبايل، تابلت، لابتوب. ثبّته من الرابط بدون App Store.' },
  { icon: '👥', title: 'وردية الصندوق',       body: 'فتح وإغلاق وردية، تقرير Z، عزو كل بيع للكاشير.' },
  { icon: '📒', title: 'دفتر الزبائن',        body: 'رصيد جارٍ، تسجيل دفعة، كشف حساب بضغطة واتساب.' },
  { icon: '📸', title: 'تتبع المصاريف',       body: 'صوّر الفاتورة، أدخل المبلغ، نظّم بالفئات.' },
]

const story = [
  {
    tag: 'نقطة البيع',
    title: 'بيع في أقل من ١٠ ثوانٍ.',
    body:  'مسح باركود، نقر على المنتج، أو بحث بالاسم. كل ثانية تحسب خلف الكاونتر.',
    label: 'POS Screen',
    reverse: false,
  },
  {
    tag: 'لوحة التحكم',
    title: 'اعرف أرقامك قبل ما تفتح الباب.',
    body:  'إيرادات اليوم، ربح الشهر، تنبيهات المخزون — كلها في شاشة واحدة عند الفتح.',
    label: 'Dashboard',
    reverse: true,
  },
  {
    tag: 'الزبائن والآجل',
    title: 'زبائنك يثقون بك. الأرقام تثبت ذلك.',
    body:  'كل بيع مسجّل. كل آجل متتبع. أرسل كشف حساب عبر واتساب بضغطة واحدة.',
    label: 'Customers',
    reverse: false,
  },
]

const steps = [
  { num: '١', title: 'ثبّت التطبيق',  body: 'افتح الرابط على أي جهاز. اضغط "إضافة للشاشة الرئيسية". خلصت.' },
  { num: '٢', title: 'هيّئ متجرك',    body: 'أضف منتجاتك، حدد سعر الصرف، وهيّئ الإيصال. ٣٠ دقيقة.' },
  { num: '٣', title: 'ابدأ البيع',    body: 'اضغط "بيع جديد". يعمل على الإنترنت — وبدونه.' },
]

// Packs that are fully built and safe to advertise today.
const availablePacks = [
  { name: 'باقة الموظفين', price: '+$5', period: '/شهر', features: ['ورديات الصندوق', 'حتى ٥ مستخدمين', 'تقرير Z', 'صلاحيات مخصصة'], amber: false },
  { name: 'باقة الزبائن',  price: '+$5', period: '/شهر', features: ['دفتر الآجل', 'تسجيل دفعة', 'كشف حساب واتساب'], amber: false },
  { name: 'باقة التقارير', price: '+$5', period: '/شهر', features: ['تقارير متقدمة', 'ملخص واتساب اليومي', 'تصدير Excel'], amber: false },
]

// Electronics Pro is not built yet — gate it so we never advertise IMEI/repair/
// warranty with no code behind it. The `electronicsPro` flag flips on in the
// same change that ships the feature. (See @/config/featureFlags.)
const electronicsProPack = {
  name: 'إلكترونيات برو', price: '+$8', period: '/شهر', features: ['تتبع IMEI', 'تذاكر الإصلاح', 'ربحية الإصلاح'], amber: true,
}

const packs = featureFlags.electronicsPro
  ? [...availablePacks, electronicsProPack]
  : availablePacks

const trust = [
  { icon: '🖨️', text: 'Epson · Star · طابعات صينية 80mm' },
  { icon: '📡', text: 'يعمل بدون إنترنت — مضمون' },
  { icon: '🔤', text: 'عربي بالكامل + RTL أصيل' },
  { icon: '🔗', text: 'PWA — بدون App Store' },
]
</script>

<template>
  <div class="lp-root" dir="rtl">

    <!-- ── 1. Hero ──────────────────────────────────────── -->
    <section class="lp-hero">
      <div class="lp-glow-ring lp-glow-hero" aria-hidden="true"></div>

      <div class="lp-hero-inner">
        <!-- Text -->
        <div class="lp-hero-text">
          <h1 class="lp-hero-h1">
            متجرك.<br>
            <span class="lp-hero-accent">تحت سيطرتك الكاملة.</span>
          </h1>
          <p class="lp-hero-sub">
            نظام إدارة متجر للتجار السوريين — يعمل بدون إنترنت،
            عربي بالكامل، على أي جهاز تملكه.
          </p>
          <div class="lp-hero-btns">
            <RouterLink to="/home" class="lp-btn-primary">ابدأ الآن / Start Now</RouterLink>
            <button type="button" class="lp-btn-ghost">شاهد العرض / Watch Demo</button>
          </div>
        </div>

        <!-- Floating metric cards -->
        <div class="lp-hero-cards">
          <div class="lp-float-card lp-card-blue lp-rotate-neg1">
            <div class="lfc-live">
              <span class="lfc-dot"></span>
              <span class="lfc-live-label">مباشر</span>
            </div>
            <div class="lfc-label">المبيعات اليوم</div>
            <div class="lfc-value">$4,820</div>
            <div class="lfc-sub lfc-green">↑ 12% عن أمس</div>
          </div>
          <div class="lp-float-card lp-card-green lp-rotate-pos">
            <div class="lfc-label">الربح الإجمالي</div>
            <div class="lfc-value lfc-green-val">$1,240</div>
            <div class="lfc-sub">هامش 26% — صحي ✓</div>
          </div>
          <div class="lp-float-card lp-card-amber lp-rotate-neg05">
            <div class="lfc-label">تنبيه مخزون</div>
            <div class="lfc-value lfc-amber-val">٣ أصناف منخفضة</div>
          </div>
        </div>
      </div>

      <!-- Scroll chevron -->
      <div class="lp-scroll-chevron" aria-hidden="true">
        <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
    </section>

    <!-- ── 2. Stats bar ──────────────────────────────────── -->
    <section class="lp-section lp-stats">
      <div class="lp-container lp-stats-grid">
        <div v-for="stat in stats" :key="stat.label" class="lp-stat-chip">
          <div class="lp-stat-val">{{ stat.value }}</div>
          <div class="lp-stat-label">{{ stat.label }}</div>
        </div>
      </div>
    </section>

    <!-- ── 3. Features grid ─────────────────────────────── -->
    <section class="lp-section">
      <div class="lp-container">
        <div class="lp-section-tag">المميزات</div>
        <h2 class="lp-section-h2">كل ما يحتاجه متجرك.</h2>
        <div class="lp-features-grid">
          <div v-for="f in features" :key="f.title" class="lp-feat-card">
            <div class="lp-feat-icon">{{ f.icon }}</div>
            <h3 class="lp-feat-title">{{ f.title }}</h3>
            <p class="lp-feat-body">{{ f.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 4. Product story ─────────────────────────────── -->
    <section class="lp-section">
      <div class="lp-container lp-story-wrap">
        <div
          v-for="item in story"
          :key="item.tag"
          class="lp-story-row"
          :class="item.reverse ? 'lp-story-reverse' : ''"
        >
          <div class="lp-story-img">
            <span class="lp-story-img-label">{{ item.label }}</span>
          </div>
          <div class="lp-story-text">
            <span class="lp-story-tag">{{ item.tag }}</span>
            <h2 class="lp-story-h2">{{ item.title }}</h2>
            <p class="lp-story-p">{{ item.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 5. How it works ──────────────────────────────── -->
    <section class="lp-section lp-how-bg">
      <div class="lp-glow-ring lp-glow-center" aria-hidden="true"></div>
      <div class="lp-container">
        <div class="lp-section-tag">كيف يعمل</div>
        <h2 class="lp-section-h2">ثلاث خطوات وأنت جاهز.</h2>
        <div class="lp-steps">
          <div v-for="(step, i) in steps" :key="step.num" class="lp-step-wrap">
            <div class="lp-step">
              <div class="lp-step-num">{{ step.num }}</div>
              <h3 class="lp-step-title">{{ step.title }}</h3>
              <p class="lp-step-body">{{ step.body }}</p>
            </div>
            <div v-if="i < 2" class="lp-step-arrow" aria-hidden="true">←</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 6. Pricing table ─────────────────────────────── -->
    <section class="lp-section">
      <div class="lp-container">
        <div class="lp-section-tag">الأسعار</div>
        <h2 class="lp-section-h2">ادفع فقط لما تحتاجه.</h2>
        <div class="lp-pricing-wrap">

          <!-- Core card -->
          <div class="lp-price-core">
            <div class="lp-founding-badge">مؤسسون: ٥٠٪ خصم دائم</div>
            <div class="lp-price-name">الباقة الأساسية</div>
            <div class="lp-price-amount">$12 <span class="lp-price-period">/شهر</span></div>
            <ul class="lp-price-features">
              <li>✓ نقطة البيع</li>
              <li>✓ إدارة المخزون</li>
              <li>✓ لوحة الربحية</li>
              <li>✓ يعمل بدون إنترنت</li>
              <li>✓ دولار وليرة سورية</li>
              <li>✓ مستخدم واحد</li>
            </ul>
            <RouterLink to="/home" class="lp-btn-primary lp-price-cta">ابدأ الآن</RouterLink>
            <p class="lp-price-note">مطلوبة — تُضاف الباقات فوقها</p>
          </div>

          <!-- Add-on packs -->
          <div class="lp-packs-grid">
            <div
              v-for="pack in packs"
              :key="pack.name"
              class="lp-pack-card"
              :class="pack.amber ? 'lp-pack-amber' : ''"
            >
              <div class="lp-pack-name">{{ pack.name }}</div>
              <div class="lp-pack-price">{{ pack.price }} <span class="lp-pack-period">{{ pack.period }}</span></div>
              <ul class="lp-pack-features">
                <li v-for="feat in pack.features" :key="feat">{{ feat }}</li>
              </ul>
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- ── 7. Trust badges ──────────────────────────────── -->
    <section class="lp-section">
      <div class="lp-container">
        <div class="lp-trust-grid">
          <div v-for="t in trust" :key="t.text" class="lp-trust-badge">
            <span class="lp-trust-icon">{{ t.icon }}</span>
            <span class="lp-trust-text">{{ t.text }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 8. Founding CTA ──────────────────────────────── -->
    <section class="lp-section">
      <div class="lp-container lp-cta-wrap">
        <div class="lp-glow-ring lp-glow-cta" aria-hidden="true"></div>
        <div class="lp-cta-card">
          <h2 class="lp-cta-h2">انضم لدائرة المؤسسين.</h2>
          <p class="lp-cta-sub">
            أول ١٥ متجراً يحصل على خصم ٥٠٪ بشكل دائم.
            تهيئة شخصية. خط مباشر مع المؤسسين.
          </p>
          <RouterLink to="/home" class="lp-btn-primary">احجز مكانك / Reserve Your Spot</RouterLink>
          <p class="lp-cta-spots">١٢ من أصل ١٥ مكاناً متبقية.</p>
        </div>
      </div>
    </section>

    <!-- ── 9. Footer ────────────────────────────────────── -->
    <footer class="lp-footer">
      <div class="lp-container">
        <div class="lp-footer-top">
          <div>
            <div class="lp-footer-brand">وافي</div>
            <div class="lp-footer-tagline">نظام إدارة أعمال متكامل</div>
          </div>
          <div class="lp-footer-links">
            <div class="lp-footer-col">
              <p class="lp-footer-col-head">المنتج</p>
              <RouterLink to="/home" class="lp-footer-link">لوحة التحكم</RouterLink>
              <RouterLink to="/pos"  class="lp-footer-link">نقطة البيع</RouterLink>
            </div>
            <div class="lp-footer-col">
              <p class="lp-footer-col-head">الشركة</p>
              <span class="lp-footer-link">حول</span>
              <span class="lp-footer-link">تواصل معنا</span>
            </div>
          </div>
        </div>
        <div class="lp-footer-bottom">
          <p class="lp-footer-copy">© 2026 وافي. جميع الحقوق محفوظة.</p>
          <div class="lp-footer-payments">
            <span class="lp-pay-badge">USDT</span>
            <span class="lp-pay-badge">Wire</span>
            <span class="lp-pay-badge">Cash</span>
          </div>
        </div>
      </div>
    </footer>

  </div>
</template>

<style scoped>
/* ── Root ───────────────────────────────────────────── */
.lp-root {
  min-height: 100dvh;
  background: #06090F;
  color: #E8EDF5;
  font-family: 'Tajawal', system-ui, sans-serif;
  overflow-x: hidden;
  direction: rtl;
}

/* ── Container ─────────────────────────────────────── */
.lp-container {
  max-width: 1100px;
  margin-inline: auto;
  padding-inline: 24px;
}

/* ── Section spacing ────────────────────────────────── */
.lp-section { padding-block: 80px; position: relative; overflow: hidden; }

/* ── Section heading ────────────────────────────────── */
.lp-section-tag {
  font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: #1A56DB; margin-bottom: 12px;
}
.lp-section-h2 {
  font-size: clamp(24px, 4vw, 38px);
  font-weight: 800; color: #E8EDF5;
  margin-bottom: 40px; line-height: 1.25;
}

/* ── Ambient glow rings ─────────────────────────────── */
.lp-glow-ring {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.lp-glow-hero {
  inset: 0;
  background: radial-gradient(ellipse 65% 55% at 50% 35%, rgba(26,86,219,0.16) 0%, transparent 70%);
}
.lp-glow-center {
  inset: 0;
  background: radial-gradient(ellipse 70% 60% at 50% 50%, rgba(26,86,219,0.12) 0%, transparent 70%);
}
.lp-glow-cta {
  inset: -60px;
  background: radial-gradient(ellipse 80% 70% at 50% 50%, rgba(26,86,219,0.18) 0%, transparent 65%);
}

/* ── Hero ───────────────────────────────────────────── */
.lp-hero {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-inline: 24px;
  padding-block: 80px;
  position: relative;
  overflow: hidden;
}
.lp-hero-inner {
  max-width: 1100px;
  width: 100%;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 48px;
}
@media (min-width: 1024px) {
  .lp-hero-inner { flex-direction: row; align-items: center; }
}
.lp-hero-text { flex: 1; text-align: center; }
@media (min-width: 1024px) { .lp-hero-text { text-align: right; } }

.lp-hero-h1 {
  font-size: clamp(32px, 6vw, 64px);
  font-weight: 800;
  line-height: 1.15;
  margin-bottom: 20px;
}
.lp-hero-accent { color: #3B7FFF; }
.lp-hero-sub {
  font-size: clamp(14px, 2vw, 18px);
  color: #637285;
  max-width: 480px;
  margin-inline: auto;
  margin-bottom: 32px;
  line-height: 1.7;
}
@media (min-width: 1024px) { .lp-hero-sub { margin-inline: 0; } }

.lp-hero-btns {
  display: flex; flex-direction: column; gap: 12px;
  align-items: center;
}
@media (min-width: 480px) { .lp-hero-btns { flex-direction: row; justify-content: center; } }
@media (min-width: 1024px) { .lp-hero-btns { justify-content: flex-end; } }

/* ── Floating cards ──────────────────────────────────── */
.lp-hero-cards {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 320px;
  width: 100%;
}
.lp-float-card {
  border-radius: 14px;
  padding: 14px 16px;
  backdrop-filter: blur(20px) saturate(180%);
}
.lp-card-blue {
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.35);
  box-shadow: 0 8px 32px rgba(26,86,219,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
}
.lp-card-green {
  background: linear-gradient(135deg, rgba(34,197,94,0.12), rgba(255,255,255,0.03));
  border: 1px solid rgba(34,197,94,0.32);
  box-shadow: 0 8px 24px rgba(34,197,94,0.12), inset 0 1px 0 rgba(255,255,255,0.06);
}
.lp-card-amber {
  background: linear-gradient(135deg, rgba(245,158,11,0.12), rgba(255,255,255,0.03));
  border: 1px solid rgba(245,158,11,0.30);
  box-shadow: 0 8px 24px rgba(245,158,11,0.10), inset 0 1px 0 rgba(255,255,255,0.06);
}
.lp-rotate-neg1  { transform: rotate(-1deg);  }
.lp-rotate-pos   { transform: rotate(0.5deg); }
.lp-rotate-neg05 { transform: rotate(-0.5deg);}

.lfc-live { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.lfc-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #22C55E;
  box-shadow: 0 0 8px rgba(34,197,94,0.8);
  animation: livepulse 2s ease-in-out infinite;
}
@keyframes livepulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.lfc-live-label { font-size: 10px; color: #22C55E; font-weight: 700; }
.lfc-label { font-size: 11px; color: #637285; margin-bottom: 3px; }
.lfc-value { font-size: 20px; font-weight: 800; color: #E8EDF5; }
.lfc-sub   { font-size: 11px; color: #637285; margin-top: 3px; }
.lfc-green { color: #22C55E; }
.lfc-green-val { color: #22C55E; }
.lfc-amber-val { color: #F59E0B; font-size: 16px; }

/* ── Scroll chevron ─────────────────────────────────── */
.lp-scroll-chevron {
  position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%);
  color: #1A56DB; opacity: 0.6;
  animation: bounce 2s ease-in-out infinite;
}
@keyframes bounce { 0%,100%{ transform: translateX(-50%) translateY(0); } 50%{ transform: translateX(-50%) translateY(6px); } }

/* ── Stats bar ──────────────────────────────────────── */
.lp-stats { padding-block: 48px; }
.lp-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: rgba(26,86,219,0.18);
  border-radius: 16px;
  overflow: hidden;
}
@media (min-width: 640px) { .lp-stats-grid { grid-template-columns: repeat(4, 1fr); } }
.lp-stat-chip {
  background: #06090F;
  padding: 28px 20px;
  text-align: center;
}
.lp-stat-val   { font-size: clamp(28px, 5vw, 40px); font-weight: 800; color: #E8EDF5; margin-bottom: 6px; }
.lp-stat-label { font-size: 12px; color: #637285; }

/* ── Features grid ──────────────────────────────────── */
.lp-features-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 640px)  { .lp-features-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .lp-features-grid { grid-template-columns: repeat(3, 1fr); } }

.lp-feat-card {
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 4px 20px rgba(26,86,219,0.08), inset 0 1px 0 rgba(255,255,255,0.06);
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
}
.lp-feat-card:hover {
  border-color: rgba(26,86,219,0.50);
  box-shadow: 0 8px 32px rgba(26,86,219,0.18), inset 0 1px 0 rgba(255,255,255,0.09);
  transform: translateY(-2px);
}
.lp-feat-icon  { font-size: 24px; margin-bottom: 10px; }
.lp-feat-title { font-size: 15px; font-weight: 700; color: #E8EDF5; margin-bottom: 6px; }
.lp-feat-body  { font-size: 13px; color: #637285; line-height: 1.6; }

/* ── Product story ──────────────────────────────────── */
.lp-story-wrap { display: flex; flex-direction: column; gap: 60px; }
.lp-story-row  {
  display: flex; flex-direction: column; gap: 28px; align-items: center;
}
@media (min-width: 1024px) {
  .lp-story-row         { flex-direction: row; }
  .lp-story-row.lp-story-reverse { flex-direction: row-reverse; }
}
.lp-story-img {
  flex: 1;
  min-height: 220px;
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.10), rgba(255,255,255,0.04));
  border: 1px solid rgba(26,86,219,0.28);
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(26,86,219,0.10);
  display: flex; align-items: center; justify-content: center;
  width: 100%;
}
.lp-story-img-label { font-size: 12px; color: #3D4F6B; }
.lp-story-text { flex: 1; }
.lp-story-tag  { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #1A56DB; display: block; margin-bottom: 10px; }
.lp-story-h2   { font-size: clamp(20px, 3vw, 30px); font-weight: 800; color: #E8EDF5; margin-bottom: 12px; line-height: 1.3; }
.lp-story-p    { font-size: 15px; color: #637285; line-height: 1.7; }

/* ── How it works ───────────────────────────────────── */
.lp-how-bg { background: transparent; }
.lp-steps  {
  display: flex;
  flex-direction: column;
  gap: 32px;
  align-items: flex-start;
}
@media (min-width: 768px) {
  .lp-steps { flex-direction: row; align-items: flex-start; }
}
.lp-step-wrap { display: flex; align-items: flex-start; gap: 16px; flex: 1; }
.lp-step { flex: 1; }
.lp-step-num {
  width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  color: white; font-size: 16px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(26,86,219,0.40);
  margin-bottom: 12px;
}
.lp-step-title { font-size: 16px; font-weight: 700; color: #E8EDF5; margin-bottom: 6px; }
.lp-step-body  { font-size: 13px; color: #637285; line-height: 1.7; }
.lp-step-arrow {
  color: #3D4F6B; font-size: 20px; margin-top: 8px; flex-shrink: 0;
  display: none;
}
@media (min-width: 768px) { .lp-step-arrow { display: block; } }

/* ── Pricing table ──────────────────────────────────── */
.lp-pricing-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
@media (min-width: 1024px) {
  .lp-pricing-wrap { flex-direction: row; align-items: flex-start; gap: 20px; }
}

.lp-price-core {
  backdrop-filter: blur(20px) saturate(180%);
  background: linear-gradient(135deg, rgba(26,86,219,0.18), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.45);
  border-radius: 18px; padding: 28px;
  box-shadow: 0 8px 36px rgba(26,86,219,0.20), inset 0 1px 0 rgba(255,255,255,0.09);
  min-width: 240px;
}
.lp-founding-badge {
  display: inline-block;
  background: rgba(34,197,94,0.15); color: #22C55E;
  border: 1px solid rgba(34,197,94,0.35); border-radius: 20px;
  padding: 3px 10px; font-size: 11px; font-weight: 700;
  margin-bottom: 14px;
}
.lp-price-name    { font-size: 18px; font-weight: 700; color: #E8EDF5; margin-bottom: 6px; }
.lp-price-amount  { font-size: 32px; font-weight: 800; color: #3B7FFF; margin-bottom: 16px; }
.lp-price-period  { font-size: 14px; font-weight: 400; color: #637285; }
.lp-price-features {
  list-style: none; padding: 0; margin: 0 0 20px;
  display: flex; flex-direction: column; gap: 7px;
  font-size: 13px; color: #C8D5E8;
}
.lp-price-note { font-size: 11px; color: #3D4F6B; margin-top: 10px; text-align: center; }
.lp-price-cta  { display: block; text-align: center; }

.lp-packs-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
@media (min-width: 640px) { .lp-packs-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .lp-packs-grid { grid-template-columns: 1fr; } }

.lp-pack-card {
  backdrop-filter: blur(16px) saturate(160%);
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px; padding: 18px;
  transition: border-color 0.2s;
}
.lp-pack-card:hover { border-color: rgba(26,86,219,0.30); }
.lp-pack-card.lp-pack-amber {
  background: linear-gradient(135deg, rgba(245,158,11,0.08), rgba(255,255,255,0.03));
  border-color: rgba(245,158,11,0.25);
}
.lp-pack-name    { font-size: 14px; font-weight: 700; color: #E8EDF5; margin-bottom: 4px; }
.lp-pack-price   { font-size: 18px; font-weight: 800; color: #3B7FFF; margin-bottom: 10px; }
.lp-pack-card.lp-pack-amber .lp-pack-price { color: #F59E0B; }
.lp-pack-period  { font-size: 11px; font-weight: 400; color: #637285; }
.lp-pack-features {
  list-style: none; padding: 0; margin: 0;
  font-size: 12px; color: #637285; line-height: 1.9;
}

/* ── Trust badges ───────────────────────────────────── */
.lp-trust-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
@media (min-width: 768px) { .lp-trust-grid { grid-template-columns: repeat(4, 1fr); } }
.lp-trust-badge {
  display: flex; align-items: center; gap: 10px;
  backdrop-filter: blur(16px);
  background: rgba(245,158,11,0.07);
  border: 1px solid rgba(245,158,11,0.22);
  border-radius: 12px; padding: 14px 16px;
}
.lp-trust-icon { font-size: 20px; flex-shrink: 0; }
.lp-trust-text { font-size: 12px; font-weight: 600; color: #C8D5E8; }

/* ── Founding CTA ───────────────────────────────────── */
.lp-cta-wrap { position: relative; display: flex; justify-content: center; }
.lp-cta-card {
  position: relative; z-index: 1;
  max-width: 600px; width: 100%; text-align: center;
  backdrop-filter: blur(32px) saturate(200%);
  background: linear-gradient(135deg, rgba(26,86,219,0.16), rgba(26,86,219,0.06));
  border: 1px solid rgba(26,86,219,0.50);
  border-radius: 20px; padding: 48px 36px;
  box-shadow: 0 8px 48px rgba(26,86,219,0.22), inset 0 1px 0 rgba(255,255,255,0.09);
}
.lp-cta-h2   { font-size: clamp(22px, 4vw, 34px); font-weight: 800; color: #E8EDF5; margin-bottom: 12px; }
.lp-cta-sub  { font-size: 15px; color: #637285; margin-bottom: 28px; line-height: 1.7; max-width: 420px; margin-inline: auto; }
.lp-cta-spots { font-size: 12px; color: #3D4F6B; margin-top: 12px; }

/* ── Buttons ─────────────────────────────────────────── */
.lp-btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  height: 48px; padding-inline: 28px;
  border-radius: 12px; font-size: 15px; font-weight: 700; color: white;
  background: linear-gradient(135deg, #1A56DB, #1248B3);
  box-shadow: 0 4px 18px rgba(26,86,219,0.40);
  border: none; cursor: pointer; text-decoration: none;
  transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.lp-btn-primary:hover {
  opacity: 0.9;
  box-shadow: 0 6px 24px rgba(26,86,219,0.55);
}
.lp-btn-ghost {
  display: inline-flex; align-items: center; justify-content: center;
  height: 48px; padding-inline: 28px;
  border-radius: 12px; font-size: 15px; font-weight: 500;
  color: #E8EDF5; background: transparent;
  border: 1px solid rgba(255,255,255,0.20); cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.lp-btn-ghost:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.32); }

/* ── Footer ─────────────────────────────────────────── */
.lp-footer {
  border-top: 1px solid rgba(26,86,219,0.20);
  padding-block: 48px;
}
.lp-footer-top {
  display: flex; flex-direction: column; gap: 28px;
  margin-bottom: 32px;
}
@media (min-width: 640px) { .lp-footer-top { flex-direction: row; justify-content: space-between; align-items: flex-start; } }
.lp-footer-brand   { font-size: 20px; font-weight: 800; color: #E8EDF5; margin-bottom: 4px; }
.lp-footer-tagline { font-size: 12px; color: #637285; }
.lp-footer-links   { display: flex; gap: 40px; }
.lp-footer-col     { display: flex; flex-direction: column; gap: 8px; }
.lp-footer-col-head { font-size: 12px; font-weight: 700; color: #E8EDF5; margin-bottom: 4px; }
.lp-footer-link    { font-size: 13px; color: #637285; text-decoration: none; cursor: pointer; transition: color 0.2s; }
.lp-footer-link:hover { color: #3B7FFF; }
.lp-footer-bottom {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.06);
  flex-wrap: wrap; gap: 12px;
}
.lp-footer-copy     { font-size: 12px; color: #3D4F6B; }
.lp-footer-payments { display: flex; gap: 8px; }
.lp-pay-badge {
  font-size: 11px; color: #637285;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 5px; padding: 3px 8px;
}
</style>
