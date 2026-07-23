import { useProducts } from '@/features/products/composables/useProducts'
import { useDeviceStore } from '@/store/device.store'

interface DemoProduct {
  nameAr: string
  salePriceUsd: number
  costPriceUsd: number
  currentStock: number
}

// Generic-retail staples (Year 1 vertical is general retail, not
// electronics-specific — see CLAUDE.md Strategic Locks). Products only;
// no demo customers or sales (WAFI-004 design, "out of scope").
const DEMO_PRODUCTS: DemoProduct[] = [
  { nameAr: 'مياه معدنية ١.٥ لتر', salePriceUsd: 0.50, costPriceUsd: 0.30, currentStock: 50 },
  { nameAr: 'شيبس بطاطا',         salePriceUsd: 1.00, costPriceUsd: 0.60, currentStock: 30 },
  { nameAr: 'صابون استحمام',      salePriceUsd: 1.50, costPriceUsd: 0.90, currentStock: 20 },
  { nameAr: 'شاي علبة ١٠٠ غرام',  salePriceUsd: 2.00, costPriceUsd: 1.20, currentStock: 15 },
  { nameAr: 'سكر كيلو',           salePriceUsd: 1.20, costPriceUsd: 0.80, currentStock: 25 },
]

export function useDemoDataSeed() {
  async function seedDemoProducts(): Promise<void> {
    const { products, load, save } = useProducts()
    const device = useDeviceStore()

    await load()
    if (products.value.length > 0) return  // idempotent: shop already has products

    for (const p of DEMO_PRODUCTS) {
      await save({
        shopId:           device.shopId,
        nameAr:           p.nameAr,
        salePriceUsd:     p.salePriceUsd,
        costPriceUsd:     p.costPriceUsd,
        currentStock:     p.currentStock,
        lowStockThreshold: 5,
        isActive:         true,
        createdVia:       'demo_seed',
      })
    }
  }

  return { seedDemoProducts }
}
