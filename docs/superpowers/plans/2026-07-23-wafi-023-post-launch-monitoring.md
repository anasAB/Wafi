# WAFI-023 Post-Launch Monitoring & Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentry error tracking with PII scrubbing, a WhatsApp-based in-app "report a problem" flow, and an operations doc covering weekly review + SLA.

**Architecture:** A standalone `src/sentry.ts` module (testable in isolation, since `main.ts` itself isn't unit-tested) initializes Sentry and exports its PII-scrubbing `beforeSend` hook separately. A new Settings screen and a two-line addition to `ForgotPasswordPage.vue` both reuse the existing `openWhatsApp` helper — no new messaging code. A new `docs/OPERATIONS.md` covers the process pieces.

**Tech Stack:** Vue 3, Vite, `@sentry/vue`, Vitest.

## Global Constraints

- No new backend/database work — Sentry and WhatsApp are both client-only integrations against existing helpers/env vars.
- PII must be scrubbed from Sentry events before they leave the browser — strip known-sensitive field names (`phone`, `customerName`, `nameAr`, `name`) and any phone-number-shaped string (`\+?\d{9,}`) from event data.
- Sentry must no-op (not error) when `VITE_SENTRY_DSN` is unset — matches this repo's existing pattern in `src/data/supabase/client.ts` of warning and no-op-ing when its own env vars are unset.
- Reuse `openWhatsApp(phone, text)` from `src/features/messaging/whatsapp.ts` verbatim in both the new Settings screen and `ForgotPasswordPage.vue` — do not write new WhatsApp-link code.
- Do not add app-version stamping to the report message — `package.json`'s `"version": "0.0.0"` is an unmaintained placeholder, not a real build identifier.
- No session replay, performance monitoring, or any Sentry feature beyond basic error capture.

---

### Task 1: Sentry initialization with PII scrubbing

**Files:**
- Create: `src/sentry.ts`
- Test: `src/__tests__/sentry.test.ts`
- Modify: `src/main.ts`
- Modify: `.env.local.example`
- Modify: `package.json` (add `@sentry/vue` dependency)

**Interfaces:**
- Produces: `initSentry(app: App): void` and `scrubPiiBeforeSend(event: Sentry.Event): Sentry.Event` (both exported from `src/sentry.ts`, the latter exported specifically so Task 1's own test can exercise it directly without needing a real Sentry SDK call). Task 2/3 do not depend on this file.
- Consumes: `@sentry/vue`'s `init`, `Event` type; `import.meta.env.VITE_SENTRY_DSN`, `import.meta.env.PROD`.

- [ ] **Step 1: Install the dependency**

```bash
npm install @sentry/vue
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/sentry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scrubPiiBeforeSend } from '@/sentry'
import type { Event as SentryEvent } from '@sentry/vue'

describe('scrubPiiBeforeSend', () => {
  it('redacts known PII field names from event extra data', () => {
    const event: SentryEvent = {
      extra: {
        customerName: 'أحمد محمد',
        phone: '+963944123456',
        nameAr: 'محل الأخ',
        totalUsd: 42, // not PII, must survive untouched
      },
    }
    const result = scrubPiiBeforeSend(event)
    expect(result.extra?.customerName).toBe('[redacted]')
    expect(result.extra?.phone).toBe('[redacted]')
    expect(result.extra?.nameAr).toBe('[redacted]')
    expect(result.extra?.totalUsd).toBe(42)
  })

  it('redacts phone-number-shaped strings anywhere in extra data, even under an unrelated key', () => {
    const event: SentryEvent = {
      extra: { note: 'called +963944123456 about the issue' },
    }
    const result = scrubPiiBeforeSend(event)
    expect(result.extra?.note).not.toContain('963944123456')
  })

  it('passes through an event with no extra data unchanged', () => {
    const event: SentryEvent = { message: 'a generic error' }
    const result = scrubPiiBeforeSend(event)
    expect(result).toEqual(event)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/sentry.test.ts`
Expected: FAIL — `@/sentry` module does not exist yet.

- [ ] **Step 4: Implement**

Create `src/sentry.ts`:

```ts
import * as Sentry from '@sentry/vue'
import type { App } from 'vue'

const PII_FIELD_NAMES = new Set(['phone', 'customerName', 'nameAr', 'name'])
const PHONE_LIKE_PATTERN = /\+?\d{9,}/g

/**
 * Strips known-PII field values and any phone-number-shaped substring from
 * a Sentry event's `extra` data before it leaves the browser. This is real
 * Syrian shop customer data (names, phone numbers) going to Sentry's
 * (US-based) servers -- scrub first, not an afterthought.
 */
export function scrubPiiBeforeSend(event: Sentry.Event): Sentry.Event {
  if (!event.extra) return event

  const scrubbed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event.extra)) {
    if (PII_FIELD_NAMES.has(key)) {
      scrubbed[key] = '[redacted]'
    } else if (typeof value === 'string') {
      scrubbed[key] = value.replace(PHONE_LIKE_PATTERN, '[redacted]')
    } else {
      scrubbed[key] = value
    }
  }
  return { ...event, extra: scrubbed }
}

/**
 * No-ops when VITE_SENTRY_DSN is unset (matches src/data/supabase/client.ts's
 * pattern of warning and no-op-ing rather than erroring when unconfigured),
 * and only ever sends in a production build.
 */
export function initSentry(app: App): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) {
    console.warn('[Sentry] VITE_SENTRY_DSN not set — error tracking disabled.')
    return
  }
  if (!import.meta.env.PROD) return

  Sentry.init({
    app,
    dsn,
    beforeSend: scrubPiiBeforeSend,
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/sentry.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 6: Wire into `main.ts`**

Modify `src/main.ts` — the current file ends with a chained
`createApp(App).use(...).use(...).use(PrimeVue, {...}).mount('#app')`
expression. Sentry's `init({ app, ... })` needs the `app` instance before
`.mount()` is called, so capture it in a variable:

```ts
import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import { i18n } from './i18n'
import './style.css'
import 'primeicons/primeicons.css'
import App    from './App.vue'
import router from './router'
import { initSentry } from './sentry'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

const app = createApp(App)
initSentry(app)

app
  .use(pinia)
  .use(router)
  .use(i18n)
  .use(PrimeVue, {
    // RTL is wired at the app root via the `dir="rtl"` attribute; PrimeVue
    // components inherit it. No PrimeVue-specific RTL flag is needed in v4.
    theme: {
      preset: Aura,
      options: {
        // Match the app's existing class-based dark mode (`.dark` on <html>)
        // instead of PrimeVue's default `system` so it stays in sync with the
        // app's theme toggle and the `@custom-variant dark` in style.css.
        darkModeSelector: '.dark',
        // Emit PrimeVue's styled-mode CSS into a `primevue` layer ordered
        // before Tailwind's utilities, so Tailwind utility classes can always
        // override component styles.
        cssLayer: {
          name: 'primevue',
          order: 'theme, base, primevue',
        },
      },
    },
  })
  .mount('#app')
```

- [ ] **Step 7: Add the env var placeholder**

In `.env.local.example`, add (after the existing `VITE_POWERSYNC_URL` line,
before the `VITE_STUB_*` block):

```
# Sentry DSN for error tracking (WAFI-023). Leave blank to disable --
# initSentry() no-ops without it. Get one free at sentry.io.
VITE_SENTRY_DSN=
```

- [ ] **Step 8: Run the full test suite once**

Run: `npm test`
Expected: PASS (170 → 171 test files — the pre-existing flaky
`router-auth-guard.test.ts` timeout, if it recurs, is unrelated and
already documented in this project's prior WAFI-00x work).

- [ ] **Step 9: Commit**

```bash
git add src/sentry.ts src/__tests__/sentry.test.ts src/main.ts .env.local.example package.json package-lock.json
git commit -m "feat(wafi-023): add Sentry error tracking with PII scrubbing

initSentry() no-ops when VITE_SENTRY_DSN is unset or outside a production
build. beforeSend strips known-PII field names and phone-number-shaped
strings from event extra data before anything leaves the browser --
this is real Syrian shop customer data, not test fixtures."
```

---

### Task 2: In-app "report a problem" screen

**Files:**
- Create: `src/features/settings/screens/ReportProblemScreen.vue`
- Test: `src/__tests__/features/ReportProblemScreen.test.ts`
- Modify: `src/router/index.ts` (add route)
- Modify: `.env.local.example` (add support phone env var)

**Interfaces:**
- Consumes: `openWhatsApp(phone: string, text: string): void` from `@/features/messaging/whatsapp.ts` (existing, unmodified). `import.meta.env.VITE_SUPPORT_WHATSAPP_PHONE`.
- Produces: no new exports — this is a page component, reached via its route.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/features/ReportProblemScreen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const openWhatsAppMock = vi.fn()
vi.mock('@/features/messaging/whatsapp', () => ({
  openWhatsApp: (...args: unknown[]) => openWhatsAppMock(...args),
}))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => ({ path: '/settings/report-problem' }),
}))

import ReportProblemScreen from '@/features/settings/screens/ReportProblemScreen.vue'

describe('ReportProblemScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPPORT_WHATSAPP_PHONE', '963900000000')
  })

  it('opens WhatsApp with the support phone and a message containing the current route', async () => {
    const wrapper = mount(ReportProblemScreen)
    await wrapper.find('button').trigger('click')

    expect(openWhatsAppMock).toHaveBeenCalledTimes(1)
    const [phone, text] = openWhatsAppMock.mock.calls[0]
    expect(phone).toBe('963900000000')
    expect(text).toContain('/settings/report-problem')
  })

  it('includes the entered description text in the WhatsApp message', async () => {
    const wrapper = mount(ReportProblemScreen)
    await wrapper.find('textarea').setValue('البرنامج توقف عند البيع')
    await wrapper.find('button').trigger('click')

    const [, text] = openWhatsAppMock.mock.calls[0]
    expect(text).toContain('البرنامج توقف عند البيع')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/features/ReportProblemScreen.test.ts`
Expected: FAIL — `ReportProblemScreen.vue` does not exist yet.

- [ ] **Step 3: Implement**

Create `src/features/settings/screens/ReportProblemScreen.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { openWhatsApp } from '@/features/messaging/whatsapp'

const route = useRoute()
const description = ref('')

function send() {
  const supportPhone = import.meta.env.VITE_SUPPORT_WHATSAPP_PHONE as string | undefined
  if (!supportPhone) return

  const lines = [
    'تقرير مشكلة من تطبيق وافي',
    `الصفحة: ${route.path}`,
  ]
  if (description.value.trim()) {
    lines.push(`الوصف: ${description.value.trim()}`)
  }
  openWhatsApp(supportPhone, lines.join('\n'))
}
</script>

<template>
  <div dir="rtl" class="report-problem">
    <h1>الإبلاغ عن مشكلة</h1>
    <p>صف المشكلة باختصار (اختياري) وسنفتح واتساب لإرسال بلاغك لفريق الدعم.</p>
    <textarea v-model="description" rows="4" placeholder="مثال: البرنامج توقف عند تسجيل عملية بيع"></textarea>
    <button type="button" @click="send">إرسال عبر واتساب</button>
  </div>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/features/ReportProblemScreen.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Add the route**

In `src/router/index.ts`, inside the `/settings` route's `children` array
(the same array containing `devices`/`recovery-codes`), add:

```ts
{ path: 'report-problem', component: () => import('@/features/settings/screens/ReportProblemScreen.vue') },
```

- [ ] **Step 6: Add the env var placeholder**

In `.env.local.example`, add directly below the `VITE_SENTRY_DSN` line
added in Task 1:

```
# WhatsApp number (international digits, no +) the "report a problem"
# screen and ForgotPasswordPage.vue send support messages to. This is the
# FOUNDERS' own support number, not a shop's customer phone.
VITE_SUPPORT_WHATSAPP_PHONE=
```

- [ ] **Step 7: Run the full test suite once**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/settings/screens/ReportProblemScreen.vue src/__tests__/features/ReportProblemScreen.test.ts src/router/index.ts .env.local.example
git commit -m "feat(wafi-023): add in-app report-a-problem screen

Reuses the existing openWhatsApp helper -- no new messaging code. Opens
WhatsApp to the founders' support number with the current route and an
optional description prefilled."
```

---

### Task 3: Wire `ForgotPasswordPage.vue`'s existing prose to a real button

**Files:**
- Modify: `src/pages/ForgotPasswordPage.vue`
- Modify: `src/__tests__/features/ForgotPasswordPage.test.ts`

**Interfaces:**
- Consumes: `openWhatsApp` from `@/features/messaging/whatsapp.ts` (same as Task 2).
- Produces: no new exports.

- [ ] **Step 1: Read the current file and test (already shown in full below — reproduced for reference)**

Current `src/pages/ForgotPasswordPage.vue`:
```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div dir="rtl" class="forgot-password">
    <h1>نسيت كلمة المرور؟</h1>
    <p>
      لأسباب أمنية، لا يمكن إعادة تعيين كلمة المرور تلقائياً حالياً.
      تواصل مع فريق الدعم عبر واتساب وسنساعدك على استعادة الوصول لحسابك خلال دقائق.
    </p>
    <button type="button" @click="router.push('/login')">العودة لتسجيل الدخول</button>
  </div>
</template>
```

Current `src/__tests__/features/ForgotPasswordPage.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue'

describe('ForgotPasswordPage', () => {
  it('shows the assisted-reset instructions in Arabic', () => {
    const wrapper = mount(ForgotPasswordPage)
    expect(wrapper.text()).toContain('تواصل')
  })
})
```

- [ ] **Step 2: Write the failing test**

Add this test to `src/__tests__/features/ForgotPasswordPage.test.ts` (keep
the existing test unchanged, just add a new `it` block and the mock at
the top of the file):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const openWhatsAppMock = vi.fn()
vi.mock('@/features/messaging/whatsapp', () => ({
  openWhatsApp: (...args: unknown[]) => openWhatsAppMock(...args),
}))

import ForgotPasswordPage from '@/pages/ForgotPasswordPage.vue'

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPPORT_WHATSAPP_PHONE', '963900000000')
  })

  it('shows the assisted-reset instructions in Arabic', () => {
    const wrapper = mount(ForgotPasswordPage)
    expect(wrapper.text()).toContain('تواصل')
  })

  it('opens WhatsApp to the support number when the contact button is clicked', async () => {
    const wrapper = mount(ForgotPasswordPage)
    const contactButton = wrapper.findAll('button').find(b => b.text().includes('واتساب'))
    expect(contactButton).toBeTruthy()
    await contactButton!.trigger('click')
    expect(openWhatsAppMock).toHaveBeenCalledWith('963900000000', expect.any(String))
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/features/ForgotPasswordPage.test.ts`
Expected: FAIL — no button with "واتساب" text exists yet (the current button says "العودة لتسجيل الدخول").

- [ ] **Step 4: Implement**

Replace `src/pages/ForgotPasswordPage.vue` in full:

```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import { openWhatsApp } from '@/features/messaging/whatsapp'

const router = useRouter()

function contactSupport() {
  const supportPhone = import.meta.env.VITE_SUPPORT_WHATSAPP_PHONE as string | undefined
  if (!supportPhone) return
  openWhatsApp(supportPhone, 'أحتاج مساعدة في استعادة الوصول لحسابي (نسيت كلمة المرور).')
}
</script>

<template>
  <div dir="rtl" class="forgot-password">
    <h1>نسيت كلمة المرور؟</h1>
    <p>
      لأسباب أمنية، لا يمكن إعادة تعيين كلمة المرور تلقائياً حالياً.
      تواصل مع فريق الدعم عبر واتساب وسنساعدك على استعادة الوصول لحسابك خلال دقائق.
    </p>
    <button type="button" @click="contactSupport">تواصل عبر واتساب</button>
    <button type="button" @click="router.push('/login')">العودة لتسجيل الدخول</button>
  </div>
</template>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/features/ForgotPasswordPage.test.ts`
Expected: PASS, both tests.

- [ ] **Step 6: Run the full test suite once**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ForgotPasswordPage.vue src/__tests__/features/ForgotPasswordPage.test.ts
git commit -m "feat(wafi-023): wire ForgotPasswordPage's support prose to a real button

Was prose-only ('contact support via WhatsApp') with no working link.
Reuses the same openWhatsApp helper and VITE_SUPPORT_WHATSAPP_PHONE env
var as the new report-a-problem screen."
```

---

### Task 4: Operations documentation

**Files:**
- Create: `docs/OPERATIONS.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Write the document**

Create `docs/OPERATIONS.md`:

```markdown
# Wafi Operations

## Weekly Review Checklist

Run through this once a week (not automated — a founder practice):

1. **Sentry** — open the project dashboard, check for new or recurring
   errors since last week. Anything affecting the live shop (customer #0)
   is priority; anything else, triage by frequency.
2. **WhatsApp** — check the support number for any unresolved messages
   from the "report a problem" flow or `ForgotPasswordPage.vue`'s contact
   button. Respond per the SLA below.
3. **Audit log** — spot-check `/settings/audit-log` for anything unusual
   (repeated failed logins, unexpected deactivations, large discounts) —
   this is the same trail WAFI-007's financial-write wrapper guarantees
   gets written on every financial action.

## Support SLA

Given the founders' part-time availability (day jobs, side-project hours),
this is an honest, sustainable commitment — not a 24/7 enterprise SLA:

- **Weekday evenings**: same-day response to WhatsApp support messages.
- **Weekends / outside evening hours**: next business day.
- **Data-loss or complete inability to sell**: treated as urgent regardless
  of time — reach out directly, don't wait for the weekly review cycle.

This SLA is what WAFI-022's "monitoring tested" checklist item should
point back to once that ticket is picked up.

## Error Tracking (Sentry)

- Free tier, client-side only (`src/sentry.ts`).
- Disabled unless `VITE_SENTRY_DSN` is set in the deployed build's
  environment, and only active in production builds.
- PII (customer names, phone numbers) is scrubbed before events leave the
  browser — see `scrubPiiBeforeSend` in `src/sentry.ts`.

## In-App Reporting

- Settings → "الإبلاغ عن مشكلة" (`/settings/report-problem`) and
  `ForgotPasswordPage.vue`'s support button both open WhatsApp to
  `VITE_SUPPORT_WHATSAPP_PHONE` — the founders' own number, configured
  per deployment.
```

- [ ] **Step 2: Commit**

```bash
git add docs/OPERATIONS.md
git commit -m "docs(wafi-023): add operations doc for weekly review and SLA

Covers the process pieces of WAFI-023 that aren't code: a weekly review
checklist (Sentry, WhatsApp, audit log) and an honest SLA matching the
founders' actual part-time availability."
```

---

### Task 5: Final verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, 173 test files (170 baseline + `sentry.test.ts` +
`ReportProblemScreen.test.ts`, with `ForgotPasswordPage.test.ts` extended
in place rather than added as a new file).

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: exit 0, no TypeScript errors referencing `sentry.ts`, `main.ts`,
`ReportProblemScreen.vue`, `ForgotPasswordPage.vue`, or `router/index.ts`.

- [ ] **Step 3: Confirm both env vars are documented**

Run: `grep -n "VITE_SENTRY_DSN\|VITE_SUPPORT_WHATSAPP_PHONE" .env.local.example`
Expected: both lines present.

- [ ] **Step 4: Manual note for the human operator (not automatable)**

This plan wires the code paths but does NOT create a real Sentry account
or provision a real WhatsApp support number — those are external account
setup steps outside this repo. Before this ships to production:
- Create a free Sentry project, set `VITE_SENTRY_DSN` in the actual
  deployment's environment (not committed to git).
- Set `VITE_SUPPORT_WHATSAPP_PHONE` to the founders' real support number
  in the same deployment environment.
- Confirm a test error actually appears in the Sentry dashboard, and a
  test tap on "report a problem" actually opens WhatsApp with the right
  number, on a real device/build (not just the unit tests, which mock
  both integrations).

- [ ] **Step 5: No commit needed** — this task is verification only; if any check fails, return to the relevant earlier task and fix it there.
