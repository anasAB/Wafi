<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { store } from '../store'

const router = useRouter()

/* ── Step state ──────────────────────────────────────────── */
const step      = ref(1)
const direction = ref<'next' | 'prev'>('next')

function goNext() { direction.value = 'next'; step.value++ }
function goPrev() { direction.value = 'prev'; step.value-- }

const transName = computed(() => direction.value === 'next' ? 'step-next' : 'step-prev')

/* ── Step 1 ─ Account ────────────────────────────────────── */
const dialCodes = [
  { code: '+966', flag: '🇸🇦', label: 'السعودية' },
  { code: '+971', flag: '🇦🇪', label: 'الإمارات' },
  { code: '+963', flag: '🇸🇾', label: 'سوريا' },
  { code: '+964', flag: '🇮🇶', label: 'العراق' },
  { code: '+962', flag: '🇯🇴', label: 'الأردن' },
  { code: '+961', flag: '🇱🇧', label: 'لبنان' },
  { code: '+965', flag: '🇰🇼', label: 'الكويت' },
  { code: '+974', flag: '🇶🇦', label: 'قطر' },
  { code: '+973', flag: '🇧🇭', label: 'البحرين' },
  { code: '+968', flag: '🇴🇲', label: 'عُمان' },
  { code: '+20',  flag: '🇪🇬', label: 'مصر' },
  { code: '+213', flag: '🇩🇿', label: 'الجزائر' },
  { code: '+212', flag: '🇲🇦', label: 'المغرب' },
  { code: '+216', flag: '🇹🇳', label: 'تونس' },
  { code: '+249', flag: '🇸🇩', label: 'السودان' },
  { code: '+970', flag: '🇵🇸', label: 'فلسطين' },
]

const dialCode  = ref('+966')
const phone     = ref('')
const password  = ref('')
const showPass  = ref(false)

const passStrength = computed(() => {
  const p = password.value
  if (!p) return 0
  let score = 0
  if (p.length >= 8)  score++
  if (/[A-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  return score
})
const passLabel = computed(() => ['', 'ضعيفة', 'متوسطة', 'قوية'][passStrength.value])
const passColor = computed(() => ['', '#FF6B6B', '#F0B429', '#00CC88'][passStrength.value])

function step1Next() {
  if (!phone.value || !password.value) return
  store.phone = dialCode.value + phone.value
  goNext()
}

/* ── Step 2 ─ Business ───────────────────────────────────── */
const bizTypes = [
  { id: 'restaurant', icon: '🍽️', label: 'مطعم وكافيه' },
  { id: 'retail',     icon: '🛍️', label: 'محل تجزئة' },
  { id: 'pharmacy',   icon: '💊',  label: 'صيدلية' },
  { id: 'grocery',    icon: '🛒', label: 'بقالة' },
  { id: 'clothing',   icon: '👗', label: 'ملابس' },
  { id: 'tech',       icon: '📱', label: 'إلكترونيات' },
  { id: 'services',   icon: '🔧', label: 'خدمات' },
  { id: 'other',      icon: '🏢', label: 'أخرى' },
]

const bizName     = ref('')
const bizType     = ref('')
const bizCountry  = ref('SA')

const countries = [
  { code: 'SA', label: 'المملكة العربية السعودية' },
  { code: 'AE', label: 'الإمارات العربية المتحدة' },
  { code: 'SY', label: 'سوريا' },
  { code: 'IQ', label: 'العراق' },
  { code: 'JO', label: 'الأردن' },
  { code: 'LB', label: 'لبنان' },
  { code: 'KW', label: 'الكويت' },
  { code: 'QA', label: 'قطر' },
  { code: 'BH', label: 'البحرين' },
  { code: 'OM', label: 'عُمان' },
  { code: 'EG', label: 'مصر' },
  { code: 'DZ', label: 'الجزائر' },
  { code: 'MA', label: 'المغرب' },
  { code: 'TN', label: 'تونس' },
  { code: 'SD', label: 'السودان' },
  { code: 'PS', label: 'فلسطين' },
  { code: 'YE', label: 'اليمن' },
  { code: 'LY', label: 'ليبيا' },
]

function step2Next() {
  if (!bizName.value || !bizType.value) return
  store.businessName = bizName.value
  store.businessType = bizType.value
  store.country      = bizCountry.value
  goNext()
}

/* ── Step 3 ─ Start goal ─────────────────────────────────── */
const goals = [
  {
    id: 'sell',
    icon: '⚡',
    title: 'ابدأ البيع فوراً',
    desc: 'افتح نقطة البيع مباشرة وسجّل أول معاملة — كل شيء جاهز.',
    badge: 'الأكثر اختياراً',
  },
  {
    id: 'inventory',
    icon: '📦',
    title: 'أضف مخزونك أولاً',
    desc: 'أضف منتجاتك وأسعارها قبل البدء بالبيع.',
  },
  {
    id: 'explore',
    icon: '🗺️',
    title: 'استكشف النظام',
    desc: 'جولة سريعة لاكتشاف كل مميزات وافي بدون ضغط.',
  },
]
const selectedGoal = ref('')

const loading = ref(false)

async function finish() {
  if (!selectedGoal.value) return
  store.startGoal = selectedGoal.value as typeof store.startGoal
  loading.value = true
  await new Promise(r => setTimeout(r, 900))
  loading.value = false
  router.push('/onboarding')
}
</script>

<template>
  <div class="signup" dir="rtl">

    <!-- ── Form panel ── -->
    <div class="sp-form-panel">

      <div class="sp-top">
        <RouterLink to="/" class="logo">
          <span class="logo-mark">و</span>
          <span class="logo-name">وافي</span>
        </RouterLink>
      </div>

      <!-- Progress indicator -->
      <div class="progress-bar">
        <div
          v-for="n in 3" :key="n"
          class="prog-step"
          :class="{ done: step > n, active: step === n }"
        >
          <div class="prog-dot">
            <span v-if="step > n" class="prog-check">✓</span>
            <span v-else>{{ n }}</span>
          </div>
          <span class="prog-label">{{ ['حسابك','عملك','ابدأ'][n-1] }}</span>
          <div v-if="n < 3" class="prog-line" :class="{ done: step > n }"></div>
        </div>
      </div>

      <!-- Step wrapper with transition -->
      <div class="sp-body">
        <Transition :name="transName" mode="out-in">

          <!-- ═══ STEP 1 ═══ -->
          <div v-if="step === 1" key="1" class="step-content">
            <h1 class="sp-title">إنشاء حسابك</h1>
            <p class="sp-sub">لنبدأ برقم هاتفك</p>

            <div class="field">
              <label class="label">رقم الهاتف</label>
              <div class="phone-row">
                <select v-model="dialCode" class="dial-select" dir="ltr">
                  <option v-for="d in dialCodes" :key="d.code" :value="d.code">{{ d.flag }} {{ d.code }}</option>
                </select>
                <input v-model="phone" type="tel" class="phone-input" placeholder="05x xxxx xxxx" dir="ltr" inputmode="tel" />
              </div>
            </div>

            <div class="field">
              <label class="label">كلمة المرور</label>
              <div class="pass-row">
                <input
                  v-model="password"
                  :type="showPass ? 'text' : 'password'"
                  class="pass-input"
                  placeholder="٨ أحرف على الأقل"
                  dir="ltr"
                  autocomplete="new-password"
                />
                <button type="button" class="eye-btn" @click="showPass = !showPass">
                  {{ showPass ? '🙈' : '👁' }}
                </button>
              </div>
              <!-- Strength indicator -->
              <div v-if="password" class="strength-row">
                <div class="strength-bars">
                  <div
                    v-for="i in 3" :key="i"
                    class="s-bar"
                    :style="{ background: i <= passStrength ? passColor : 'rgba(255,255,255,.08)' }"
                  ></div>
                </div>
                <span class="strength-label" :style="{ color: passColor }">{{ passLabel }}</span>
              </div>
            </div>

            <button class="sp-btn" @click="step1Next" :disabled="!phone || !password">
              التالي <span class="btn-arr">←</span>
            </button>

            <p class="alt-link">لديك حساب؟ <RouterLink to="/login">سجّل الدخول</RouterLink></p>
          </div>

          <!-- ═══ STEP 2 ═══ -->
          <div v-else-if="step === 2" key="2" class="step-content">
            <h1 class="sp-title">عملك التجاري</h1>
            <p class="sp-sub">أخبرنا قليلاً عن نشاطك</p>

            <div class="field">
              <label class="label">اسم العمل التجاري</label>
              <input v-model="bizName" type="text" class="text-input" placeholder="مثال: مطعم أبو حمزة" />
            </div>

            <div class="field">
              <label class="label">نوع النشاط</label>
              <div class="type-grid">
                <button
                  v-for="t in bizTypes" :key="t.id"
                  type="button"
                  class="type-card"
                  :class="{ selected: bizType === t.id }"
                  @click="bizType = t.id"
                >
                  <span class="type-icon">{{ t.icon }}</span>
                  <span class="type-label">{{ t.label }}</span>
                </button>
              </div>
            </div>

            <div class="field">
              <label class="label">البلد</label>
              <div class="select-wrap">
                <select v-model="bizCountry" class="text-select">
                  <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.label }}</option>
                </select>
              </div>
            </div>

            <div class="step-btns">
              <button class="sp-btn-outline" @click="goPrev">→ رجوع</button>
              <button class="sp-btn" @click="step2Next" :disabled="!bizName || !bizType">
                التالي <span class="btn-arr">←</span>
              </button>
            </div>
          </div>

          <!-- ═══ STEP 3 ═══ -->
          <div v-else key="3" class="step-content">
            <h1 class="sp-title">كيف تبدأ؟</h1>
            <p class="sp-sub">اختر المسار المناسب لك — يمكنك تغييره لاحقاً</p>

            <div class="goals-list">
              <button
                v-for="g in goals" :key="g.id"
                type="button"
                class="goal-card"
                :class="{ selected: selectedGoal === g.id }"
                @click="selectedGoal = g.id"
              >
                <div class="goal-icon">{{ g.icon }}</div>
                <div class="goal-body">
                  <div class="goal-title-row">
                    <span class="goal-title">{{ g.title }}</span>
                    <span v-if="g.badge" class="goal-badge">{{ g.badge }}</span>
                  </div>
                  <p class="goal-desc">{{ g.desc }}</p>
                </div>
                <div class="goal-radio" :class="{ checked: selectedGoal === g.id }"></div>
              </button>
            </div>

            <div class="step-btns">
              <button class="sp-btn-outline" @click="goPrev">→ رجوع</button>
              <button
                class="sp-btn sp-btn-green"
                @click="finish"
                :disabled="!selectedGoal || loading"
                :class="{ loading }"
              >
                <span v-if="!loading">إنشاء الحساب ✓</span>
                <span v-else class="spinner"></span>
              </button>
            </div>
          </div>

        </Transition>
      </div>

      <div class="sp-foot">
        <span class="lang active">العربية</span>
        <span class="lang-dot">·</span>
        <span class="lang">English</span>
      </div>

    </div>

    <!-- ── Brand panel ── -->
    <div class="sp-brand" aria-hidden="true">
      <div class="brand-bg"></div>
      <div class="brand-glow"></div>
      <div class="sp-brand-content">
        <div class="brand-logo">
          <span class="brand-mark">و</span>
          <span class="brand-name-lg">وافي</span>
        </div>
        <h2 class="sp-brand-h">انضم إلى<br><span class="grad">+٢٠,٠٠٠ شركة</span></h2>
        <ul class="sp-perks">
          <li><span class="perk-ck">✓</span> نقطة بيع تعمل على أي جهاز</li>
          <li><span class="perk-ck">✓</span> مخزون وفواتير تلقائية</li>
          <li><span class="perk-ck">✓</span> تقارير لحظية بدون محاسب</li>
          <li><span class="perk-ck">✓</span> دعم بالعربية على مدار الساعة</li>
        </ul>
        <div class="sp-trial-note">١٤ يوماً مجاناً · لا بطاقة ائتمان</div>
      </div>
    </div>

  </div>
</template>

<style>
.signup {
  display: flex;
  min-height: 100svh;
  background: #05080F;
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
}

/* ── Form panel ─────────────────────────────────────────── */
.sp-form-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 20px;
}
@media (min-width: 900px) {
  .sp-form-panel { width: 520px; flex-shrink: 0; padding: 0 48px; }
}

.sp-top { padding: 24px 0 0; }
@media (min-width: 900px) { .sp-top { padding: 36px 0 0; } }

/* ── Progress bar ───────────────────────────────────────── */
.progress-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 24px 0 0;
  max-width: 320px;
}

.prog-step {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.prog-dot {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: #0D1828;
  border: 2px solid rgba(255,255,255,.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #637285;
  transition: all .3s;
  flex-shrink: 0;
}
.prog-step.active .prog-dot {
  border-color: #00CC88;
  color: #00CC88;
  box-shadow: 0 0 0 4px rgba(0,204,136,.12);
}
.prog-step.done .prog-dot {
  background: #00CC88;
  border-color: #00CC88;
  color: #03070D;
}
.prog-check { font-size: 12px; }
.prog-label {
  font-size: 12px;
  font-weight: 700;
  color: #364A66;
  white-space: nowrap;
}
.prog-step.active .prog-label,
.prog-step.done .prog-label  { color: #E8EDF5; }

.prog-line {
  height: 2px;
  width: 32px;
  background: rgba(255,255,255,.08);
  margin: 0 4px;
  flex-shrink: 0;
  transition: background .3s;
}
.prog-line.done { background: #00CC88; }

/* ── Step content ───────────────────────────────────────── */
.sp-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 20px 0 24px;
  max-width: 420px;
  width: 100%;
  overflow: hidden;
}

.step-content { width: 100%; }

.sp-title { font-size: 26px; font-weight: 900; color: #E8EDF5; margin-bottom: 6px; }
@media (min-width: 600px) { .sp-title { font-size: 30px; } }
.sp-sub   { font-size: 15px; color: #637285; margin-bottom: 32px; }

/* ── Fields (shared with login, redeclare to avoid scope issues) ── */
.field    { margin-bottom: 18px; }
.label    { display: block; font-size: 13px; font-weight: 700; color: #9AABC7; margin-bottom: 8px; }

.phone-row {
  display: flex;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  overflow: hidden;
  background: #0D1828;
  transition: border-color .2s;
}
.phone-row:focus-within { border-color: #00CC88; box-shadow: 0 0 0 3px rgba(0,204,136,.12); }
.dial-select {
  background: rgba(255,255,255,.04);
  border: none;
  border-left: 1px solid rgba(255,255,255,.08);
  color: #E8EDF5;
  font-family: 'Tajawal', sans-serif;
  font-size: 14px;
  min-height: 50px;
  width: 100px;
  flex-shrink: 0;
  cursor: pointer;
  outline: none;
  padding: 0 8px 0 24px;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236B7C9E'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 8px center;
}
.dial-select option { background: #0D1828; }
.phone-input {
  flex: 1; background: transparent; border: none;
  color: #E8EDF5; font-family: 'Tajawal', sans-serif; font-size: 16px;
  padding: 0 16px; min-height: 50px; outline: none; min-width: 0;
}
.phone-input::placeholder { color: #3D4F6B; }

.pass-row {
  display: flex;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  overflow: hidden;
  background: #0D1828;
  transition: border-color .2s;
}
.pass-row:focus-within { border-color: #00CC88; box-shadow: 0 0 0 3px rgba(0,204,136,.12); }
.pass-input {
  flex: 1; background: transparent; border: none;
  color: #E8EDF5; font-family: 'Tajawal', sans-serif; font-size: 16px;
  padding: 0 16px; min-height: 50px; outline: none; letter-spacing: 2px; min-width: 0;
}
.pass-input::placeholder { letter-spacing: 0; color: #3D4F6B; }
.eye-btn {
  background: transparent; border: none; padding: 0 14px;
  color: #637285; font-size: 16px; cursor: pointer;
  display: flex; align-items: center; min-height: 50px; min-width: 44px; justify-content: center;
  transition: color .2s;
}
.eye-btn:hover { color: #E8EDF5; }

.strength-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.strength-bars { display: flex; gap: 4px; }
.s-bar { width: 40px; height: 3px; border-radius: 3px; transition: background .3s; }
.strength-label { font-size: 12px; font-weight: 700; }

.text-input {
  width: 100%;
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  color: #E8EDF5;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px;
  padding: 0 16px;
  min-height: 50px;
  outline: none;
  transition: border-color .2s;
  box-sizing: border-box;
}
.text-input:focus { border-color: #00CC88; box-shadow: 0 0 0 3px rgba(0,204,136,.12); }
.text-input::placeholder { color: #3D4F6B; }

.select-wrap { position: relative; }
.text-select {
  width: 100%;
  background: #0D1828;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  color: #E8EDF5;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  padding: 0 16px;
  min-height: 50px;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236B7C9E'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 16px center;
  transition: border-color .2s;
  box-sizing: border-box;
}
.text-select:focus { border-color: #00CC88; }
.text-select option { background: #0D1828; }

/* Business type grid */
.type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 480px) { .type-grid { grid-template-columns: repeat(4, 1fr); gap: 6px; } }

.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  background: #0D1828;
  border: 1.5px solid rgba(255,255,255,.07);
  border-radius: 12px;
  cursor: pointer;
  transition: all .2s;
  min-height: 70px;
  justify-content: center;
}
.type-card:hover { border-color: rgba(255,255,255,.18); background: #111F35; }
.type-card.selected { border-color: #00CC88; background: rgba(0,204,136,.08); }
.type-icon  { font-size: 22px; }
.type-label { font-size: 11px; font-weight: 600; color: #8A9BBF; text-align: center; line-height: 1.3; }
.type-card.selected .type-label { color: #00CC88; }

/* ── Goal cards (step 3) ────────────────────────────────── */
.goals-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }

.goal-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 16px;
  background: #0D1828;
  border: 1.5px solid rgba(255,255,255,.08);
  border-radius: 14px;
  cursor: pointer;
  text-align: right;
  transition: all .2s;
  width: 100%;
}
.goal-card:hover { border-color: rgba(255,255,255,.18); background: #101E32; }
.goal-card.selected { border-color: #00CC88; background: rgba(0,204,136,.07); }

.goal-icon { font-size: 26px; flex-shrink: 0; }
.goal-body { flex: 1; min-width: 0; }
.goal-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
.goal-title { font-size: 15px; font-weight: 700; color: #E8EDF5; }
.goal-badge {
  font-size: 10px;
  font-weight: 700;
  background: rgba(0,204,136,.15);
  color: #00CC88;
  border: 1px solid rgba(0,204,136,.25);
  padding: 2px 8px;
  border-radius: 100px;
}
.goal-desc { font-size: 13px; color: #637285; line-height: 1.5; text-align: right; }

.goal-radio {
  width: 20px; height: 20px;
  border: 2px solid rgba(255,255,255,.15);
  border-radius: 50%;
  flex-shrink: 0;
  transition: all .2s;
  position: relative;
}
.goal-radio.checked {
  border-color: #00CC88;
  background: #00CC88;
}
.goal-radio.checked::after {
  content: '';
  position: absolute;
  inset: 4px;
  background: #03070D;
  border-radius: 50%;
}

/* ── Buttons ────────────────────────────────────────────── */
.sp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #00CC88;
  color: #03070D;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px;
  font-weight: 800;
  min-height: 52px;
  padding: 0 28px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: background .2s, transform .2s, box-shadow .2s, opacity .2s;
  white-space: nowrap;
}
.sp-btn:hover:not(:disabled) { background: #00DFA0; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,204,136,.35); }
.sp-btn:disabled { opacity: .45; cursor: not-allowed; }
.sp-btn.sp-btn-green { min-width: 180px; }
.btn-arr { font-size: 17px; }

.sp-btn-outline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: #8A9BBF;
  font-family: 'Tajawal', sans-serif;
  font-size: 15px;
  font-weight: 600;
  min-height: 52px;
  padding: 0 20px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 12px;
  cursor: pointer;
  transition: all .2s;
  white-space: nowrap;
}
.sp-btn-outline:hover { border-color: rgba(255,255,255,.25); color: #E8EDF5; }

/* First step: full-width btn */
.step-content > .sp-btn { width: 100%; }

.step-btns {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
}

.spinner {
  width: 20px; height: 20px;
  border: 2.5px solid rgba(3,7,13,.3);
  border-top-color: #03070D;
  border-radius: 50%;
  animation: spin .7s linear infinite;
  display: inline-block;
}

.alt-link {
  text-align: center;
  font-size: 14px;
  color: #637285;
  margin-top: 22px;
}
.alt-link a { color: #00CC88; font-weight: 700; text-decoration: none; }
.alt-link a:hover { text-decoration: underline; }

/* ── Footer ─────────────────────────────────────────────── */
.sp-foot {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 20px 0 28px;
}
@media (min-width: 900px) { .sp-foot { padding: 0 0 40px; } }
.lang       { font-size: 13px; color: #3D4F6B; cursor: pointer; transition: color .2s; }
.lang:hover { color: #8A9BBF; }
.lang.active { color: #8A9BBF; font-weight: 700; }
.lang-dot   { font-size: 13px; color: #1E2D42; }

/* ── Step transitions ─────────────────────────────────────── */
.step-next-enter-active,
.step-next-leave-active,
.step-prev-enter-active,
.step-prev-leave-active {
  transition: all .3s ease;
}
/* Forward: new enters from left (RTL "next"), old exits to right */
.step-next-enter-from { transform: translateX(-24px); opacity: 0; }
.step-next-leave-to   { transform: translateX(24px); opacity: 0; }
/* Backward: new enters from right, old exits to left */
.step-prev-enter-from { transform: translateX(24px); opacity: 0; }
.step-prev-leave-to   { transform: translateX(-24px); opacity: 0; }

/* ── Brand panel ─────────────────────────────────────────── */
.sp-brand { display: none; }
@media (min-width: 900px) {
  .sp-brand {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    background: #080C18;
    border-right: 1px solid rgba(255,255,255,.06);
  }
}
.brand-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px);
  background-size: 52px 52px;
}
.brand-glow {
  position: absolute;
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(0,204,136,.10) 0%, transparent 65%);
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
}
.sp-brand-content {
  position: relative;
  z-index: 1;
  max-width: 380px;
  padding: 40px;
}
.brand-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 40px; }
.brand-mark {
  width: 48px; height: 48px;
  background: #00CC88; color: #03070D;
  font-size: 26px; font-weight: 900;
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
}
.brand-name-lg { font-size: 26px; font-weight: 800; color: #E8EDF5; }

.sp-brand-h {
  font-size: 30px;
  font-weight: 900;
  line-height: 1.3;
  color: #E8EDF5;
  margin-bottom: 32px;
}
.grad {
  background: linear-gradient(120deg, #00CC88 30%, #4B9EFF 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sp-perks {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 36px;
}
.sp-perks li { display: flex; align-items: center; gap: 12px; font-size: 15px; color: #9AABC7; }
.perk-ck {
  width: 22px; height: 22px;
  background: rgba(0,204,136,.15);
  color: #00CC88;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.sp-trial-note {
  font-size: 14px;
  color: #3D4F6B;
  padding-top: 24px;
  border-top: 1px solid rgba(255,255,255,.07);
}
</style>
