-- Generated mock data seed. Idempotent per-run via a fixed marker check below.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE shop_id = '00000000-0000-0000-0000-000000000001' AND created_via = 'mock_data_seed') THEN
    RAISE EXCEPTION 'Mock data already seeded for shop %. Delete existing created_via=% rows first if you want to reseed.', '00000000-0000-0000-0000-000000000001', 'mock_data_seed';
  END IF;
END $$;

-- Products
INSERT INTO products (id, shop_id, name_ar, name_en, price_usd, cost_price_usd, barcode, category, current_stock, low_stock_threshold, created_via, cost_updated_at) VALUES
  ('fa71f562-764d-4c6b-b7df-6677d4d781f3', '00000000-0000-0000-0000-000000000001', 'أريكة كيفيك 3 مقاعد', 'KIVIK 3-seat sofa', 799.00, 479.40, '2026073000001', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('05a69988-8b89-401f-8c34-b8f22ce744a6', '00000000-0000-0000-0000-000000000001', 'أريكة كيفيك زاوية', 'KIVIK corner sofa', 1099.00, 659.40, '2026073000002', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('58011db5-6c8c-413b-8081-e28777f4b774', '00000000-0000-0000-0000-000000000001', 'أريكة إكتورب 2 مقعد', 'EKTORP 2-seat sofa', 549.00, 318.42, '2026073000003', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('8df1ee7d-db40-4b8f-82e5-92b0dd8ad2a4', '00000000-0000-0000-0000-000000000001', 'كرسي بوانغ', 'POÄNG armchair', 129.00, 70.95, '2026073000004', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('58184ca5-c07c-4916-b0de-5d94e69e6441', '00000000-0000-0000-0000-000000000001', 'كرسي بوانغ مع مسند أرجل', 'POÄNG armchair + footstool', 189.00, 103.95, '2026073000005', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('747378d6-b0c6-4f4d-911d-c3b40cbe5beb', '00000000-0000-0000-0000-000000000001', 'أريكة كليبان مقعدين', 'KLIPPAN 2-seat sofa', 379.00, 219.82, '2026073000006', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('c2d8d72f-e62a-405e-bc75-e9bfdc6d67fc', '00000000-0000-0000-0000-000000000001', 'أريكة فيمله 3 مقاعد', 'VIMLE 3-seat sofa', 899.00, 539.40, '2026073000007', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('3522a964-5f2d-418d-9215-276eaae96761', '00000000-0000-0000-0000-000000000001', 'أريكة فارلوف', 'FÄRLÖV 3-seat sofa', 749.00, 449.40, '2026073000008', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('c7bd2203-d674-4727-aa7e-b72c9bce8243', '00000000-0000-0000-0000-000000000001', 'أريكة ستوكسند', 'STOCKSUND 3-seat sofa', 899.00, 557.38, '2026073000009', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('2746e7c7-de7b-4137-97c5-535e82e69027', '00000000-0000-0000-0000-000000000001', 'أريكة سودرهامن زاوية', 'SÖDERHAMN corner sofa', 1299.00, 779.40, '2026073000010', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('bde67db9-6f6a-46bc-8911-074e75bdcfd4', '00000000-0000-0000-0000-000000000001', 'أريكة لاندسكرونا جلد', 'LANDSKRONA leather sofa', 1499.00, 944.37, '2026073000011', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('a4d2944e-3dae-4808-814f-c8bb0ceea5c7', '00000000-0000-0000-0000-000000000001', 'كرسي هافباك', 'HAVBÄCK armchair', 249.00, 136.95, '2026073000012', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('8b6c1cae-8000-4fa8-b0f7-81b6f4ef6ae6', '00000000-0000-0000-0000-000000000001', 'أريكة أبلاريد', 'ÄPPLARYD 2-seat sofa', 649.00, 376.42, '2026073000013', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('f09bc783-177f-4770-b453-0e85faae269f', '00000000-0000-0000-0000-000000000001', 'أريكة سرير باروب', 'PÄRUP sofa bed', 599.00, 359.40, '2026073000014', 'أرائك وكراسي بذراعين', 0, 5, 'mock_data_seed', now()),
  ('0343fdad-5fb4-4c08-add6-bb2deb6644ee', '00000000-0000-0000-0000-000000000001', 'رف كاياكس 4x4', 'KALLAX shelf 4x4', 179.00, 98.45, '2026073000015', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('3180efcb-15b4-4b1b-abaf-dd6899ccdc41', '00000000-0000-0000-0000-000000000001', 'رف كاياكس 2x2', 'KALLAX shelf 2x2', 59.00, 29.50, '2026073000016', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('a230d92e-97a6-4a57-8cda-e041f8ab0f48', '00000000-0000-0000-0000-000000000001', 'رف كاياكس 2x4', 'KALLAX shelf 2x4', 99.00, 49.50, '2026073000017', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('f8ed625c-eda9-49d5-a891-9252e6367b11', '00000000-0000-0000-0000-000000000001', 'مكتبة بيلي', 'BILLY bookcase', 89.00, 44.50, '2026073000018', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('a5ea5c54-aac4-4c64-a1d2-e838a7e20d53', '00000000-0000-0000-0000-000000000001', 'مكتبة بيلي عالية', 'BILLY tall bookcase', 129.00, 64.50, '2026073000019', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('cb201ce4-3eb6-4e42-a778-e78d2a29256f', '00000000-0000-0000-0000-000000000001', 'خزانة ملابس باكس', 'PAX wardrobe frame', 279.00, 153.45, '2026073000020', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('a3c5205a-def9-4613-a524-83a78a3235b5', '00000000-0000-0000-0000-000000000001', 'باب خزانة باكس', 'PAX wardrobe door', 89.00, 44.50, '2026073000021', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('48683cd8-750b-4f78-8d95-7e92a23c2128', '00000000-0000-0000-0000-000000000001', 'رف إيفار', 'IVAR shelving unit', 119.00, 59.50, '2026073000022', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('a2785a7f-60db-4a60-ac35-1e04233e5b58', '00000000-0000-0000-0000-000000000001', 'وحدة تخزين بيستو', 'BESTÅ storage combination', 349.00, 202.42, '2026073000023', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('8ce80bd5-3285-4368-bd94-7c75529bde20', '00000000-0000-0000-0000-000000000001', 'صناديق تروفاست', 'TROFAST storage combination', 79.00, 39.50, '2026073000024', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('d9e75d8f-7444-4119-9323-5a728e5131f2', '00000000-0000-0000-0000-000000000001', 'صناديق تخزين سكوب', 'SKUBB storage boxes (set)', 15.00, 6.75, '2026073000025', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('7c902082-5628-4f34-86ae-830d898eb523', '00000000-0000-0000-0000-000000000001', 'نظام تخزين ألجوت', 'ALGOT storage system', 149.00, 74.50, '2026073000026', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('123c53db-83d1-41e6-ab9e-0287956b9d48', '00000000-0000-0000-0000-000000000001', 'خزانة أدراج هيمنس 6', 'HEMNES 6-drawer chest', 279.00, 153.45, '2026073000027', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('d3b58db3-ee81-4d43-b1bf-7d9a29f45d93', '00000000-0000-0000-0000-000000000001', 'عربة راسكوغ', 'RÅSKOG utility cart', 39.00, 19.50, '2026073000028', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('ccc1bd4c-4aa8-481d-b3f9-a5ebb0505fa6', '00000000-0000-0000-0000-000000000001', 'رف كتب بيلي بزجاج', 'BILLY bookcase w/ glass doors', 199.00, 109.45, '2026073000029', 'تخزين وتنظيم', 0, 5, 'mock_data_seed', now()),
  ('6987785f-c430-41db-a6a1-cbe9dab9fd03', '00000000-0000-0000-0000-000000000001', 'سرير مالم 160×200', 'MALM bed frame 160x200', 299.00, 173.42, '2026073000030', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('0ed5c3b2-5244-447b-a510-4c63babb6431', '00000000-0000-0000-0000-000000000001', 'خزانة أدراج مالم 6', 'MALM 6-drawer chest', 249.00, 136.95, '2026073000031', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('0b1c5756-2843-4f21-839a-21d3b4517313', '00000000-0000-0000-0000-000000000001', 'طاولة جانبية مالم', 'MALM nightstand', 79.00, 39.50, '2026073000032', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('f1cdcab1-2a03-4ef0-8b96-d10ac9f8b053', '00000000-0000-0000-0000-000000000001', 'سرير هيمنس خشب', 'HEMNES bed frame (wood)', 349.00, 202.42, '2026073000033', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('86d57308-bb5f-4449-8ffc-b16bdb9ed886', '00000000-0000-0000-0000-000000000001', 'خزانة أدراج هيمنس 3', 'HEMNES 3-drawer chest', 199.00, 109.45, '2026073000034', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('531b622a-fe7b-4de8-984e-692b26a37943', '00000000-0000-0000-0000-000000000001', 'سرير برينس تخزين', 'BRIMNES bed frame w/ storage', 329.00, 190.82, '2026073000035', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('c83f8321-98c1-464a-8387-b48b95104bd4', '00000000-0000-0000-0000-000000000001', 'سرير سونجساند', 'SONGESAND bed frame', 279.00, 153.45, '2026073000036', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('7464a992-36de-40d2-b84d-ba94f01e2223', '00000000-0000-0000-0000-000000000001', 'سرير نوردلي', 'NORDLI bed frame w/ storage', 449.00, 269.40, '2026073000037', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('7f67bda4-e01a-40bb-859b-78d4d9ef027e', '00000000-0000-0000-0000-000000000001', 'مرتبة غورسكن', 'GURSKEN mattress', 249.00, 136.95, '2026073000038', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('5fd919e1-d961-4721-a7f1-48de25cea327', '00000000-0000-0000-0000-000000000001', 'مرتبة فيستمار', 'VESTMARKA mattress', 179.00, 89.50, '2026073000039', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('f36477b7-4a5b-44a6-8073-d98d5eb72bc1', '00000000-0000-0000-0000-000000000001', 'إطار سرير لوريو', 'LURÖY slatted bed base', 39.00, 19.50, '2026073000040', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('927fd9e4-03f1-4f1f-84e1-d825ad436219', '00000000-0000-0000-0000-000000000001', 'طاولة زينة برينس', 'BRIMNES dressing table', 149.00, 81.95, '2026073000041', 'غرفة النوم', 0, 5, 'mock_data_seed', now()),
  ('6c0b463e-df54-41ed-855d-9d74dca1aa21', '00000000-0000-0000-0000-000000000001', 'واجهة خزانة متود', 'METOD kitchen cabinet front', 45.00, 22.50, '2026073000042', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('e4960805-c213-4d75-9bbe-90cb09697c94', '00000000-0000-0000-0000-000000000001', 'طقم أواني آيكيا 365+', 'IKEA 365+ cookware set', 89.00, 48.95, '2026073000043', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('722c03d0-8e66-4a1f-af05-f8f101dbe622', '00000000-0000-0000-0000-000000000001', 'رف تخزين فورهويا', 'FÖRHÖJA kitchen cart', 129.00, 64.50, '2026073000044', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('c01bf931-f516-4a93-bd42-b149c47d0640', '00000000-0000-0000-0000-000000000001', 'علب تخزين فارييرا', 'VARIERA storage containers (set)', 12.00, 5.40, '2026073000045', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('088b04ce-19ca-490f-a9e7-06eb771bf0e8', '00000000-0000-0000-0000-000000000001', 'رف تجفيف هولبار', 'HÅLLBAR dish rack', 25.00, 11.25, '2026073000046', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('972aeef2-2db0-47ec-9c4e-90fcf42beb0e', '00000000-0000-0000-0000-000000000001', 'مطبخ كنوكسهولت صغير', 'KNOXHULT compact kitchen unit', 349.00, 202.42, '2026073000047', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('2bdcf471-04bb-43f6-b541-d91321b11996', '00000000-0000-0000-0000-000000000001', 'طقم أدوات مائدة فارداغن', 'VARDAGEN cutlery set (24pc)', 29.00, 14.50, '2026073000048', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('6cf71584-0547-4a6b-b07f-858dc7852aa6', '00000000-0000-0000-0000-000000000001', 'طقم أطباق آيكيا 365+', 'IKEA 365+ dinnerware set (18pc)', 59.00, 29.50, '2026073000049', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('67b88ef5-0f4e-4b09-bb5d-eb25f08dae52', '00000000-0000-0000-0000-000000000001', 'خلاط يدوي', 'IKEA 365+ hand blender', 35.00, 17.50, '2026073000050', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('7d36c2be-73f9-4ccd-8cd6-f9d60877fe3e', '00000000-0000-0000-0000-000000000001', 'غلاية كهربائية', 'IKEA 365+ electric kettle', 25.00, 12.50, '2026073000051', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('856a2da5-6d20-45b3-9286-6a0d562d21e3', '00000000-0000-0000-0000-000000000001', 'محمصة خبز', 'IKEA 365+ toaster', 29.00, 14.50, '2026073000052', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('60126ab3-bafc-4591-8823-1ca5ebbc0542', '00000000-0000-0000-0000-000000000001', 'طقم سكاكين', 'IKEA 365+ knife set (5pc)', 39.00, 19.50, '2026073000053', 'المطبخ والأجهزة', 0, 5, 'mock_data_seed', now()),
  ('67f440db-6054-4268-8d0b-a37ba59f00ac', '00000000-0000-0000-0000-000000000001', 'مصباح أرضي رانارب', 'RANARP floor lamp', 79.00, 39.50, '2026073000054', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('f26a6f59-c328-42a4-91ce-e1a022edbc3c', '00000000-0000-0000-0000-000000000001', 'مصباح طاولة فادو', 'FADO table lamp', 15.00, 6.75, '2026073000055', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('23f66263-75bf-4693-9b4e-4e0f9d56eb4a', '00000000-0000-0000-0000-000000000001', 'مصباح أرضي هكتار', 'HEKTAR floor lamp', 69.00, 34.50, '2026073000056', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('8737c765-bdd5-4a08-9cec-e121f6804015', '00000000-0000-0000-0000-000000000001', 'مصباح سقف نوت', 'NOT ceiling lamp shade', 12.00, 5.40, '2026073000057', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('1004a4ac-03df-4224-a009-468c8b8cc811', '00000000-0000-0000-0000-000000000001', 'مصباح جداري ليرستا', 'LERSTA wall lamp', 25.00, 11.25, '2026073000058', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('8f371217-8928-4593-8800-9a798e985a88', '00000000-0000-0000-0000-000000000001', 'مصباح طاولة سولكلينت', 'SOLKLINT table lamp', 19.00, 8.55, '2026073000059', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('b6d7fe85-1228-49fc-a0f3-cf7e0003b7fe', '00000000-0000-0000-0000-000000000001', 'لمبة LED ذكية', 'TRÅDFRI smart LED bulb', 12.00, 4.80, '2026073000060', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('7887f4f1-cb40-49ed-b95f-472af4b13eba', '00000000-0000-0000-0000-000000000001', 'شريط إضاءة LED', 'LEDBERG LED light strip', 18.00, 8.10, '2026073000061', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('86144ca3-77fc-4446-be75-4de73778ea6c', '00000000-0000-0000-0000-000000000001', 'مصباح مكتب فورساو', 'FORSÅ work lamp', 22.00, 9.90, '2026073000062', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('05190aa9-7535-4225-9761-dff7861243c9', '00000000-0000-0000-0000-000000000001', 'ثريا سقف رامسته', 'RAMSTA pendant lamp', 45.00, 22.50, '2026073000063', 'الإضاءة', 0, 5, 'mock_data_seed', now()),
  ('f714c9da-9e23-4094-9e05-773be6a4f756', '00000000-0000-0000-0000-000000000001', 'سجادة ستوكهولم', 'STOCKHOLM rug, flatwoven', 249.00, 136.95, '2026073000064', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('2e972542-cde7-4200-a893-9e6889b00da1', '00000000-0000-0000-0000-000000000001', 'سجادة فينتر', 'VINTER rug, high-pile', 89.00, 44.50, '2026073000065', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('98527b1a-f431-43e6-97ec-94b6b08d00e6', '00000000-0000-0000-0000-000000000001', 'سجادة سكوغسكلوفر', 'SKOGSKLÖVER rug, low-pile', 129.00, 64.50, '2026073000066', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('13b86023-bb72-4839-964f-2acac8a967d8', '00000000-0000-0000-0000-000000000001', 'سجادة ألفينه', 'ALVINE RUTA rug, flatwoven', 149.00, 74.50, '2026073000067', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('91942e75-d396-41b4-8d77-4da5cd79b039', '00000000-0000-0000-0000-000000000001', 'سجادة غولفد', 'GULVED rug, flatwoven', 59.00, 26.55, '2026073000068', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('272c771b-2a13-4031-8b79-948c8278fb0b', '00000000-0000-0000-0000-000000000001', 'سجادة لابليونغ روتا', 'LAPPLJUNG RUTA rug, high-pile', 79.00, 39.50, '2026073000069', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('3ee76a6f-68ef-4860-886b-e9e26cd3ebfd', '00000000-0000-0000-0000-000000000001', 'ستارة مالينا', 'MERETE curtains (1 pair)', 35.00, 17.50, '2026073000070', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('2269534b-a724-4b2c-ad3f-d18dc7c5c312', '00000000-0000-0000-0000-000000000001', 'غطاء وسادة سنويرت', 'SANELA cushion cover', 15.00, 6.75, '2026073000071', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('eb7d4281-edb7-45fd-bced-862f70a6f2b0', '00000000-0000-0000-0000-000000000001', 'بطانية إينغيلا', 'INGABRITTA throw blanket', 25.00, 11.25, '2026073000072', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('10dac64e-6791-4d41-ad71-b5d95dc09e07', '00000000-0000-0000-0000-000000000001', 'غطاء لحاف روديل', 'RÖDLILJA duvet cover set', 45.00, 22.50, '2026073000073', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('d3fb7422-a608-442a-8cb3-f3196d1d375a', '00000000-0000-0000-0000-000000000001', 'مفرش مائدة قطن', 'MITTBIT tablecloth', 19.00, 8.55, '2026073000074', 'السجاد والمنسوجات', 0, 5, 'mock_data_seed', now()),
  ('115c8fd2-3c35-45ea-a5c4-056ac973a54a', '00000000-0000-0000-0000-000000000001', 'طاولة رسم فليسات', 'FLISAT children''s desk', 89.00, 44.50, '2026073000075', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('15c91ba6-599e-4d5a-bc3c-fd5151827fa7', '00000000-0000-0000-0000-000000000001', 'سرير مامّوت أطفال', 'MAMMUT kids bed frame', 99.00, 49.50, '2026073000076', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('d389187a-9253-447e-8a5c-77d81ad33f52', '00000000-0000-0000-0000-000000000001', 'صندوق تروفاست أطفال', 'TROFAST kids storage combo', 89.00, 44.50, '2026073000077', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('5aad657c-df91-4953-9615-5a4b46d1c7ec', '00000000-0000-0000-0000-000000000001', 'كرسي كريتر أطفال', 'KRITTER children''s chair', 19.00, 8.55, '2026073000078', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('c73e655d-b2d2-4cb9-b568-a36925f2eb76', '00000000-0000-0000-0000-000000000001', 'سرير سوندفيك أطفال', 'SUNDVIK toddler bed', 129.00, 64.50, '2026073000079', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('10fa1c04-d83f-4cd0-bd6c-6a18d5297c5c', '00000000-0000-0000-0000-000000000001', 'مطبخ ألعاب دوكتيغ', 'DUKTIG play kitchen', 149.00, 74.50, '2026073000080', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('f9e1666a-96f0-4da4-80a2-6c2b4a4bba46', '00000000-0000-0000-0000-000000000001', 'أدوات ألعاب دوكتيغ', 'DUKTIG play food set', 15.00, 6.00, '2026073000081', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('aed28dfd-abc0-4950-af45-79c468bec90f', '00000000-0000-0000-0000-000000000001', 'وحدة تخزين سموستاد', 'SMÅSTAD storage combination', 249.00, 136.95, '2026073000082', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('07eed84d-81da-4d08-aa90-9dd5a4850523', '00000000-0000-0000-0000-000000000001', 'دمية دجونغلسكوغ', 'DJUNGELSKOG soft toy', 12.00, 4.80, '2026073000083', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('7e302d36-0b0f-4c2b-a034-390940c00a88', '00000000-0000-0000-0000-000000000001', 'كرسي مرتفع أنتيلوب', 'ANTILOP high chair', 25.00, 11.25, '2026073000084', 'أطفال', 0, 5, 'mock_data_seed', now()),
  ('9de9d800-f43e-4d6a-9c38-c5f66fa989b2', '00000000-0000-0000-0000-000000000001', 'طاولة خارجية أبلارو', 'ÄPPLARÖ outdoor table', 179.00, 98.45, '2026073000085', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('910988b3-7114-4cca-bfd6-3d39c5d234ef', '00000000-0000-0000-0000-000000000001', 'كرسي خارجي أبلارو', 'ÄPPLARÖ outdoor chair', 89.00, 44.50, '2026073000086', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('c1140f09-0a67-4777-bdac-8aa8f75e3fcc', '00000000-0000-0000-0000-000000000001', 'طقم جلوس نمّارو', 'NÄMMARÖ outdoor seating set', 449.00, 260.42, '2026073000087', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('9f7dbb4e-09df-4fd4-bca1-6855a1387fdf', '00000000-0000-0000-0000-000000000001', 'أرجوحة سيغرون', 'SEGERÖN hanging chair', 149.00, 74.50, '2026073000088', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('4a3ef44a-a60e-42ae-8b10-f67585000e43', '00000000-0000-0000-0000-000000000001', 'طاولة فيسمان خارجية', 'VÄSMAN outdoor side table', 59.00, 29.50, '2026073000089', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('4124fc2b-092e-419e-9190-8032562255e8', '00000000-0000-0000-0000-000000000001', 'وسائد كودارنا خارجية', 'KUDDARNA outdoor cushions (set)', 25.00, 11.25, '2026073000090', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('8ab74696-7cd2-43ce-a3a2-00f3c4062c95', '00000000-0000-0000-0000-000000000001', 'مظلة خارجية', 'SAMSÖ patio umbrella', 89.00, 44.50, '2026073000091', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('be3d504e-8bec-415c-90e2-3e8980e74780', '00000000-0000-0000-0000-000000000001', 'أصيص نباتات خارجي', 'HYLLIS outdoor planter', 15.00, 6.00, '2026073000092', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('5389bbc8-abdc-4c09-be77-441a461896fd', '00000000-0000-0000-0000-000000000001', 'طقم شواء أدوات', 'GRILLTIDER BBQ tool set', 29.00, 13.05, '2026073000093', 'خارجي وحديقة', 0, 5, 'mock_data_seed', now()),
  ('a7ed95d2-f3bb-4ba4-97ef-cef357771397', '00000000-0000-0000-0000-000000000001', 'نبتة اصطناعية فيكا', 'FEJKA artificial plant', 12.00, 4.80, '2026073000094', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('2d7a0e61-7778-4d5e-add0-278792b04780', '00000000-0000-0000-0000-000000000001', 'رف عرض فيتسيو', 'VITTSJÖ display shelf', 49.00, 24.50, '2026073000095', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('6f8bbcc5-d3c3-493c-a091-1a7402df7665', '00000000-0000-0000-0000-000000000001', 'صندوق تخزين كناغليغ', 'KNAGGLIG storage box', 15.00, 6.00, '2026073000096', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('fba75ab8-0d09-4537-8130-ecc34bea883b', '00000000-0000-0000-0000-000000000001', 'إطار صورة ريبا', 'RIBBA picture frame', 9.00, 3.60, '2026073000097', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('6c34e295-abe2-4fad-9753-97ef2a05e1a8', '00000000-0000-0000-0000-000000000001', 'مرآة حائط', 'MALMA wall mirror', 25.00, 11.25, '2026073000098', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('800028fe-59ee-4d2c-89ca-8d21f93bb8c8', '00000000-0000-0000-0000-000000000001', 'شمعة معطرة', 'SINNLIG scented candle', 6.00, 2.40, '2026073000099', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('1d81f4b3-b2b1-4aa0-99d5-96adb40ad037', '00000000-0000-0000-0000-000000000001', 'شمعدان', 'BLOMSTER candle holder', 8.00, 3.20, '2026073000100', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('5247ff3b-3ec0-49af-910a-0a018eafa924', '00000000-0000-0000-0000-000000000001', 'وعاء زينة', 'GRADVIS decorative bowl', 12.00, 4.80, '2026073000101', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('bf45e1d5-71eb-4942-8d58-2db23c69cdf3', '00000000-0000-0000-0000-000000000001', 'ساعة حائط', 'STURSK wall clock', 19.00, 8.55, '2026073000102', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('08bb07eb-6dc1-4ec4-82b7-68648a5a6986', '00000000-0000-0000-0000-000000000001', 'لوحة جدارية', 'BILD poster art', 15.00, 6.00, '2026073000103', 'ديكور', 0, 5, 'mock_data_seed', now()),
  ('5b7606c5-b28c-4f84-b5c9-37f3b22f3801', '00000000-0000-0000-0000-000000000001', 'أصيص نباتات داخلي', 'NYPON plant pot', 7.00, 2.80, '2026073000104', 'ديكور', 0, 5, 'mock_data_seed', now());

-- Expenses
INSERT INTO expenses (id, shop_id, amount, currency, amount_usd, category, expense_date, notes, paid_in_cash) VALUES
  ('3281fd64-767c-4343-a3a6-1dbf58729301', '00000000-0000-0000-0000-000000000001', 800.00, 'USD', 800.00, 'إيجار', (CURRENT_DATE - INTERVAL '58 days')::date, 'إيجار المحل — شهري', 1),
  ('89b03d19-7eb1-48d3-a2d7-73dc1aaa53a3', '00000000-0000-0000-0000-000000000001', 800.00, 'USD', 800.00, 'إيجار', (CURRENT_DATE - INTERVAL '28 days')::date, 'إيجار المحل — شهري', 1),
  ('268b1e8b-b574-4707-9861-91dd8aecce48', '00000000-0000-0000-0000-000000000001', 65.00, 'USD', 65.00, 'كهرباء', (CURRENT_DATE - INTERVAL '52 days')::date, 'فاتورة كهرباء', 1),
  ('f32e0532-72ed-42f6-8c0a-352277e513fe', '00000000-0000-0000-0000-000000000001', 70.00, 'USD', 70.00, 'كهرباء', (CURRENT_DATE - INTERVAL '22 days')::date, 'فاتورة كهرباء', 1),
  ('d7d41b11-f7a4-4941-b876-3dedce60f710', '00000000-0000-0000-0000-000000000001', 1200.00, 'USD', 1200.00, 'رواتب', (CURRENT_DATE - INTERVAL '50 days')::date, 'رواتب الموظفين — نهاية الشهر', 1),
  ('c2f8b044-e517-42ea-aef6-6c7a7c22414d', '00000000-0000-0000-0000-000000000001', 1200.00, 'USD', 1200.00, 'رواتب', (CURRENT_DATE - INTERVAL '20 days')::date, 'رواتب الموظفين — نهاية الشهر', 1),
  ('ab5d92f5-9e40-4d3a-b841-014f3ae171c5', '00000000-0000-0000-0000-000000000001', 3500.00, 'USD', 3500.00, 'بضاعة', (CURRENT_DATE - INTERVAL '45 days')::date, 'شحنة أثاث من المورد', 1),
  ('9da08cda-44ee-4770-b3b2-25aa64e57ae4', '00000000-0000-0000-0000-000000000001', 2800.00, 'USD', 2800.00, 'بضاعة', (CURRENT_DATE - INTERVAL '15 days')::date, 'شحنة إكسسوارات منزلية', 1),
  ('f8a8342b-92df-4464-ba08-d1a319e25b41', '00000000-0000-0000-0000-000000000001', 120.00, 'USD', 120.00, 'صيانة', (CURRENT_DATE - INTERVAL '40 days')::date, 'صيانة نظام التكييف', 1),
  ('a58585bd-49b6-47f4-8934-a266bced58b0', '00000000-0000-0000-0000-000000000001', 45.00, 'USD', 45.00, 'صيانة', (CURRENT_DATE - INTERVAL '10 days')::date, 'إصلاح باب المحل', 1),
  ('03dbab4a-ca9d-4646-9ca8-7c850c72b7cc', '00000000-0000-0000-0000-000000000001', 60.00, 'USD', 60.00, 'أخرى', (CURRENT_DATE - INTERVAL '35 days')::date, 'مصاريف تسويق — منشورات', 1),
  ('a17ef59d-8c7c-41bf-ac51-c7a3d3aa2cb8', '00000000-0000-0000-0000-000000000001', 90000.00, 'SYP', 6.21, 'أخرى', (CURRENT_DATE - INTERVAL '25 days')::date, 'قرطاسية ومستلزمات مكتبية', 1),
  ('d19e365e-10f5-4ddd-9438-3b411b9d4e7f', '00000000-0000-0000-0000-000000000001', 68.00, 'USD', 68.00, 'كهرباء', (CURRENT_DATE - INTERVAL '8 days')::date, 'فاتورة كهرباء', 1),
  ('2a2f1164-ebd6-4273-8384-6c0a939457e4', '00000000-0000-0000-0000-000000000001', 40.00, 'USD', 40.00, 'أخرى', (CURRENT_DATE - INTERVAL '5 days')::date, 'وجبات موظفين', 1),
  ('36dff3c4-ff27-4230-8bf3-67eaa63106a1', '00000000-0000-0000-0000-000000000001', 200.00, 'USD', 200.00, 'صيانة', (CURRENT_DATE - INTERVAL '3 days')::date, 'صيانة سيارة التوصيل', 1);

-- Customers
INSERT INTO customers (id, shop_id, name, phone, address) VALUES
  ('15738d74-be15-40d0-be70-91a5e0528054', '00000000-0000-0000-0000-000000000001', 'أحمد الحلبي', '+963944112233', 'دمشق - المزة'),
  ('3e4c48b9-67df-447f-abc7-2cd7033b2d01', '00000000-0000-0000-0000-000000000001', 'فاطمة العلي', '+963955223344', 'دمشق - أبو رمانة'),
  ('30602512-19d9-4e88-ae3a-2cba00b0ac3f', '00000000-0000-0000-0000-000000000001', 'محمد الخطيب', '+963933445566', 'حلب - الفرقان'),
  ('5978ab33-8872-44ae-9018-731dbfebd925', '00000000-0000-0000-0000-000000000001', 'رنا يوسف', '+963966778899', 'دمشق - كفرسوسة'),
  ('ec71223a-0317-4d85-bfe5-5f32f046fc58', '00000000-0000-0000-0000-000000000001', 'خالد حمدان', '+963922334455', 'اللاذقية - الشاطئ'),
  ('7066cb56-bf65-42c9-8645-79a221b4b729', '00000000-0000-0000-0000-000000000001', 'ليلى صالح', '+963977889900', 'دمشق - المالكي'),
  ('8107466c-ebce-46cd-ba26-3089100ad41e', '00000000-0000-0000-0000-000000000001', 'يوسف مراد', '+963911223344', 'حمص - الوعر'),
  ('968ecbd1-4ea5-41ef-8889-07dfcd40b303', '00000000-0000-0000-0000-000000000001', 'سارة قاسم', '+963988990011', 'دمشق - دمر'),
  ('7a81a4f6-526d-4f38-824d-1750cc20e0d8', '00000000-0000-0000-0000-000000000001', 'عمر النجار', '+963900112233', 'حلب - الشهباء'),
  ('59b8f972-00ee-433c-bc47-ce35d89e0f2b', '00000000-0000-0000-0000-000000000001', 'هبة درويش', '+963944556677', 'دمشق - قدسيا'),
  ('f08acd82-8858-46f4-98fe-9b9f96c3acd1', '00000000-0000-0000-0000-000000000001', 'طارق العبدالله', '+963955667788', 'اللاذقية - المشروع'),
  ('dbe27dd1-8a19-44b6-92ff-747f155bcb31', '00000000-0000-0000-0000-000000000001', 'ريم شحادة', '+963966889900', 'دمشق - برزة');

-- Suppliers
INSERT INTO suppliers (id, shop_id, name, phone, contact_person, address) VALUES
  ('0ea2695c-fc36-4d6d-8994-a7a75f5ed3e2', '00000000-0000-0000-0000-000000000001', 'شركة إيكيا للتجارة', '+96170123456', 'كريستيان لارسون', 'بيروت - المنطقة الصناعية'),
  ('7062d391-02a2-4e32-9d06-b057af7e6597', '00000000-0000-0000-0000-000000000001', 'دمشق للتجهيزات المنزلية', '+963988112233', 'وائل مصطفى', 'دمشق - عدرا الصناعية'),
  ('0d38bca7-72a8-4c18-bf65-0c05bdab0772', '00000000-0000-0000-0000-000000000001', 'الشرق للأثاث والديكور', '+963955223344', 'نور الدين حسن', 'حلب - الشيخ نجار'),
  ('f0e1b43f-39b9-4858-8322-1f5cdf53a819', '00000000-0000-0000-0000-000000000001', 'مؤسسة النور للإضاءة', '+963933445566', 'باسل رزق', 'دمشق - ركن الدين'),
  ('06ffde9f-edbd-40b1-9ede-359ac55c56c2', '00000000-0000-0000-0000-000000000001', 'الأمانة للمنسوجات', '+963944556677', 'هالة كنعان', 'حمص - الإنشاءات'),
  ('ed637d94-3f9f-4222-b318-df829c6ae70e', '00000000-0000-0000-0000-000000000001', 'شام للاستيراد والتوزيع', '+963966778899', 'سامر قدور', 'دمشق - المنطقة الحرة');

-- Stock receivings
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('cc3eb962-6150-4455-94d3-b4a0991cd642', '00000000-0000-0000-0000-000000000001', '0ea2695c-fc36-4d6d-8994-a7a75f5ed3e2', (now() - INTERVAL '47 days'), 8820.15, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('6a728e48-73b3-4dfc-b7ed-7d2cf3a06b1a', 'cc3eb962-6150-4455-94d3-b4a0991cd642', '00000000-0000-0000-0000-000000000001', 'fa71f562-764d-4c6b-b7df-6677d4d781f3', 8, 479.40, 0),
  ('71b5d366-6f31-48f9-b1c0-e49d40e8eaaf', 'cc3eb962-6150-4455-94d3-b4a0991cd642', '00000000-0000-0000-0000-000000000001', '8df1ee7d-db40-4b8f-82e5-92b0dd8ad2a4', 15, 70.95, 0),
  ('173e0e7d-6282-4031-a1ab-535ddae61de4', 'cc3eb962-6150-4455-94d3-b4a0991cd642', '00000000-0000-0000-0000-000000000001', '58184ca5-c07c-4916-b0de-5d94e69e6441', 6, 103.95, 0),
  ('9fecc5d0-38f4-41a6-8ba6-083e609b69bc', 'cc3eb962-6150-4455-94d3-b4a0991cd642', '00000000-0000-0000-0000-000000000001', '05a69988-8b89-401f-8c34-b8f22ce744a6', 5, 659.40, 0);
UPDATE products SET current_stock = current_stock + 8 WHERE id = 'fa71f562-764d-4c6b-b7df-6677d4d781f3';
UPDATE products SET current_stock = current_stock + 15 WHERE id = '8df1ee7d-db40-4b8f-82e5-92b0dd8ad2a4';
UPDATE products SET current_stock = current_stock + 6 WHERE id = '58184ca5-c07c-4916-b0de-5d94e69e6441';
UPDATE products SET current_stock = current_stock + 5 WHERE id = '05a69988-8b89-401f-8c34-b8f22ce744a6';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('f7683aca-debc-46cd-ab28-20466fd4658d', '00000000-0000-0000-0000-000000000001', '7062d391-02a2-4e32-9d06-b057af7e6597', (now() - INTERVAL '44 days'), 4499.90, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('c66cfaad-0058-4601-8e04-7099601d92d9', 'f7683aca-debc-46cd-ab28-20466fd4658d', '00000000-0000-0000-0000-000000000001', '0343fdad-5fb4-4c08-add6-bb2deb6644ee', 20, 98.45, 0),
  ('c6bcaebe-d031-4658-8094-692cb4bbea1f', 'f7683aca-debc-46cd-ab28-20466fd4658d', '00000000-0000-0000-0000-000000000001', '3180efcb-15b4-4b1b-abaf-dd6899ccdc41', 25, 29.50, 0),
  ('6748da76-5534-48ff-bf24-a6f353e24aa9', 'f7683aca-debc-46cd-ab28-20466fd4658d', '00000000-0000-0000-0000-000000000001', 'f8ed625c-eda9-49d5-a891-9252e6367b11', 15, 44.50, 0),
  ('9284546e-6a3c-45e9-928b-7c9e04ed58c8', 'f7683aca-debc-46cd-ab28-20466fd4658d', '00000000-0000-0000-0000-000000000001', '8ce80bd5-3285-4368-bd94-7c75529bde20', 30, 37.53, 1);
UPDATE products SET current_stock = current_stock + 20 WHERE id = '0343fdad-5fb4-4c08-add6-bb2deb6644ee';
UPDATE products SET current_stock = current_stock + 25 WHERE id = '3180efcb-15b4-4b1b-abaf-dd6899ccdc41';
UPDATE products SET current_stock = current_stock + 15 WHERE id = 'f8ed625c-eda9-49d5-a891-9252e6367b11';
UPDATE products SET current_stock = current_stock + 30, cost_price_usd = 37.53, cost_updated_at = now() WHERE id = '8ce80bd5-3285-4368-bd94-7c75529bde20';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('5b3bf396-dd0f-49d2-8f40-ebf5e53c40ba', '00000000-0000-0000-0000-000000000001', '0d38bca7-72a8-4c18-bf65-0c05bdab0772', (now() - INTERVAL '40 days'), 4330.80, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('d3181909-2e56-4dfd-a7f4-1331ad7a5338', '5b3bf396-dd0f-49d2-8f40-ebf5e53c40ba', '00000000-0000-0000-0000-000000000001', '6987785f-c430-41db-a6a1-cbe9dab9fd03', 10, 173.42, 0),
  ('2ec23568-c7ea-4f0b-9e74-f059423afec9', '5b3bf396-dd0f-49d2-8f40-ebf5e53c40ba', '00000000-0000-0000-0000-000000000001', '0b1c5756-2843-4f21-839a-21d3b4517313', 12, 39.50, 0),
  ('6ffa98f9-b68e-4286-aad8-f500aac81053', '5b3bf396-dd0f-49d2-8f40-ebf5e53c40ba', '00000000-0000-0000-0000-000000000001', 'c83f8321-98c1-464a-8387-b48b95104bd4', 8, 153.45, 0),
  ('04560004-fbab-46af-94bd-1050d9c7d761', '5b3bf396-dd0f-49d2-8f40-ebf5e53c40ba', '00000000-0000-0000-0000-000000000001', '5fd919e1-d961-4721-a7f1-48de25cea327', 10, 89.50, 0);
UPDATE products SET current_stock = current_stock + 10 WHERE id = '6987785f-c430-41db-a6a1-cbe9dab9fd03';
UPDATE products SET current_stock = current_stock + 12 WHERE id = '0b1c5756-2843-4f21-839a-21d3b4517313';
UPDATE products SET current_stock = current_stock + 8 WHERE id = 'c83f8321-98c1-464a-8387-b48b95104bd4';
UPDATE products SET current_stock = current_stock + 10 WHERE id = '5fd919e1-d961-4721-a7f1-48de25cea327';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('9b2417ef-1e1c-4a4e-860e-3da120c202e9', '00000000-0000-0000-0000-000000000001', 'f0e1b43f-39b9-4858-8322-1f5cdf53a819', (now() - INTERVAL '36 days'), 3992.25, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('fef75729-f169-471d-ba10-08e8341a08cf', '9b2417ef-1e1c-4a4e-860e-3da120c202e9', '00000000-0000-0000-0000-000000000001', 'b6d7fe85-1228-49fc-a0f3-cf7e0003b7fe', 20, 4.80, 0),
  ('8dbdb543-6fc5-49bd-bdaf-601c10533701', '9b2417ef-1e1c-4a4e-860e-3da120c202e9', '00000000-0000-0000-0000-000000000001', '7887f4f1-cb40-49ed-b95f-472af4b13eba', 40, 8.10, 0),
  ('d789c583-1cac-40a0-8d6c-0853e4c86a32', '9b2417ef-1e1c-4a4e-860e-3da120c202e9', '00000000-0000-0000-0000-000000000001', '86144ca3-77fc-4446-be75-4de73778ea6c', 15, 9.90, 0),
  ('8d203b99-ad35-43f1-95f2-a340e910c0b9', '9b2417ef-1e1c-4a4e-860e-3da120c202e9', '00000000-0000-0000-0000-000000000001', 'f714c9da-9e23-4094-9e05-773be6a4f756', 25, 136.95, 0);
UPDATE products SET current_stock = current_stock + 20 WHERE id = 'b6d7fe85-1228-49fc-a0f3-cf7e0003b7fe';
UPDATE products SET current_stock = current_stock + 40 WHERE id = '7887f4f1-cb40-49ed-b95f-472af4b13eba';
UPDATE products SET current_stock = current_stock + 15 WHERE id = '86144ca3-77fc-4446-be75-4de73778ea6c';
UPDATE products SET current_stock = current_stock + 25 WHERE id = 'f714c9da-9e23-4094-9e05-773be6a4f756';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('aa7cd8a3-e3b8-415d-aa27-cac327c625d7', '00000000-0000-0000-0000-000000000001', '06ffde9f-edbd-40b1-9ede-359ac55c56c2', (now() - INTERVAL '32 days'), 1449.00, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('22ef0092-e56a-4245-8f98-8cdf6e04f5bf', 'aa7cd8a3-e3b8-415d-aa27-cac327c625d7', '00000000-0000-0000-0000-000000000001', '2269534b-a724-4b2c-ad3f-d18dc7c5c312', 10, 6.75, 0),
  ('84d38ca9-9df9-47e0-a184-d79c72178a8f', 'aa7cd8a3-e3b8-415d-aa27-cac327c625d7', '00000000-0000-0000-0000-000000000001', '10dac64e-6791-4d41-ad71-b5d95dc09e07', 8, 22.50, 0),
  ('d9eca298-bfa5-472a-9c27-03d1a12db1d7', 'aa7cd8a3-e3b8-415d-aa27-cac327c625d7', '00000000-0000-0000-0000-000000000001', '115c8fd2-3c35-45ea-a5c4-056ac973a54a', 12, 44.50, 0),
  ('bd59da40-2510-4086-b963-38ed535f70eb', 'aa7cd8a3-e3b8-415d-aa27-cac327c625d7', '00000000-0000-0000-0000-000000000001', 'd389187a-9253-447e-8a5c-77d81ad33f52', 15, 44.50, 0);
UPDATE products SET current_stock = current_stock + 10 WHERE id = '2269534b-a724-4b2c-ad3f-d18dc7c5c312';
UPDATE products SET current_stock = current_stock + 8 WHERE id = '10dac64e-6791-4d41-ad71-b5d95dc09e07';
UPDATE products SET current_stock = current_stock + 12 WHERE id = '115c8fd2-3c35-45ea-a5c4-056ac973a54a';
UPDATE products SET current_stock = current_stock + 15 WHERE id = 'd389187a-9253-447e-8a5c-77d81ad33f52';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('ebaac479-00c7-4dc2-a979-3c27307b4fe0', '00000000-0000-0000-0000-000000000001', 'ed637d94-3f9f-4222-b318-df829c6ae70e', (now() - INTERVAL '28 days'), 3821.30, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('812f7ed6-94d9-4378-974f-c42fc1fa85a1', 'ebaac479-00c7-4dc2-a979-3c27307b4fe0', '00000000-0000-0000-0000-000000000001', '972aeef2-2db0-47ec-9c4e-90fcf42beb0e', 15, 202.42, 0),
  ('b3402393-902e-47f7-9c5b-94430d4c75f5', 'ebaac479-00c7-4dc2-a979-3c27307b4fe0', '00000000-0000-0000-0000-000000000001', '6cf71584-0547-4a6b-b07f-858dc7852aa6', 10, 29.50, 0),
  ('53b550fd-5579-4ff0-99d3-ae6006de06db', 'ebaac479-00c7-4dc2-a979-3c27307b4fe0', '00000000-0000-0000-0000-000000000001', '7d36c2be-73f9-4ccd-8cd6-f9d60877fe3e', 8, 12.50, 0),
  ('eab98b28-7d0c-434f-91b0-87b5a32fcc38', 'ebaac479-00c7-4dc2-a979-3c27307b4fe0', '00000000-0000-0000-0000-000000000001', '60126ab3-bafc-4591-8823-1ca5ebbc0542', 20, 19.50, 0);
UPDATE products SET current_stock = current_stock + 15 WHERE id = '972aeef2-2db0-47ec-9c4e-90fcf42beb0e';
UPDATE products SET current_stock = current_stock + 10 WHERE id = '6cf71584-0547-4a6b-b07f-858dc7852aa6';
UPDATE products SET current_stock = current_stock + 8 WHERE id = '7d36c2be-73f9-4ccd-8cd6-f9d60877fe3e';
UPDATE products SET current_stock = current_stock + 20 WHERE id = '60126ab3-bafc-4591-8823-1ca5ebbc0542';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('d25ba090-04cc-4215-83ea-b7eae05440b8', '00000000-0000-0000-0000-000000000001', '0ea2695c-fc36-4d6d-8994-a7a75f5ed3e2', (now() - INTERVAL '20 days'), 113.40, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('f247a481-a27f-4324-8b53-016104425b71', 'd25ba090-04cc-4215-83ea-b7eae05440b8', '00000000-0000-0000-0000-000000000001', 'a7ed95d2-f3bb-4ba4-97ef-cef357771397', 6, 5.04, 1),
  ('0c5d5089-82af-4c07-ae75-0c4a675b5d64', 'd25ba090-04cc-4215-83ea-b7eae05440b8', '00000000-0000-0000-0000-000000000001', '6f8bbcc5-d3c3-493c-a091-1a7402df7665', 10, 6.30, 1),
  ('a0208454-58ad-4391-8bae-9c6b3a227b54', 'd25ba090-04cc-4215-83ea-b7eae05440b8', '00000000-0000-0000-0000-000000000001', '800028fe-59ee-4d2c-89ca-8d21f93bb8c8', 8, 2.52, 1);
UPDATE products SET current_stock = current_stock + 6, cost_price_usd = 5.04, cost_updated_at = now() WHERE id = 'a7ed95d2-f3bb-4ba4-97ef-cef357771397';
UPDATE products SET current_stock = current_stock + 10, cost_price_usd = 6.30, cost_updated_at = now() WHERE id = '6f8bbcc5-d3c3-493c-a091-1a7402df7665';
UPDATE products SET current_stock = current_stock + 8, cost_price_usd = 2.52, cost_updated_at = now() WHERE id = '800028fe-59ee-4d2c-89ca-8d21f93bb8c8';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('5442142b-e5e7-4fa9-bf65-92bf66b39ceb', '00000000-0000-0000-0000-000000000001', '7062d391-02a2-4e32-9d06-b057af7e6597', (now() - INTERVAL '16 days'), 8879.08, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('bbf1f307-ff35-4b66-a973-31854279658b', '5442142b-e5e7-4fa9-bf65-92bf66b39ceb', '00000000-0000-0000-0000-000000000001', 'c2d8d72f-e62a-405e-bc75-e9bfdc6d67fc', 5, 539.40, 0),
  ('d661709a-415d-4f16-b990-7a35667e3327', '5442142b-e5e7-4fa9-bf65-92bf66b39ceb', '00000000-0000-0000-0000-000000000001', '2746e7c7-de7b-4137-97c5-535e82e69027', 6, 779.40, 0),
  ('98fd76ea-d256-4982-af6a-2544e89e9e48', '5442142b-e5e7-4fa9-bf65-92bf66b39ceb', '00000000-0000-0000-0000-000000000001', '8b6c1cae-8000-4fa8-b0f7-81b6f4ef6ae6', 4, 376.42, 0);
UPDATE products SET current_stock = current_stock + 5 WHERE id = 'c2d8d72f-e62a-405e-bc75-e9bfdc6d67fc';
UPDATE products SET current_stock = current_stock + 6 WHERE id = '2746e7c7-de7b-4137-97c5-535e82e69027';
UPDATE products SET current_stock = current_stock + 4 WHERE id = '8b6c1cae-8000-4fa8-b0f7-81b6f4ef6ae6';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('54f86d19-3ec8-4b44-8611-4edc164a0c7a', '00000000-0000-0000-0000-000000000001', '0d38bca7-72a8-4c18-bf65-0c05bdab0772', (now() - INTERVAL '12 days'), 271.00, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('2a9d3384-1800-4a16-8731-9d73997bc936', '54f86d19-3ec8-4b44-8611-4edc164a0c7a', '00000000-0000-0000-0000-000000000001', '5247ff3b-3ec0-49af-910a-0a018eafa924', 15, 4.80, 0),
  ('7360a76f-f9fc-4e3c-92ba-980ea019de0e', '54f86d19-3ec8-4b44-8611-4edc164a0c7a', '00000000-0000-0000-0000-000000000001', 'bf45e1d5-71eb-4942-8d58-2db23c69cdf3', 20, 8.55, 0),
  ('9c91ba0b-e059-435b-83af-624395989974', '54f86d19-3ec8-4b44-8611-4edc164a0c7a', '00000000-0000-0000-0000-000000000001', '5b7606c5-b28c-4f84-b5c9-37f3b22f3801', 10, 2.80, 0);
UPDATE products SET current_stock = current_stock + 15 WHERE id = '5247ff3b-3ec0-49af-910a-0a018eafa924';
UPDATE products SET current_stock = current_stock + 20 WHERE id = 'bf45e1d5-71eb-4942-8d58-2db23c69cdf3';
UPDATE products SET current_stock = current_stock + 10 WHERE id = '5b7606c5-b28c-4f84-b5c9-37f3b22f3801';
INSERT INTO stock_receivings (id, shop_id, supplier_id, received_at, total_cost_usd, exchange_rate_at_receiving) VALUES ('b42dae62-0a79-404a-bb18-510617262661', '00000000-0000-0000-0000-000000000001', 'f0e1b43f-39b9-4858-8322-1f5cdf53a819', (now() - INTERVAL '6 days'), 747.75, 14500);
INSERT INTO stock_receiving_line_items (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated) VALUES
  ('425c9128-ef69-477d-addb-3311875e017b', 'b42dae62-0a79-404a-bb18-510617262661', '00000000-0000-0000-0000-000000000001', '60126ab3-bafc-4591-8823-1ca5ebbc0542', 12, 19.50, 0),
  ('b85ad049-30dc-4e45-a4c5-603aea025e64', 'b42dae62-0a79-404a-bb18-510617262661', '00000000-0000-0000-0000-000000000001', '23f66263-75bf-4693-9b4e-4e0f9d56eb4a', 10, 34.50, 0),
  ('e85c1053-cfa3-4fa7-8ef9-6e3ddb86c925', 'b42dae62-0a79-404a-bb18-510617262661', '00000000-0000-0000-0000-000000000001', '1004a4ac-03df-4224-a009-468c8b8cc811', 15, 11.25, 0);
UPDATE products SET current_stock = current_stock + 12 WHERE id = '60126ab3-bafc-4591-8823-1ca5ebbc0542';
UPDATE products SET current_stock = current_stock + 10 WHERE id = '23f66263-75bf-4693-9b4e-4e0f9d56eb4a';
UPDATE products SET current_stock = current_stock + 15 WHERE id = '1004a4ac-03df-4224-a009-468c8b8cc811';

COMMIT;

-- Summary counts (informational, run manually if desired):
-- SELECT count(*) FROM products WHERE shop_id='00000000-0000-0000-0000-000000000001' AND created_via='mock_data_seed';
