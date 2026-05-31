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

    <!-- ── Section 3: Product Story ───────────────────── -->
    <section data-testid="product-story" class="px-6 py-10 max-w-6xl mx-auto space-y-24">

      <div class="flex flex-col lg:flex-row items-center gap-12">
        <div class="flex-1 glass-md p-6 aspect-video flex items-center justify-center min-h-[200px]">
          <span class="text-text-muted text-sm">POS Screen</span>
        </div>
        <div class="flex-1">
          <span class="text-gold-primary text-xs font-medium tracking-widest uppercase mb-3 block">Point of Sale</span>
          <h2 class="font-display text-3xl lg:text-4xl text-text-primary mb-4 leading-tight">Ring up a sale in under 10 seconds.</h2>
          <p class="text-text-muted">Barcode scan, product tap, or search. Every second counts behind the counter.</p>
        </div>
      </div>

      <div class="flex flex-col lg:flex-row-reverse items-center gap-12">
        <div class="flex-1 glass-md p-6 aspect-video flex items-center justify-center min-h-[200px]">
          <span class="text-text-muted text-sm">Dashboard</span>
        </div>
        <div class="flex-1">
          <span class="text-gold-primary text-xs font-medium tracking-widest uppercase mb-3 block">Dashboard</span>
          <h2 class="font-display text-3xl lg:text-4xl text-text-primary mb-4 leading-tight">Know your numbers before you open the door.</h2>
          <p class="text-text-muted">Revenue today, profit this month, low stock alerts — all at a glance before the first customer walks in.</p>
        </div>
      </div>

      <div class="flex flex-col lg:flex-row items-center gap-12">
        <div class="flex-1 glass-md p-6 aspect-video flex items-center justify-center min-h-[200px]">
          <span class="text-text-muted text-sm">Sale History</span>
        </div>
        <div class="flex-1">
          <span class="text-gold-primary text-xs font-medium tracking-widest uppercase mb-3 block">History & Credit</span>
          <h2 class="font-display text-3xl lg:text-4xl text-text-primary mb-4 leading-tight">Your customers trust you. The numbers prove it.</h2>
          <p class="text-text-muted">Every sale logged. Every credit tracked. Send statements over WhatsApp in one tap.</p>
        </div>
      </div>

    </section>

    <!-- ── Section 4: Brand Values ─────────────────────── -->
    <section data-testid="brand-values" class="px-6 py-24 text-center relative overflow-hidden">
      <div
        class="absolute inset-0 pointer-events-none"
        style="background: radial-gradient(ellipse 80% 60% at 50% 50%, rgb(201 168 76 / 0.06) 0%, transparent 70%)"
      />
      <div class="relative z-10 max-w-3xl mx-auto">
        <h2 class="font-display text-4xl lg:text-6xl text-text-primary mb-8 leading-tight">
          Built for the Syrian merchant.<br>
          <span class="text-gold-primary">Engineered for the world.</span>
        </h2>
        <div class="flex flex-col items-center gap-4">
          <p class="text-text-muted">Offline when the power cuts. Online when it returns.</p>
          <div class="w-px h-5 bg-border-gold" />
          <p class="text-text-muted">Your currency, your language, your rules.</p>
          <div class="w-px h-5 bg-border-gold" />
          <p class="text-text-muted">No setup maze. No salesperson required.</p>
        </div>
      </div>
    </section>

    <!-- ── Section 5: By the Numbers ──────────────────── -->
    <section data-testid="stats" class="px-6 py-16 max-w-4xl mx-auto">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-px bg-border-glass rounded-2xl overflow-hidden">
        <div v-for="stat in stats" :key="stat.label" class="bg-bg-void px-6 py-8 text-center">
          <p class="font-display text-4xl text-platinum mb-2">{{ stat.value }}</p>
          <p class="text-text-muted text-sm">{{ stat.label }}</p>
        </div>
      </div>
    </section>

    <!-- ── Section 6: Founding CTA ─────────────────────── -->
    <section data-testid="founding-cta" class="px-6 py-20 max-w-2xl mx-auto text-center">
      <div
        class="glass-lg p-10 relative overflow-hidden"
        style="border: 1px solid rgb(201 168 76 / 0.4)"
      >
        <h2 class="font-display text-4xl text-text-primary mb-4">Join the founding circle.</h2>
        <p class="text-text-muted mb-8 max-w-md mx-auto">
          First 15 merchants get 50% off — permanently. Setup handled personally. Direct line to the founders.
        </p>
        <RouterLink to="/home" class="btn-gold">احجز مكانك / Reserve Your Spot</RouterLink>
        <p class="text-text-muted text-xs mt-4">12 of 15 spots remaining.</p>
      </div>
    </section>

    <!-- ── Section 7: Footer ──────────────────────────── -->
    <footer data-testid="footer" class="px-6 py-12" style="border-top: 1px solid rgb(201 168 76 / 0.30)">
      <div class="max-w-6xl mx-auto flex flex-col md:flex-row justify-between gap-8 mb-8">
        <div>
          <p class="font-display text-xl text-text-primary mb-1">وافي</p>
          <p class="text-text-muted text-sm">نظام إدارة أعمال متكامل</p>
        </div>
        <div class="flex flex-col sm:flex-row gap-8 text-sm text-text-muted">
          <div class="flex flex-col gap-2">
            <p class="text-platinum font-medium mb-1">Product</p>
            <RouterLink to="/home" class="hover:text-gold-primary transition-colors">Dashboard</RouterLink>
            <RouterLink to="/pos"  class="hover:text-gold-primary transition-colors">Point of Sale</RouterLink>
          </div>
          <div class="flex flex-col gap-2">
            <p class="text-platinum font-medium mb-1">Company</p>
            <span>About</span>
            <span>Contact</span>
          </div>
        </div>
      </div>
      <div
        class="max-w-6xl mx-auto pt-6 flex justify-between items-center"
        style="border-top: 1px solid rgb(255 255 255 / 0.08)"
      >
        <p class="text-text-muted text-xs">© 2026 وافي. All rights reserved.</p>
        <div class="flex gap-3 text-xs text-text-muted">
          <span>USDT</span>
          <span>Wire</span>
          <span>Cash</span>
        </div>
      </div>
    </footer>

  </div>
</template>
