import { db } from '@/data/powersync/db'

export interface OnboardingProgress {
  productsDone: boolean
  posDone: boolean
  teamDone: boolean
  profileDone: boolean
}

export interface OnboardingCardConfig {
  id: 'products' | 'pos' | 'team' | 'profile'
  icon: string
  title: string
  desc: string
  cta: string
  time: string
  primary: boolean
  to: string
}

export const ONBOARDING_CARD_CONFIG: ReadonlyArray<OnboardingCardConfig> = [
  {
    id: 'products',
    icon: '📦',
    title: 'أضف منتجاتك الأولى',
    desc: 'أضف ٥ منتجات وستكون جاهزاً للبيع في دقيقتين. الأسرع طريقاً للمبيعة الأولى.',
    cta: 'ابدأ بإضافة منتج',
    time: '~٣ دقائق',
    primary: true,
    to: '/products/add',
  },
  {
    id: 'pos',
    icon: '🏪',
    title: 'افتح نقطة البيع',
    desc: 'اكتشف شاشة البيع وسجّل أول عملية بيع لتفعيل هذا القسم.',
    cta: 'افتح نقطة البيع',
    time: '~٢ دقائق',
    primary: false,
    to: '/pos',
  },
  {
    id: 'team',
    icon: '👥',
    title: 'أضف موظفيك',
    desc: 'أضف موظفاً واحداً على الأقل وحدد صلاحياته حسب دوره في المحل.',
    cta: 'أضف موظفاً',
    time: '~١ دقيقة',
    primary: false,
    to: '/settings/staff',
  },
  {
    id: 'profile',
    icon: '🏢',
    title: 'أكمل بيانات نشاطك',
    desc: 'أضف اسم المحل أو رقمك الضريبي في إعدادات الفاتورة.',
    cta: 'أكمل البيانات',
    time: '~٢ دقائق',
    primary: false,
    to: '/settings/receipt',
  },
]

function asCount(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function loadOnboardingProgress(shopId: string): Promise<OnboardingProgress> {
  if (!shopId) {
    return {
      productsDone: false,
      posDone: false,
      teamDone: false,
      profileDone: false,
    }
  }

  const [productsRow, salesRow, staffRow, receiptRow] = await Promise.all([
    db.getOptional<{ count: number | string }>(
      `SELECT COUNT(1) AS count
       FROM products
       WHERE shop_id = ? AND COALESCE(deleted, 0) = 0`,
      [shopId],
    ),
    db.getOptional<{ count: number | string }>(
      `SELECT COUNT(1) AS count
       FROM sales
       WHERE shop_id = ?`,
      [shopId],
    ),
    db.getOptional<{ count: number | string }>(
      `SELECT COUNT(1) AS count
       FROM staff
       WHERE shop_id = ?
         AND is_active = 1
         AND role <> 'owner'`,
      [shopId],
    ),
    db.getOptional<{
      shop_name?: string | null
      tax_number?: string | null
      header_text?: string | null
      footer_text?: string | null
    }>(
      `SELECT shop_name, tax_number, header_text, footer_text
       FROM receipt_settings
       WHERE shop_id = ?
       LIMIT 1`,
      [shopId],
    ),
  ])

  const hasReceiptProfile = [
    receiptRow?.shop_name,
    receiptRow?.tax_number,
    receiptRow?.header_text,
    receiptRow?.footer_text,
  ].some((value) => Boolean(value?.trim()))

  return {
    productsDone: asCount(productsRow?.count) > 0,
    posDone: asCount(salesRow?.count) > 0,
    teamDone: asCount(staffRow?.count) > 0,
    profileDone: hasReceiptProfile,
  }
}
