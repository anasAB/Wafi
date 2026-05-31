import { reactive } from 'vue'

export const store = reactive({
  phone: '',
  countryCode: '+966',
  userName: '',
  businessName: '',
  businessType: '',
  country: 'SA',
  startGoal: '' as 'sell' | 'inventory' | 'explore' | '',
})
