# PWA Offline Verification Runbook

Manual procedure to confirm the app installs and works offline. Run section A
before any demo; keep section B handy so nothing surprises you live.

## A. Offline smoke test

1. Build and serve the production bundle (the service worker does NOT run in
   `npm run dev`):
   ```bash
   npm run build && npm run preview
   ```
   Open the printed `http://localhost:<port>` URL (localhost is a secure context,
   so the SW registers).
2. **Install:**
   - Android/Chrome or desktop Chrome/Edge: the "ثبّت التطبيق" affordance appears
     on the landing page; click it → the browser install dialog appears → install.
   - iOS Safari: the "للتثبيت: اضغط مشاركة ← إضافة إلى الشاشة الرئيسية" hint
     appears (iOS has no programmatic install prompt).
3. **Offline-ready:** on the first load, the toast "التطبيق جاهز للعمل بدون
   إنترنت" appears once caching completes.
4. **Offline load:** open DevTools → Network → set **Offline** (or enable airplane
   mode). Hard-reload. The app boots from cache.
5. **Offline data ops:** record a sale and add an expense — both succeed. Close
   and reopen the tab while still offline — the data persists (local SQLite).
6. **Recovery:** set the network back **Online**. If `VITE_POWERSYNC_URL` is set,
   sync runs and the pending count drains.

## B. Pre-demo gotchas

- **First load must be online** — the SW can only cache after one successful
  online visit. A cold first launch with no network will not work.
- **Production build only** — `npm run dev` has no service worker.
- **Local-only mode** — with no `VITE_POWERSYNC_URL`, the sync badge reads
  "غير متصل" by design (it tracks the sync server, not the network). Set the URL
  to demo live sync.
- **Fonts** fall back to system fonts offline until font caching ships
  (Phase 3); the UI still works, it just isn't pixel-identical.

## C. Demo script

**Moment #1 — "install from a link":** open the link on the device → tap
"ثبّت التطبيق" (or Share → Add to Home Screen on iOS) → launch from the home
screen icon (standalone, no browser chrome).

**Moment #2 — "works without internet":** with the app open, turn off WiFi →
record a sale → it completes instantly → point out nothing failed → turn WiFi
back on.

## D. Cross-device matrix (filled in during Phase 3)

| Platform        | Install | Icon correct | Offline load | Offline sale |
|-----------------|---------|--------------|--------------|--------------|
| Android Chrome  |         |              |              |              |
| iOS Safari      |         |              |              |              |
| Desktop Chrome  |         |              |              |              |
| Desktop Edge    |         |              |              |              |
