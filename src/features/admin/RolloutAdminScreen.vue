<!--
  WAFI-155 placeholder: Vite's import-analysis plugin resolves the string
  argument of a dynamic import() at transform time (for chunk-graph
  purposes) even when the import is never executed, so router/index.ts's
  `component: () => import('@/features/admin/RolloutAdminScreen.vue')`
  fails the whole test file's collection phase with "Failed to resolve
  import" unless this path exists on disk -- regardless of whether any
  test actually navigates here. This stub exists only to satisfy that
  resolution; Task 9 replaces it with the real screen (it will Read this
  file first, then overwrite it).
-->
<template>
  <div />
</template>
