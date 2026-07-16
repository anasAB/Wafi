import type { Product } from '@/features/pos/pos.types'

export type ProductRow = {
  id: string; shop_id: string; name_ar: string; name_en: string | null
  price_usd: number; cost_price_usd: number; barcode: string | null
  category: string | null; category_id: string | null; subcategory_id: string | null
  current_stock: number; low_stock_threshold: number
  photo_url: string | null; created_at: string; updated_at: string
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
  }
}
