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
import { resumeBootstrapIfPending } from './router/bootstrap-resume'
import { incrementLocalHealthCounter, shopLocalToday } from './data/powersync/healthCounters'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

const app = createApp(App)
initSentry(app)

// WAFI-148: global unhandled-error counter. This must run independent of
// whether Sentry is configured (initSentry no-ops when VITE_SENTRY_DSN is
// unset, or outside a PROD build) -- chain onto whatever handler initSentry
// may have already installed (Sentry's @sentry/vue integration wires its own
// app.config.errorHandler when configured) rather than overwriting it, so
// both the local health counter and Sentry reporting fire on every error.
const previousErrorHandler = app.config.errorHandler
app.config.errorHandler = (err, instance, info) => {
  void incrementLocalHealthCounter('app_error_count', shopLocalToday())
  previousErrorHandler?.(err, instance, info)
}

app.use(pinia)

// Must run only after app.use(pinia) above -- resumeBootstrapIfPending()
// calls Pinia stores internally, and this file's own top-level imports
// (including './router', which used to make this exact call itself) are all
// evaluated before this line runs. .catch() is required, not cosmetic: this
// call is unawaited, so an unhandled rejection here would surface as a
// process-level error rather than the best-effort background check it is.
resumeBootstrapIfPending().catch((e) => {
  console.warn('[bootstrap-resume] failed to resume a pending owner bootstrap at boot:', e)
  // Resume is best-effort; a failure here just means the pending bootstrap
  // (if any) stays pending and will be retried on the next boot or by the
  // owner-setup screen itself.
})

app
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
