# ADR-006 — PWA installability and offline app shell (vite-plugin-pwa, prompt updates, assets-generator)

| Field      | Value           |
|------------|-----------------|
| Date       | 2026-06-19      |
| Status     | Accepted        |
| Deciders   | Anas Baaj (CTO) |
| Supersedes | None            |

## Context

Two of the product's three Demo Moments (CLAUDE.md) depend on the app being a real installable PWA:

1. **"Runs on whatever device you have" — install from a link.** The shop owner opens a URL and adds the app to the home screen; it then launches standalone, no browser chrome, no app store.
2. **"Works without internet."** ADR-004 already makes *data* offline-first (local SQLite via PowerSync). But the *application shell itself* — HTML, JS, CSS, the wa-sqlite WASM — must also load with zero connectivity, or there is nothing to run the offline data layer in.

Before this decision the app had no service worker, no web app manifest, and stock template icons. The shell could not load offline and the browser would not offer to install it. Wiring a service worker is a cross-cutting, hard-to-reverse decision (precache strategy, update lifecycle, and icon pipeline all touch the build and the app shell), so it warrants an ADR.

A POS adds a specific constraint most PWAs do not have: **a service-worker update must never reload the page mid-sale.** A silent auto-update that swaps the running code while a cashier is tendering a sale is unacceptable.

## Decision

**Adopt `vite-plugin-pwa@1` (Workbox `generateSW`) as the sole service-worker / manifest mechanism.** The plugin owns the manifest, the precache of the built shell (including the WASM), and runtime caching. Service-worker registration lives in one composable (`usePwaLifecycle`) called once from `App.vue` — never ad hoc.

**Use `registerType: 'prompt'`, not `autoUpdate`.** A new build does not take over silently. The shell surfaces a non-blocking "تحديث متاح" toast (which does **not** auto-dismiss); the new service worker activates and the page reloads only when the user taps it. This guarantees no mid-sale reload.

**Adopt `@vite-pwa/assets-generator@1` (dev-only) for the icon set.** A single source SVG (`public/pwa-icon.svg`) generates the full PNG set (favicon, 192/512, maskable 512, apple-touch 180) at build time via the `minimal2023Preset`; the plugin injects the manifest `icons` and the apple-touch `<link>`. No hand-maintained binary icons live in the repo.

## Alternatives Considered

| Option | Why Rejected |
|--------|-------------|
| No service worker (hand-rolled `navigator.serviceWorker` + manual Cache API) | Re-implements Workbox precache manifest, cache versioning, and cleanup by hand. High-risk, easy to ship a stale or broken cache. Violates "do not hand-roll the sync/cache layer" spirit of CLAUDE.md. |
| `registerType: 'autoUpdate'` | Silently activates a new SW and reloads on next navigation — can reload mid-sale on a POS. Unacceptable given offline-first sale flows. |
| Workbox CLI / raw `workbox-build` | Not integrated with the Vite build graph; the precache manifest would drift from the actual emitted assets. The Vite plugin is the maintained, integrated path. |
| Hand-authored PNG icon set committed to `public/` | No image tooling in the repo; manual export is error-prone and drifts from the brand SVG. Binary blobs in git with no regeneration path. |
| Single SVG icon only (no PNGs) | Android/desktop install works, but iOS Safari "Add to Home Screen" does not reliably render an SVG apple-touch-icon — the home-screen tile degrades to a screenshot. PNGs are required for a correct iOS install. |

## Consequences

**Positive:**
- The app shell loads with zero connectivity after the first online visit, completing the offline story ADR-004 began at the data layer.
- One-tap install on Android/Chrome/desktop; correct branded icon on iOS home screens.
- Updates are user-controlled — no reload can interrupt a sale.
- The icon set regenerates from one source SVG; no binary drift.
- Registration is centralised in `usePwaLifecycle`, so the lifecycle (offline-ready, update-available) is testable and surfaced through the existing `AppToast`.

**Negative / trade-offs:**
- The service worker only runs in a production build over a secure context (HTTPS / localhost) — it is absent in `npm run dev`. Offline behaviour must be verified against `npm run build && npm run preview` (see `docs/pwa-offline-verification.md`).
- First load must be online for the SW to cache the shell; a cold first launch with no network cannot work.
- Precaching the wa-sqlite WASM makes the precache multi-MB; acceptable for installability and offline boot, but the cap (`maximumFileSizeToCacheInBytes`) must stay above the WASM size.
- `@vite-pwa/assets-generator` pulls `sharp` and platform binaries as dev/optional dependencies — build-time only, never shipped.

## Architecture Guidelines

- Service-worker registration happens **only** in `src/composables/usePwaLifecycle.ts`, invoked once from `App.vue`. No component calls `registerSW` directly; `main.ts` must not register the SW.
- `registerType` stays `'prompt'`. Do not switch to `'autoUpdate'` — the no-mid-sale-reload guarantee depends on it.
- The update toast must not auto-dismiss (pass `:auto-dismiss="false"`); a missed update prompt has no second `onNeedRefresh` firing.
- True network state comes from `useOnlineStatus` (`navigator.onLine`); it is distinct from PowerSync sync status (ADR-004) and the two must not be conflated in UI copy.
- Icons are generated — never hand-commit `pwa-*.png` / `apple-touch-icon-*.png`. Edit `public/pwa-icon.svg` and let `pwa-assets.config.ts` regenerate them.
- `vite-plugin-pwa` and `@vite-pwa/assets-generator` are **build tooling** and belong in `devDependencies`.
- Runtime caching of cross-origin Google Fonts uses `StaleWhileRevalidate` for the stylesheet (mutable URL) and `CacheFirst` for the font binaries (immutable).

## Review Date

**At v1.5 milestone (months 9-15).** Revisit if self-hosting fonts (removing the Google Fonts runtime cache) or if a per-customer feature-flag layer changes how the shell is built/served.
