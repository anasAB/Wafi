import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import { useDeviceStore } from '@/store/device.store'

export interface TimezoneOption {
  value: string   // IANA name, the value actually stored/sent
  label: string   // human-readable, e.g. "دمشق — UTC+03:00"
}

// A curated shortlist covering WAFI's actual target markets (CLAUDE.md:
// Syria first, opportunistic signups from Lebanon/Iraq/Jordan/Saudi accepted)
// plus UTC itself as an explicit, legitimate choice -- confirm_shop_timezone()
// accepts any real IANA name server-side, this list is just the UI shortcut.
export const COMMON_TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: 'Asia/Damascus', label: 'دمشق — UTC+03:00' },
  { value: 'Asia/Beirut',   label: 'بيروت — UTC+02:00/+03:00 (توقيت صيفي)' },
  { value: 'Asia/Baghdad',  label: 'بغداد — UTC+03:00' },
  { value: 'Asia/Amman',    label: 'عمّان — UTC+02:00/+03:00 (توقيت صيفي)' },
  { value: 'Asia/Riyadh',   label: 'الرياض — UTC+03:00' },
  { value: 'UTC',           label: 'UTC (توقيت عالمي منسق)' },
]

const COUNTRY_TIMEZONE_DEFAULTS: Record<string, string> = {
  SY: 'Asia/Damascus',
  LB: 'Asia/Beirut',
  IQ: 'Asia/Baghdad',
  JO: 'Asia/Amman',
  SA: 'Asia/Riyadh',
}

export function suggestedTimezoneForCountry(countryCode: string): string {
  return COUNTRY_TIMEZONE_DEFAULTS[countryCode] ?? 'UTC'
}

export type ConfirmTimezoneResult = 'ok' | 'forbidden' | 'invalid_timezone' | 'error'

export function useShopTimezone() {
  const currentTimezone = ref<string | null>(null)
  const isConfirmed = ref(false)
  const loading = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    loading.value = true
    try {
      const device = useDeviceStore()
      const shop = await db.getOptional<{ timezone: string | null; timezone_confirmed_at: string | null }>(
        'SELECT timezone, timezone_confirmed_at FROM shops WHERE id = ?',
        [device.shopId],
      )
      currentTimezone.value = shop?.timezone ?? null
      isConfirmed.value = !!shop?.timezone_confirmed_at
    } finally {
      loading.value = false
    }
  }

  async function confirmTimezone(timezone: string): Promise<ConfirmTimezoneResult> {
    error.value = ''
    const { data, error: rpcError } = await supabase.rpc('confirm_shop_timezone', { p_timezone: timezone })
    if (rpcError) {
      error.value = rpcError.message
      return 'error'
    }
    if (data === 'ok') {
      currentTimezone.value = timezone
      isConfirmed.value = true
    }
    return (data as ConfirmTimezoneResult) ?? 'error'
  }

  return { currentTimezone, isConfirmed, loading, error, load, confirmTimezone }
}
