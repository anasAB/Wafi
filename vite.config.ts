/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // Auto-update the service worker in the background — right for a demo and
      // for offline-first: the installed app silently picks up new builds.
      registerType: 'autoUpdate',
      // Branded icons live in public/; list them so Workbox precaches them too.
      includeAssets: ['favicon.svg', 'pwa-icon.svg'],
      manifest: {
        name:        'وافي — نظام إدارة المتجر',
        short_name:  'وافي',
        description: 'نظام إدارة متجر يعمل بدون إنترنت، عربي بالكامل، على أي جهاز تملكه.',
        lang:        'ar',
        dir:         'rtl',
        theme_color:      '#06090F',
        background_color: '#06090F',
        display:     'standalone',
        orientation: 'portrait',
        start_url:   '/',
        scope:       '/',
        icons: [
          // A single padded SVG serves both the regular ("any") and Android
          // maskable slots — the glyph sits inside the maskable safe zone.
          { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the built shell so the app cold-starts offline (demo moment #2).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        // PowerSync ships a multi-MB wa-sqlite WASM blob; raise the cap so it's
        // precached rather than silently skipped.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // SPA fallback: unknown routes resolve to the app shell when offline.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    // PowerSync uses WASM + web workers — must be excluded from Vite pre-bundling
    exclude: ['@powersync/web', '@journeyapps/wa-sqlite'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.agents', '.claude'],
    passWithNoTests: true,
  },
})
