// Flat ESLint config (ESLint 10) for a Vue 3 + TypeScript project.
//
// Targets the stack we actually use: Vue 3 SFCs with <script lang="ts"> parsed
// by @typescript-eslint, plus the curated rule set ported from the old
// .eslintrc.js. Prettier formatting is intentionally NOT run as a lint rule —
// we disable conflicting stylistic rules via @vue/eslint-config-prettier and let
// Prettier own formatting on its own pass.
//
// Only packages that are actually installed are referenced here.

import pluginVue from 'eslint-plugin-vue'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

// Shared project rules, applied to both .ts and .vue files.
const projectRules = {
  // General JS/TS best practices
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  // Ban coercive == / != everywhere EXCEPT against null — `x != null` is the
  // intended "not null and not undefined" idiom used throughout the codebase.
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  curly: 'error',
  'no-var': 'error',
  // Don't suggest const for a `let` that is read by a closure before its single
  // assignment (e.g. a listener-unbind handle referenced inside its own setup).
  'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
  // TypeScript specific
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-inferrable-types': 'off',
  // Vue 3 best practices
  'vue/no-mutating-props': 'error',
  'vue/no-v-html': 'warn',
  'vue/require-default-prop': 'warn',
  'vue/require-prop-types': 'warn',
  'vue/multi-word-component-names': 'off',
}

export default [
  // Replaces the old .eslintignore (unsupported under flat config).
  {
    name: 'app/ignores',
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'dev-dist/**',
      'coverage/**',
      'supabase/**',
      '.claude/**',
      '.agents/**',
      '**/*.d.ts',
    ],
  },

  // Vue 3 recommended — wires vue-eslint-parser for .vue files.
  ...pluginVue.configs['flat/recommended'],

  // Plain TypeScript files.
  {
    name: 'app/typescript',
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: { ...tsPlugin.configs.recommended.rules },
  },

  // Vue SFCs: keep vue-eslint-parser (set above) and parse <script lang="ts">
  // with the TS parser. We set parserOptions.parser only — NOT languageOptions
  // .parser — so the outer SFC parser stays vue-eslint-parser.
  {
    name: 'app/vue-script-ts',
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tsParser },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: { ...tsPlugin.configs.recommended.rules },
  },

  // Project rule set, applied across both file kinds.
  {
    name: 'app/rules',
    files: ['**/*.{ts,tsx,mts,cts,vue}'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: projectRules,
  },

  // Turn off rules that conflict with Prettier. Keep last.
  skipFormatting,
]
