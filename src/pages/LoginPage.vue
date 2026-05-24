<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { store } from '../store'

const router = useRouter()

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

const dialCode = ref('+966')
const phone    = ref('')
const password = ref('')
const showPass = ref(false)
const loading  = ref(false)
const error    = ref('')

const selectedDial = () => dialCodes.find(d => d.code === dialCode.value)

async function submit() {
  if (!phone.value || !password.value) { error.value = 'أدخل رقم الهاتف وكلمة المرور'; return }
  error.value = ''
  loading.value = true
  store.phone = dialCode.value + phone.value
  await new Promise(r => setTimeout(r, 700))
  loading.value = false
  router.push('/onboarding')
}
</script>

<template>
  <div class="auth" dir="rtl">

    <!-- ── Form panel (appears on RIGHT in RTL flex) ── -->
    <div class="form-panel">

      <div class="form-top">
        <RouterLink to="/" class="logo">
          <span class="logo-mark">و</span>
          <span class="logo-name">وافي</span>
        </RouterLink>
      </div>

      <div class="form-body">
        <h1 class="form-title">مرحباً بعودتك</h1>
        <p class="form-sub">سجّل دخولك برقم هاتفك</p>

        <form @submit.prevent="submit" novalidate>

          <div class="field">
            <label class="label">رقم الهاتف</label>
            <div class="phone-row">
              <select v-model="dialCode" class="dial-select" dir="ltr" aria-label="رمز الدولة">
                <option v-for="d in dialCodes" :key="d.code" :value="d.code">
                  {{ d.flag }} {{ d.code }}
                </option>
              </select>
              <input
                v-model="phone"
                type="tel"
                class="phone-input"
                placeholder="05x xxxx xxxx"
                dir="ltr"
                inputmode="tel"
                autocomplete="tel-national"
              />
            </div>
          </div>

          <div class="field">
            <div class="label-row">
              <label class="label">كلمة المرور</label>
              <RouterLink to="/forgot" class="forgot-link" tabindex="-1">نسيت كلمة المرور؟</RouterLink>
            </div>
            <div class="pass-row">
              <input
                v-model="password"
                :type="showPass ? 'text' : 'password'"
                class="pass-input"
                placeholder="••••••••"
                dir="ltr"
                autocomplete="current-password"
              />
              <button type="button" class="eye-btn" @click="showPass = !showPass" :aria-label="showPass ? 'إخفاء' : 'إظهار'">
                <span v-if="showPass">🙈</span>
                <span v-else>👁</span>
              </button>
            </div>
          </div>

          <p v-if="error" class="err-msg">{{ error }}</p>

          <button type="submit" class="submit-btn" :class="{ loading }" :disabled="loading">
            <span v-if="!loading">دخول</span>
            <span v-else class="spinner"></span>
          </button>

        </form>

        <p class="alt-link">ليس لديك حساب؟
          <RouterLink to="/signup">سجّل الآن</RouterLink>
        </p>
      </div>

      <div class="form-foot">
        <span class="lang active">العربية</span>
        <span class="lang-dot">·</span>
        <span class="lang">English</span>
      </div>

    </div>

    <!-- ── Brand panel (appears on LEFT in RTL flex, desktop only) ── -->
    <div class="brand-panel" aria-hidden="true">
      <div class="brand-bg"></div>
      <div class="brand-glow"></div>
      <div class="brand-content">
        <div class="brand-logo">
          <span class="brand-mark">و</span>
          <span class="brand-name">وافي</span>
        </div>
        <blockquote class="brand-quote">
          "النظام الوحيد الذي جعل إدارة مطعمي ممكنة
          من هاتفي — في أي مكان وأي وقت."
        </blockquote>
        <div class="brand-author">
          <div class="brand-avatar">أ</div>
          <div>
            <div class="brand-name-sm">أحمد الزهراني</div>
            <div class="brand-role">صاحب سلسلة مطاعم · جدة</div>
          </div>
        </div>
        <div class="brand-stats">
          <div class="brand-stat">
            <span class="bs-val">+٢٠,٠٠٠</span>
            <span class="bs-lbl">شركة</span>
          </div>
          <div class="brand-stat">
            <span class="bs-val">٤.٨★</span>
            <span class="bs-lbl">تقييم</span>
          </div>
          <div class="brand-stat">
            <span class="bs-val">١٥+</span>
            <span class="bs-lbl">دولة</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&display=swap');

.auth {
  display: flex;
  min-height: 100svh;
  background: #05080F;
  font-family: 'Tajawal', sans-serif;
  direction: rtl;
}

/* ── Form panel ─────────────────────────────────────────── */
.form-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 20px;
}
@media (min-width: 900px) {
  .form-panel { width: 480px; flex-shrink: 0; padding: 0 48px; }
}

.form-top {
  padding: 24px 0;
}
@media (min-width: 900px) { .form-top { padding: 36px 0; } }

.logo {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
}
.logo-mark {
  width: 36px; height: 36px;
  background: #00CC88;
  color: #03070D;
  font-size: 20px;
  font-weight: 900;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.logo-name { font-size: 20px; font-weight: 800; color: #E8EDF5; }

.form-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 20px 0 32px;
  max-width: 384px;
  width: 100%;
}

.form-title {
  font-size: 26px;
  font-weight: 900;
  color: #E8EDF5;
  margin-bottom: 6px;
}
@media (min-width: 600px) { .form-title { font-size: 30px; } }

.form-sub {
  font-size: 15px;
  color: #637285;
  margin-bottom: 36px;
}

/* ── Fields ─────────────────────────────────────────────── */
.field { margin-bottom: 20px; }

.label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #9AABC7;
  margin-bottom: 8px;
  letter-spacing: .3px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
/* Forgot password — present but secondary */
.forgot-link {
  font-size: 12px;
  color: #3D4F6B;
  text-decoration: none;
  transition: color .2s;
}
.forgot-link:hover { color: #637285; }

/* Phone row */
.phone-row {
  display: flex;
  gap: 0;
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
  padding: 0 10px;
  min-height: 50px;
  width: 100px;
  flex-shrink: 0;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236B7C9E'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 8px center;
  padding-left: 22px;
}
.dial-select option { background: #0D1828; color: #E8EDF5; }

.phone-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #E8EDF5;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px;
  padding: 0 16px;
  min-height: 50px;
  outline: none;
  min-width: 0;
}
.phone-input::placeholder { color: #3D4F6B; }

/* Password row */
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
  flex: 1;
  background: transparent;
  border: none;
  color: #E8EDF5;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px;
  padding: 0 16px;
  min-height: 50px;
  outline: none;
  letter-spacing: 2px;
  min-width: 0;
}
.pass-input::placeholder { letter-spacing: 0; color: #3D4F6B; }

.eye-btn {
  background: transparent;
  border: none;
  padding: 0 14px;
  color: #637285;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  min-height: 50px;
  min-width: 44px;
  justify-content: center;
  transition: color .2s;
}
.eye-btn:hover { color: #E8EDF5; }

/* Error */
.err-msg {
  font-size: 13px;
  color: #FF6B6B;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: rgba(255,107,107,.08);
  border: 1px solid rgba(255,107,107,.2);
  border-radius: 8px;
}

/* Submit button */
.submit-btn {
  width: 100%;
  background: #00CC88;
  color: #03070D;
  font-family: 'Tajawal', sans-serif;
  font-size: 16px;
  font-weight: 800;
  min-height: 52px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: background .2s, transform .2s, box-shadow .2s;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
}
.submit-btn:hover:not(:disabled) { background: #00DFA0; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,204,136,.35); }
.submit-btn:disabled { opacity: .7; cursor: not-allowed; }

.spinner {
  width: 20px; height: 20px;
  border: 2.5px solid rgba(3,7,13,.3);
  border-top-color: #03070D;
  border-radius: 50%;
  animation: spin .7s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }

.alt-link {
  text-align: center;
  font-size: 14px;
  color: #637285;
  margin-top: 24px;
}
.alt-link a { color: #00CC88; font-weight: 700; text-decoration: none; }
.alt-link a:hover { text-decoration: underline; }

/* ── Language toggle (bottom) ─────────────────────────── */
.form-foot {
  padding: 20px 0 28px;
  display: flex;
  gap: 10px;
  align-items: center;
}
@media (min-width: 900px) { .form-foot { padding: 0 0 40px; } }

.lang {
  font-size: 13px;
  color: #3D4F6B;
  cursor: pointer;
  transition: color .2s;
}
.lang:hover  { color: #8A9BBF; }
.lang.active { color: #8A9BBF; font-weight: 700; }
.lang-dot    { font-size: 13px; color: #1E2D42; }

/* ── Brand panel (desktop only) ─────────────────────────── */
.brand-panel {
  display: none;
}
@media (min-width: 900px) {
  .brand-panel {
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
    linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px);
  background-size: 52px 52px;
}
.brand-glow {
  position: absolute;
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(0,204,136,.10) 0%, transparent 65%);
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
}
.brand-content {
  position: relative;
  z-index: 1;
  max-width: 380px;
  padding: 40px;
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 48px;
}
.brand-mark {
  width: 48px; height: 48px;
  background: #00CC88;
  color: #03070D;
  font-size: 26px;
  font-weight: 900;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-name {
  font-size: 26px;
  font-weight: 800;
  color: #E8EDF5;
}

.brand-quote {
  font-size: 18px;
  line-height: 1.75;
  color: #E8EDF5;
  font-style: normal;
  margin-bottom: 28px;
  font-weight: 400;
  position: relative;
}
.brand-quote::before {
  content: '"';
  font-size: 60px;
  color: rgba(0,204,136,.2);
  position: absolute;
  top: -20px;
  right: -10px;
  font-family: Georgia, serif;
  line-height: 1;
}

.brand-author {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 40px;
}
.brand-avatar {
  width: 44px; height: 44px;
  background: rgba(0,204,136,.2);
  color: #00CC88;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 900;
}
.brand-name-sm { font-size: 14px; font-weight: 700; color: #E8EDF5; }
.brand-role    { font-size: 12px; color: #637285; }

.brand-stats {
  display: flex;
  gap: 28px;
  padding-top: 32px;
  border-top: 1px solid rgba(255,255,255,.07);
}
.brand-stat { display: flex; flex-direction: column; gap: 3px; }
.bs-val { font-size: 20px; font-weight: 900; color: #00CC88; }
.bs-lbl { font-size: 12px; color: #637285; }
</style>
