<script setup lang="ts">
import { watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import POSSaleScreen from '@/features/pos/POSSaleScreen.vue'
import { useShiftStore } from '@/features/shifts/shift.store'

const router = useRouter()
const shiftStore = useShiftStore()

watchEffect(() => {
	if (shiftStore.isShiftOpen) return
	if (router.currentRoute.value.path !== '/pos') return
	void router.replace('/shifts/history')
})
</script>
<template><POSSaleScreen /></template>
