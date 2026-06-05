export type ExportDataset = 'sales' | 'expenses' | 'products' | 'customers'
export type ExportFormat  = 'xlsx' | 'csv'

export interface ExportDateRange {
  start: string // 'YYYY-MM-DD'
  end:   string // 'YYYY-MM-DD'
}

export const SALES_HEADERS = [
  'رقم البيع', 'التاريخ', 'المنتج', 'الكمية',
  'سعر الوحدة $', 'سعر الوحدة ل.س', 'إجمالي السطر $',
  'طريقة الدفع', 'الكاشير', 'إجمالي الفاتورة $',
] as const

export const EXPENSES_HEADERS = [
  'التاريخ', 'الفئة', 'الوصف', 'المبلغ $', 'المبلغ ل.س',
] as const

export const PRODUCTS_HEADERS = [
  'الاسم', 'الباركود', 'سعر البيع $', 'سعر البيع ل.س',
  'التكلفة $', 'المخزون الحالي', 'قيمة المخزون $',
] as const

export const CUSTOMERS_HEADERS = [
  'الاسم', 'الهاتف', 'الرصيد المستحق $', 'الرصيد المستحق ل.س', 'آخر شراء',
] as const
