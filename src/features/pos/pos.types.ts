export interface Product {
  id:                 string
  shopId:             string
  nameAr:             string
  nameEn?:            string
  salePriceUsd:       number   // stored as price_usd in DB
  costPriceUsd:       number
  barcode?:           string
  category?:          string
  categoryId?:        string
  subcategoryId?:     string
  photoUrl?:          string
  currentStock:       number
  lowStockThreshold:  number
  isActive:           boolean
  createdAt:          string
  updatedAt:          string
}
