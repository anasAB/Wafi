export interface Product {
  id:        string
  shopId:    string
  nameAr:    string
  nameEn?:   string
  priceUsd:  number
  barcode?:  string
  photoUrl?: string
  isActive:  boolean
}
