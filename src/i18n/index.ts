import { createI18n } from 'vue-i18n'
import ar from './ar'
import en from './en'

export const i18n = createI18n({
  legacy:         false,
  locale:         'ar',
  fallbackLocale: 'ar',
  messages:       { ar, en },
})
