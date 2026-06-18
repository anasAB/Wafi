import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import { i18n } from './i18n'
import { registerSW } from 'virtual:pwa-register'
import './style.css'
import 'primeicons/primeicons.css'
import App    from './App.vue'
import router from './router'

// Register the service worker so the app is installable ("add to home screen")
// and boots offline. `immediate` registers on load; `autoUpdate` (vite.config)
// swaps in new builds without a prompt.
registerSW({ immediate: true })

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

createApp(App)
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
