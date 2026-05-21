-- Wafi POS — Stub Seed Data for Epic 1 Development
-- Apply migration first, then seed: paste 001_initial_schema.sql into Supabase SQL Editor, then paste seed.sql.
-- shop_id and device_id match VITE_STUB_SHOP_ID / VITE_STUB_DEVICE_ID in .env.local.example.

INSERT INTO shops (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'محل الأخ — تجريبي')
ON CONFLICT (id) DO NOTHING;

INSERT INTO devices (id, shop_id, device_code) VALUES
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO exchange_rates (id, shop_id, device_id, rate, set_at) VALUES
  (gen_random_uuid(),
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   14500, now())
ON CONFLICT DO NOTHING;

INSERT INTO products (id, shop_id, name_ar, name_en, price_usd, barcode) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'هاتف سامسونج A15',     'Samsung A15',      150.00, '1234567890'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'سماعة بلوتوث',          'Bluetooth Earbuds', 25.00, '2345678901'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'شاحن سريع 65 واط',      '65W Fast Charger',  12.00, '3456789012'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'كفر هاتف سيليكون',      'Silicone Case',      3.50, '4567890123'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'ذاكرة فلاش 64 جيجا',    'USB Flash 64GB',    10.00, NULL),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'كابل شحن USB-C',        'USB-C Cable',        2.00, NULL)
ON CONFLICT DO NOTHING;
