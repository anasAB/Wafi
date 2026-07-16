-- Wafi POS — Product categories & subcategories (الفئات).
--
-- Replaces the free-text products.category string (kept, unused by new code)
-- with a structured, owner-managed category (+ optional subcategory) model.
-- Backfills existing distinct free-text values per shop, case-insensitively,
-- into real category rows; blanks go to a per-shop "غير مصنف" row.
-- See docs/superpowers/specs/2026-07-14-product-categories-design.md.

CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sync_status text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_shop_name_ci
  ON public.categories (shop_id, lower(name));

CREATE TABLE IF NOT EXISTS public.subcategories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  shop_id     uuid NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sync_status text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subcategories_category_name_ci
  ON public.subcategories (category_id, lower(name));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id    uuid REFERENCES public.categories(id),
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.subcategories(id);

-- Backfill step 1: one category row per shop per distinct trimmed, lower-cased
-- existing free-text category value. DISTINCT ON picks a stable representative
-- casing (earliest-created product with that value) as the display name.
INSERT INTO public.categories (id, shop_id, name, created_at)
SELECT gen_random_uuid(), t.shop_id, t.name, now()
FROM (
  SELECT DISTINCT ON (shop_id, lower(trim(category))) shop_id, trim(category) AS name
  FROM public.products
  WHERE category IS NOT NULL AND trim(category) <> ''
  ORDER BY shop_id, lower(trim(category)), created_at
) t
ON CONFLICT DO NOTHING;

-- Backfill step 2: a per-shop "غير مصنف" row for any shop with at least one
-- product that has a blank/null category.
INSERT INTO public.categories (id, shop_id, name, created_at)
SELECT gen_random_uuid(), t.shop_id, 'غير مصنف', now()
FROM (
  SELECT DISTINCT shop_id FROM public.products
  WHERE category IS NULL OR trim(category) = ''
) t
ON CONFLICT DO NOTHING;

-- Backfill step 3: point every product with a non-blank category at its new
-- category_id, matched case-insensitively within the same shop.
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE c.shop_id = p.shop_id
  AND p.category IS NOT NULL AND trim(p.category) <> ''
  AND lower(c.name) = lower(trim(p.category))
  AND p.category_id IS NULL;

-- Backfill step 4: point every remaining product (blank/null category) at its
-- shop's "غير مصنف" row.
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE c.shop_id = p.shop_id
  AND c.name = 'غير مصنف'
  AND p.category_id IS NULL;

ALTER TABLE public.categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_select_all ON public.categories;
DROP POLICY IF EXISTS categories_insert_all ON public.categories;
DROP POLICY IF EXISTS categories_update_all ON public.categories;
DROP POLICY IF EXISTS categories_delete_all ON public.categories;
CREATE POLICY categories_select_all ON public.categories
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY categories_insert_all ON public.categories
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY categories_update_all ON public.categories
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY categories_delete_all ON public.categories
  FOR DELETE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));

DROP POLICY IF EXISTS subcategories_select_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_insert_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_update_all ON public.subcategories;
DROP POLICY IF EXISTS subcategories_delete_all ON public.subcategories;
CREATE POLICY subcategories_select_all ON public.subcategories
  FOR SELECT TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));
CREATE POLICY subcategories_insert_all ON public.subcategories
  FOR INSERT TO anon, authenticated
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY subcategories_update_all ON public.subcategories
  FOR UPDATE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()))
  WITH CHECK (shop_id = (select public.auth_shop_id()));
CREATE POLICY subcategories_delete_all ON public.subcategories
  FOR DELETE TO anon, authenticated
  USING (shop_id = (select public.auth_shop_id()));

DO $$
DECLARE
  pub_name text;
  tbl text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      FOREACH tbl IN ARRAY ARRAY['categories', 'subcategories']
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_publication_tables
          WHERE pubname = pub_name AND schemaname = 'public' AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.%I', pub_name, tbl);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
