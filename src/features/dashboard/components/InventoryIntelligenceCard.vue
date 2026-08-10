<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IntelligenceCard from './IntelligenceCard.vue'
import { useInventoryIntelligence } from '../composables/useInventoryIntelligence'

const { t } = useI18n()
const router = useRouter()
const { data, state, load } = useInventoryIntelligence()
const expanded = ref(false)

async function reload() { await load() }
defineExpose({ reload })
onMounted(reload)

const headline = computed(() =>
  data.value ? t('dashboard2.inventory.headline', { amount: data.value.totalFrozenCapitalUsd.toFixed(0) }) : ''
)
const supporting = computed(() =>
  data.value ? t('dashboard2.inventory.supporting', { count: data.value.productCount }) : ''
)
</script>

<template>
  <IntelligenceCard :state="state" :expanded="expanded" @toggle="expanded = !expanded" @retry="reload">
    <template #headline>
      <div>{{ headline }}</div>
      <div class="inv-supporting">{{ supporting }}</div>
    </template>

    <ul v-if="data" class="inv-offenders">
      <li v-for="row in data.topOffenders" :key="row.productId" class="inv-offender-row">
        <span>{{ row.nameAr }}</span>
        <span dir="ltr">${{ row.valueUsd.toFixed(0) }}</span>
      </li>
      <li>
        <button type="button" class="inv-action-link" @click="router.push('/reports?tab=deadStock')">
          {{ t('dashboard2.inventory.viewDeadStock') }}
        </button>
      </li>
    </ul>
  </IntelligenceCard>
</template>

<style scoped>
.inv-supporting { font-size: 11px; color: #637285; margin-top: 2px; }
.inv-offenders { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.inv-offender-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #C8D5E8; }
.inv-action-link { border: none; background: transparent; color: #60A5FA; font-size: 12px; cursor: pointer; padding: 0; }
</style>
