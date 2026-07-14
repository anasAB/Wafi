import { computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSettingsStore } from '@/features/settings'
import { openWhatsApp, resolvePhone } from './whatsapp'

type DigestMetrics = {
  revenueUsd: number
  profitUsd: number
  lowStockCount: number
  owedUsd: number
}

const LAST_PROMPTED_DATE_KEY = 'wafi_daily_digest_last_prompt_date'

function localDateStamp(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function notifyIfGranted(text: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification('ملخص اليوم جاهز', { body: text })
  } catch {
    // Notification is best-effort only.
  }
}

async function loadTodayMetrics(shopId: string): Promise<DigestMetrics> {
  const today = localDateStamp()

  const [salesRow, cogsRow, expensesRow, lowStockRow, owedRow] = await Promise.all([
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(total_usd), 0) as total
       FROM sales
       WHERE shop_id = ? AND DATE(created_at, 'localtime') = ?`,
      [shopId, today]
    ),
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0)), 0) as total
       FROM sale_line_items sli
       JOIN sales s ON sli.sale_id = s.id
       WHERE s.shop_id = ? AND DATE(s.created_at, 'localtime') = ?`,
      [shopId, today]
    ),
    db.getOptional<{ total: number }>(
      `SELECT COALESCE(SUM(amount_usd), 0) as total
       FROM expenses
       WHERE shop_id = ? AND expense_date = ?`,
      [shopId, today]
    ),
    db.getOptional<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM products
       WHERE shop_id = ?
         AND is_active = 1
         AND (deleted = 0 OR deleted IS NULL)
         AND current_stock <= low_stock_threshold`,
      [shopId]
    ),
    db.getOptional<{ total: number }>(
      `SELECT
         (
           COALESCE((SELECT SUM(total_usd)  FROM sales            WHERE is_credit = 1 AND shop_id = ?), 0)
         - COALESCE((SELECT SUM(amount_usd) FROM customer_payments                    WHERE shop_id = ?), 0)
         - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r JOIN sales s ON s.id = r.original_sale_id WHERE s.is_credit = 1 AND r.shop_id = ?), 0)
         ) AS total`,
      [shopId, shopId, shopId]
    ),
  ])

  const revenueUsd = Number(salesRow?.total ?? 0)
  const cogsUsd = Number(cogsRow?.total ?? 0)
  const expensesUsd = Number(expensesRow?.total ?? 0)
  const profitUsd = revenueUsd - cogsUsd - expensesUsd

  return {
    revenueUsd,
    profitUsd,
    lowStockCount: Number(lowStockRow?.count ?? 0),
    owedUsd: Math.max(0, Number(owedRow?.total ?? 0)),
  }
}

export function useDailyDigest() {
  const device = useDeviceStore()
  const settings = useSettingsStore()

  const isEnabled = computed(() => settings.dailyDigestEnabled)
  const reminderHour = computed(() => settings.dailyDigestHour)
  const ownerPhoneRaw = computed(() => settings.dailyDigestPhone)

  const ownerPhone = computed(() => resolvePhone(ownerPhoneRaw.value, '963'))

  function setEnabled(value: boolean) {
    settings.dailyDigestEnabled = value
  }

  function setReminderHour(value: number) {
    settings.dailyDigestHour = Math.max(0, Math.min(23, Math.trunc(value)))
  }

  function setOwnerPhone(value: string) {
    settings.dailyDigestPhone = value
  }

  function hasPromptedToday(date = new Date()): boolean {
    return localStorage.getItem(LAST_PROMPTED_DATE_KEY) === localDateStamp(date)
  }

  function markPromptedToday(date = new Date()): void {
    localStorage.setItem(LAST_PROMPTED_DATE_KEY, localDateStamp(date))
  }

  function shouldPromptNow(date = new Date()): boolean {
    if (!isEnabled.value) return false
    if (!ownerPhone.value) return false
    if (date.getHours() < reminderHour.value) return false
    if (hasPromptedToday(date)) return false
    return true
  }

  async function buildTodayDigestText(): Promise<string> {
    const m = await loadTodayMetrics(device.shopId)
    return [
      `ملخص اليوم ${new Intl.DateTimeFormat('ar-SY', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date())}`,
      `مبيعات اليوم: ${formatUsd(m.revenueUsd)}`,
      `ربح اليوم: ${formatUsd(m.profitUsd)}`,
      `منخفض المخزون: ${m.lowStockCount}`,
      `يدين لك الزبائن: ${formatUsd(m.owedUsd)}`,
    ].join('\n')
  }

  async function prepareIfReady(date = new Date()): Promise<{ ready: boolean; text?: string }> {
    if (!shouldPromptNow(date)) return { ready: false }
    const text = await buildTodayDigestText()
    markPromptedToday(date)
    notifyIfGranted(text)
    return { ready: true, text }
  }

  async function openPreparedDigest(text?: string): Promise<boolean> {
    if (!ownerPhone.value) return false
    const payload = text ?? await buildTodayDigestText()
    openWhatsApp(ownerPhone.value, payload)
    return true
  }

  return {
    isEnabled,
    ownerPhoneRaw,
    ownerPhone,
    reminderHour,
    setEnabled,
    setOwnerPhone,
    setReminderHour,
    shouldPromptNow,
    buildTodayDigestText,
    prepareIfReady,
    openPreparedDigest,
  }
}
