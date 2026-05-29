# ADR-005 — vue-i18n and pinia-plugin-persistedstate for i18n and settings persistence

| Field      | Value                                                    |
|------------|----------------------------------------------------------|
| Date       | 2026-05-29                                               |
| Status     | Accepted                                                 |
| Deciders   | Anas Baaj (CTO)                                          |
| Supersedes | None                                                     |

## Context

The Settings Foundation feature requires two cross-cutting capabilities:

1. **Internationalisation (i18n):** The product is Arabic-first, targeting Syrian retail shops. All UI strings, RTL layout direction, number/date/currency formatting, and future locale support must be managed through a single, framework-integrated i18n layer — not ad-hoc string constants scattered across components.

2. **Persistent settings state:** User preferences (language, currency display, theme, exchange rate) must survive page reloads and PWA restarts without a round-trip to the server. Settings are written once and read on every page load, so they need to be persisted to `localStorage` transparently from the Pinia store layer.

Both decisions affect > 1 component, are hard to replace once integrated (all string keys and store persistence annotations reference these libraries), and reversing either would cost > 1 sprint.

## Decision

**Adopt `vue-i18n@11` (Composition API mode) as the sole i18n mechanism.**
All UI strings are defined in locale message files under `src/i18n/locales/`. No string literals appear directly in component templates. The `useI18n()` composable is the only access point.

**Adopt `pinia-plugin-persistedstate@4` as the sole localStorage persistence layer for Pinia stores.**
The plugin is registered once on the Pinia instance. Individual stores opt in via `persist: true` in their `defineStore` options. No store may call `localStorage` directly.

## Alternatives Considered

| Option | Why Rejected |
|--------|-------------|
| `vue-i18n@9/10` | Older branches; v10 is deprecated upstream. No reason to start on a deprecated version when v11 is confirmed compatible with Pinia v3 + Vue 3.5 + Vite 8. |
| Hand-rolled i18n (reactive locale object) | No pluralisation, no number/date formatting, no fallback locale, no lazy loading of locale files. Fails as soon as a second language or formatted number is needed. |
| `@intlify/vue-i18n-bridge` | Bridge layer for migrating v8→v9; irrelevant for a greenfield project. |
| `vuex-persistedstate` | Tied to Vuex; project uses Pinia. |
| Manual `localStorage` reads/writes in each store | Violates DRY; every store would re-implement serialisation, error handling, and hydration. Hard to audit or swap storage backend. |
| `@vueuse/core` `useStorage` composable | Works at composable level, not store level. Requires wrapping each store ref individually; no single registration point; harder to audit which stores are persisted. |

## Consequences

**Positive:**
- Single source of truth for all locale strings — consistent Arabic RTL support across every component.
- Locale-aware number and date formatting built in (SYP currency, Arabic numerals if needed in v1.5).
- Settings stores (language, theme, exchange rate) automatically persist to `localStorage` and rehydrate on PWA restart with one line of config per store.
- Clear opt-in model: stores not annotated with `persist: true` are never touched, preventing accidental persistence of sensitive data.

**Negative / trade-offs:**
- `pinia-plugin-persistedstate@4` adds a serialisation/deserialisation step on every store write. Acceptable for settings stores; must not be applied to large transactional stores (POS cart, inventory lists).
- All component tests that render translated strings must call `installI18n()` in their test setup, adding minor test scaffolding overhead.

## Architecture Guidelines

- Register `vue-i18n` in `src/i18n/index.ts`; import the plugin in `src/main.ts` as `app.use(i18n)`.
- Locale message files: `src/i18n/locales/ar.ts` (primary), `src/i18n/locales/en.ts` (fallback). Keys use dot-notation namespaced by feature: `pos.addToCart`, `settings.language`.
- Register `pinia-plugin-persistedstate` in `src/stores/index.ts` (or `src/main.ts`) via `pinia.use(piniaPluginPersistedstate)`.
- `persist: true` is allowed only on settings, preferences, and session-identity stores. It is **forbidden** on POS cart, inventory, or any store that holds transactional or large-volume data.
- No component or composable may import `localStorage` directly for the purpose of persisting store state. All persistence goes through this plugin.
- When upgrading to a future major version of `vue-i18n`, consult the `@intlify/vue-i18n-tools` migration script before proceeding and update this ADR to Superseded.

## Review Date

**At v1.5 milestone (months 9-15).** No forced migration needed — project is already on v11. Review for minor version upgrades and any breaking changes at that point.
