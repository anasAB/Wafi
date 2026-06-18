import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// One source SVG → favicon + 192/512 PWA icons + 512 maskable + 180 apple-touch.
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/pwa-icon.svg'],
})
