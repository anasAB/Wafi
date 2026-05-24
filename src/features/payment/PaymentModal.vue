<script setup lang="ts">
import type { CompletedSale } from './payment.types'
defineEmits<{ (e: 'confirmed', sale: CompletedSale): void; (e: 'close'): void }>()
</script>
<template><div /></template>
