<script setup lang="ts">
const stats = [
  { value: '< 10s', label: 'Sale time' },
  { value: '2',     label: 'Currencies' },
  { value: '∞',     label: 'Offline time' },
  { value: '30 min', label: 'Onboarding' },
]
</script>

<template>
  <div class="min-h-dvh bg-bg-void text-text-primary overflow-x-hidden">

    <!-- ── Section 1: Hero ─────────────────────────────── -->
    <section data-testid="hero" class="relative min-h-dvh flex flex-col items-center justify-center px-6 overflow-hidden">
      <!-- Breathing radial gradient -->
      <div class="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          class="absolute inset-0 animate-breathe"
          style="background: radial-gradient(ellipse 60% 50% at 50% 40%, rgb(201 168 76 / 0.12) 0%, transparent 70%)"
        />
      </div>

      <div class="relative z-10 max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center gap-12 py-24">
        <!-- Text -->
        <div class="flex-1 text-center lg:text-start">
          <h1 class="font-display text-5xl lg:text-7xl font-light leading-[1.15] mb-6">
            Your store.<br>
            <span class="text-gold-primary">Fully in command.</span>
          </h1>
          <p class="text-text-muted text-base lg:text-lg mb-10 max-w-lg mx-auto lg:mx-0">
            The retail platform built for Syrian merchants — offline-first, Arabic-native, runs on any device you own.
          </p>
          <div class="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
            <RouterLink to="/home" class="btn-gold">ابدأ الآن / Start Now</RouterLink>
            <button type="button" class="btn-ghost">شاهد العرض / Watch Demo</button>
          </div>
        </div>

        <!-- Device mockup (placeholder grid until real screenshot) -->
        <div class="flex-1 flex justify-center animate-float">
          <div class="glass-md p-3 w-56 lg:w-72">
            <div class="aspect-[9/16] bg-surface-raised rounded-xl flex flex-col gap-2 p-4">
              <div class="w-full h-8 bg-surface-glass rounded-lg" />
              <div class="grid grid-cols-3 gap-1.5 flex-1">
                <div v-for="i in 9" :key="i" class="bg-surface-glass rounded-lg" />
              </div>
              <div
                class="w-full h-12 rounded-xl shrink-0"
                style="background: linear-gradient(135deg, #C9A84C, #A07830)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Scroll chevron -->
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <svg class="w-6 h-6 text-gold-primary opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
    </section>

    <!-- ── Section 2: Three Pillars ────────────────────── -->
    <section data-testid="pillars" class="px-6 py-20 max-w-6xl mx-auto">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">

        <div class="glass-md p-6 flex flex-col gap-3">
          <svg class="w-6 h-6 text-gold-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/>
          </svg>
          <h3 class="font-display text-xl text-text-primary">Always On</h3>
          <p class="text-text-muted text-sm">Works fully offline. Syncs when you're back.</p>
        </div>

        <div class="glass-md p-6 flex flex-col gap-3">
          <svg class="w-6 h-6 text-gold-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802"/>
          </svg>
          <h3 class="font-display text-xl text-text-primary">Speaks Your Language</h3>
          <p class="text-text-muted text-sm">Arabic-first. SYP + USD. Your exchange rate, your way.</p>
        </div>

        <div class="glass-md p-6 flex flex-col gap-3">
          <svg class="w-6 h-6 text-gold-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/>
          </svg>
          <h3 class="font-display text-xl text-text-primary">Any Device You Have</h3>
          <p class="text-text-muted text-sm">Phone, tablet, laptop. Install from a link. No app store.</p>
        </div>

      </div>
    </section>

  </div>
</template>
