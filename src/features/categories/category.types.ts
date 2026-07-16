export interface Category {
  id:        string
  shopId:    string
  name:      string
  createdAt: string
}

export interface Subcategory {
  id:         string
  categoryId: string
  shopId:     string
  name:       string
  createdAt:  string
}

export interface CategoryWithSubcategories extends Category {
  subcategories: Subcategory[]
}

export type CategoryRow = {
  id: string; shop_id: string; name: string; created_at: string
}

export type SubcategoryRow = {
  id: string; category_id: string; shop_id: string; name: string; created_at: string
}
