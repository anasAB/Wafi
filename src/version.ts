import pkg from '../package.json'

declare const __GIT_SHA__: string
declare const __BUILD_DATE__: string
declare const __MIGRATION_NUMBER__: string

/**
 * Real build identification (WAFI-022) -- replaces the hardcoded
 * APP_VERSION = 'v0.1.0' constant that previously lived in
 * SettingsPage.vue. Answers "which deployment?" when something breaks:
 * version + git SHA + build date + the highest applied migration number
 * at build time.
 */
export const BUILD_INFO = {
  version: pkg.version,
  gitSha: __GIT_SHA__,
  buildDate: __BUILD_DATE__,
  migrationNumber: parseInt(__MIGRATION_NUMBER__, 10),
}
