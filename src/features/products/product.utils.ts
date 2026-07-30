import type { Product } from '@/features/pos/pos.types'

export type ProductRow = {
  id: string; shop_id: string; name_ar: string; name_en: string | null
  price_usd: number; cost_price_usd: number; barcode: string | null
  category: string | null; category_id: string | null; subcategory_id: string | null
  current_stock: number; low_stock_threshold: number
  photo_url: string | null; created_at: string; updated_at: string
  cost_updated_at: string | null
  is_active: number; deleted: number; sync_status: string
}

export function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id, shopId: r.shop_id, nameAr: r.name_ar,
    nameEn: r.name_en ?? undefined, salePriceUsd: r.price_usd,
    costPriceUsd: r.cost_price_usd ?? 0, barcode: r.barcode ?? undefined,
    category: r.category ?? undefined,
    categoryId: r.category_id ?? undefined, subcategoryId: r.subcategory_id ?? undefined,
    photoUrl: r.photo_url ?? undefined,
    currentStock: r.current_stock ?? 0, lowStockThreshold: r.low_stock_threshold ?? 5,
    isActive: r.is_active === 1, createdAt: r.created_at, updatedAt: r.updated_at,
    costUpdatedAt: r.cost_updated_at ?? undefined,
  }
}

/**
 * WAFI-013. Shared here (not duplicated inside ProductList.vue and
 * ProductsPage.vue separately) because both files need the same "is this
 * product's cost imprecise" answer — ProductList.vue for its filter/labels,
 * ProductsPage.vue for its chip's count badge. One definition, no drift risk
 * between the two.
 */
export const COST_STALE_AFTER_DAYS = 90

export function isCostMissing(p: Pick<Product, 'costPriceUsd'>): boolean {
  return !p.costPriceUsd || p.costPriceUsd <= 0
}

export function isCostStale(p: Pick<Product, 'costPriceUsd' | 'costUpdatedAt'>): boolean {
  if (isCostMissing(p)) return false  // "missing", not "stale" — never double-flag
  if (!p.costUpdatedAt) return false  // no signal yet — not flagged either way
  const ageDays = (Date.now() - new Date(p.costUpdatedAt).getTime()) / (1000 * 60 * 60 * 24)
  return ageDays > COST_STALE_AFTER_DAYS
}

export function isCostImprecise(p: Pick<Product, 'costPriceUsd' | 'costUpdatedAt'>): boolean {
  return isCostMissing(p) || isCostStale(p)
}
