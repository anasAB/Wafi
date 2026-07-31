// Mock data for seeding a WAFI shop with an IKEA-style retail catalog.
// Pure data — no DB calls here. See ../seed-mock-data.mjs for the loader.

export const CATEGORIES = [
  'أرائك وكراسي بذراعين',
  'تخزين وتنظيم',
  'غرفة النوم',
  'المطبخ والأجهزة',
  'الإضاءة',
  'السجاد والمنسوجات',
  'أطفال',
  'خارجي وحديقة',
  'ديكور',
];

// [name_ar, name_en, price_usd, cost_ratio, category]
export const PRODUCTS = [
  // Sofas & Armchairs
  ['أريكة كيفيك 3 مقاعد', 'KIVIK 3-seat sofa', 799, 0.6, CATEGORIES[0]],
  ['أريكة كيفيك زاوية', 'KIVIK corner sofa', 1099, 0.6, CATEGORIES[0]],
  ['أريكة إكتورب 2 مقعد', 'EKTORP 2-seat sofa', 549, 0.58, CATEGORIES[0]],
  ['كرسي بوانغ', 'POÄNG armchair', 129, 0.55, CATEGORIES[0]],
  ['كرسي بوانغ مع مسند أرجل', 'POÄNG armchair + footstool', 189, 0.55, CATEGORIES[0]],
  ['أريكة كليبان مقعدين', 'KLIPPAN 2-seat sofa', 379, 0.58, CATEGORIES[0]],
  ['أريكة فيمله 3 مقاعد', 'VIMLE 3-seat sofa', 899, 0.6, CATEGORIES[0]],
  ['أريكة فارلوف', 'FÄRLÖV 3-seat sofa', 749, 0.6, CATEGORIES[0]],
  ['أريكة ستوكسند', 'STOCKSUND 3-seat sofa', 899, 0.62, CATEGORIES[0]],
  ['أريكة سودرهامن زاوية', 'SÖDERHAMN corner sofa', 1299, 0.6, CATEGORIES[0]],
  ['أريكة لاندسكرونا جلد', 'LANDSKRONA leather sofa', 1499, 0.63, CATEGORIES[0]],
  ['كرسي هافباك', 'HAVBÄCK armchair', 249, 0.55, CATEGORIES[0]],
  ['أريكة أبلاريد', 'ÄPPLARYD 2-seat sofa', 649, 0.58, CATEGORIES[0]],
  ['أريكة سرير باروب', 'PÄRUP sofa bed', 599, 0.6, CATEGORIES[0]],

  // Storage & Organization
  ['رف كاياكس 4x4', 'KALLAX shelf 4x4', 179, 0.55, CATEGORIES[1]],
  ['رف كاياكس 2x2', 'KALLAX shelf 2x2', 59, 0.5, CATEGORIES[1]],
  ['رف كاياكس 2x4', 'KALLAX shelf 2x4', 99, 0.5, CATEGORIES[1]],
  ['مكتبة بيلي', 'BILLY bookcase', 89, 0.5, CATEGORIES[1]],
  ['مكتبة بيلي عالية', 'BILLY tall bookcase', 129, 0.5, CATEGORIES[1]],
  ['خزانة ملابس باكس', 'PAX wardrobe frame', 279, 0.55, CATEGORIES[1]],
  ['باب خزانة باكس', 'PAX wardrobe door', 89, 0.5, CATEGORIES[1]],
  ['رف إيفار', 'IVAR shelving unit', 119, 0.5, CATEGORIES[1]],
  ['وحدة تخزين بيستو', 'BESTÅ storage combination', 349, 0.58, CATEGORIES[1]],
  ['صناديق تروفاست', 'TROFAST storage combination', 79, 0.5, CATEGORIES[1]],
  ['صناديق تخزين سكوب', 'SKUBB storage boxes (set)', 15, 0.45, CATEGORIES[1]],
  ['نظام تخزين ألجوت', 'ALGOT storage system', 149, 0.5, CATEGORIES[1]],
  ['خزانة أدراج هيمنس 6', 'HEMNES 6-drawer chest', 279, 0.55, CATEGORIES[1]],
  ['عربة راسكوغ', 'RÅSKOG utility cart', 39, 0.5, CATEGORIES[1]],
  ['رف كتب بيلي بزجاج', 'BILLY bookcase w/ glass doors', 199, 0.55, CATEGORIES[1]],

  // Bedroom
  ['سرير مالم 160×200', 'MALM bed frame 160x200', 299, 0.58, CATEGORIES[2]],
  ['خزانة أدراج مالم 6', 'MALM 6-drawer chest', 249, 0.55, CATEGORIES[2]],
  ['طاولة جانبية مالم', 'MALM nightstand', 79, 0.5, CATEGORIES[2]],
  ['سرير هيمنس خشب', 'HEMNES bed frame (wood)', 349, 0.58, CATEGORIES[2]],
  ['خزانة أدراج هيمنس 3', 'HEMNES 3-drawer chest', 199, 0.55, CATEGORIES[2]],
  ['سرير برينس تخزين', 'BRIMNES bed frame w/ storage', 329, 0.58, CATEGORIES[2]],
  ['سرير سونجساند', 'SONGESAND bed frame', 279, 0.55, CATEGORIES[2]],
  ['سرير نوردلي', 'NORDLI bed frame w/ storage', 449, 0.6, CATEGORIES[2]],
  ['مرتبة غورسكن', 'GURSKEN mattress', 249, 0.55, CATEGORIES[2]],
  ['مرتبة فيستمار', 'VESTMARKA mattress', 179, 0.5, CATEGORIES[2]],
  ['إطار سرير لوريو', 'LURÖY slatted bed base', 39, 0.5, CATEGORIES[2]],
  ['طاولة زينة برينس', 'BRIMNES dressing table', 149, 0.55, CATEGORIES[2]],

  // Kitchen & Appliances
  ['واجهة خزانة متود', 'METOD kitchen cabinet front', 45, 0.5, CATEGORIES[3]],
  ['طقم أواني آيكيا 365+', 'IKEA 365+ cookware set', 89, 0.55, CATEGORIES[3]],
  ['رف تخزين فورهويا', 'FÖRHÖJA kitchen cart', 129, 0.5, CATEGORIES[3]],
  ['علب تخزين فارييرا', 'VARIERA storage containers (set)', 12, 0.45, CATEGORIES[3]],
  ['رف تجفيف هولبار', 'HÅLLBAR dish rack', 25, 0.45, CATEGORIES[3]],
  ['مطبخ كنوكسهولت صغير', 'KNOXHULT compact kitchen unit', 349, 0.58, CATEGORIES[3]],
  ['طقم أدوات مائدة فارداغن', 'VARDAGEN cutlery set (24pc)', 29, 0.5, CATEGORIES[3]],
  ['طقم أطباق آيكيا 365+', 'IKEA 365+ dinnerware set (18pc)', 59, 0.5, CATEGORIES[3]],
  ['خلاط يدوي', 'IKEA 365+ hand blender', 35, 0.5, CATEGORIES[3]],
  ['غلاية كهربائية', 'IKEA 365+ electric kettle', 25, 0.5, CATEGORIES[3]],
  ['محمصة خبز', 'IKEA 365+ toaster', 29, 0.5, CATEGORIES[3]],
  ['طقم سكاكين', 'IKEA 365+ knife set (5pc)', 39, 0.5, CATEGORIES[3]],

  // Lighting
  ['مصباح أرضي رانارب', 'RANARP floor lamp', 79, 0.5, CATEGORIES[4]],
  ['مصباح طاولة فادو', 'FADO table lamp', 15, 0.45, CATEGORIES[4]],
  ['مصباح أرضي هكتار', 'HEKTAR floor lamp', 69, 0.5, CATEGORIES[4]],
  ['مصباح سقف نوت', 'NOT ceiling lamp shade', 12, 0.45, CATEGORIES[4]],
  ['مصباح جداري ليرستا', 'LERSTA wall lamp', 25, 0.45, CATEGORIES[4]],
  ['مصباح طاولة سولكلينت', 'SOLKLINT table lamp', 19, 0.45, CATEGORIES[4]],
  ['لمبة LED ذكية', 'TRÅDFRI smart LED bulb', 12, 0.4, CATEGORIES[4]],
  ['شريط إضاءة LED', 'LEDBERG LED light strip', 18, 0.45, CATEGORIES[4]],
  ['مصباح مكتب فورساو', 'FORSÅ work lamp', 22, 0.45, CATEGORIES[4]],
  ['ثريا سقف رامسته', 'RAMSTA pendant lamp', 45, 0.5, CATEGORIES[4]],

  // Rugs & Textiles
  ['سجادة ستوكهولم', 'STOCKHOLM rug, flatwoven', 249, 0.55, CATEGORIES[5]],
  ['سجادة فينتر', 'VINTER rug, high-pile', 89, 0.5, CATEGORIES[5]],
  ['سجادة سكوغسكلوفر', 'SKOGSKLÖVER rug, low-pile', 129, 0.5, CATEGORIES[5]],
  ['سجادة ألفينه', 'ALVINE RUTA rug, flatwoven', 149, 0.5, CATEGORIES[5]],
  ['سجادة غولفد', 'GULVED rug, flatwoven', 59, 0.45, CATEGORIES[5]],
  ['سجادة لابليونغ روتا', 'LAPPLJUNG RUTA rug, high-pile', 79, 0.5, CATEGORIES[5]],
  ['ستارة مالينا', 'MERETE curtains (1 pair)', 35, 0.5, CATEGORIES[5]],
  ['غطاء وسادة سنويرت', 'SANELA cushion cover', 15, 0.45, CATEGORIES[5]],
  ['بطانية إينغيلا', 'INGABRITTA throw blanket', 25, 0.45, CATEGORIES[5]],
  ['غطاء لحاف روديل', 'RÖDLILJA duvet cover set', 45, 0.5, CATEGORIES[5]],
  ['مفرش مائدة قطن', 'MITTBIT tablecloth', 19, 0.45, CATEGORIES[5]],

  // Kids
  ['طاولة رسم فليسات', 'FLISAT children\'s desk', 89, 0.5, CATEGORIES[6]],
  ['سرير مامّوت أطفال', 'MAMMUT kids bed frame', 99, 0.5, CATEGORIES[6]],
  ['صندوق تروفاست أطفال', 'TROFAST kids storage combo', 89, 0.5, CATEGORIES[6]],
  ['كرسي كريتر أطفال', 'KRITTER children\'s chair', 19, 0.45, CATEGORIES[6]],
  ['سرير سوندفيك أطفال', 'SUNDVIK toddler bed', 129, 0.5, CATEGORIES[6]],
  ['مطبخ ألعاب دوكتيغ', 'DUKTIG play kitchen', 149, 0.5, CATEGORIES[6]],
  ['أدوات ألعاب دوكتيغ', 'DUKTIG play food set', 15, 0.4, CATEGORIES[6]],
  ['وحدة تخزين سموستاد', 'SMÅSTAD storage combination', 249, 0.55, CATEGORIES[6]],
  ['دمية دجونغلسكوغ', 'DJUNGELSKOG soft toy', 12, 0.4, CATEGORIES[6]],
  ['كرسي مرتفع أنتيلوب', 'ANTILOP high chair', 25, 0.45, CATEGORIES[6]],

  // Outdoor & Garden
  ['طاولة خارجية أبلارو', 'ÄPPLARÖ outdoor table', 179, 0.55, CATEGORIES[7]],
  ['كرسي خارجي أبلارو', 'ÄPPLARÖ outdoor chair', 89, 0.5, CATEGORIES[7]],
  ['طقم جلوس نمّارو', 'NÄMMARÖ outdoor seating set', 449, 0.58, CATEGORIES[7]],
  ['أرجوحة سيغرون', 'SEGERÖN hanging chair', 149, 0.5, CATEGORIES[7]],
  ['طاولة فيسمان خارجية', 'VÄSMAN outdoor side table', 59, 0.5, CATEGORIES[7]],
  ['وسائد كودارنا خارجية', 'KUDDARNA outdoor cushions (set)', 25, 0.45, CATEGORIES[7]],
  ['مظلة خارجية', 'SAMSÖ patio umbrella', 89, 0.5, CATEGORIES[7]],
  ['أصيص نباتات خارجي', 'HYLLIS outdoor planter', 15, 0.4, CATEGORIES[7]],
  ['طقم شواء أدوات', 'GRILLTIDER BBQ tool set', 29, 0.45, CATEGORIES[7]],

  // Decor
  ['نبتة اصطناعية فيكا', 'FEJKA artificial plant', 12, 0.4, CATEGORIES[8]],
  ['رف عرض فيتسيو', 'VITTSJÖ display shelf', 49, 0.5, CATEGORIES[8]],
  ['صندوق تخزين كناغليغ', 'KNAGGLIG storage box', 15, 0.4, CATEGORIES[8]],
  ['إطار صورة ريبا', 'RIBBA picture frame', 9, 0.4, CATEGORIES[8]],
  ['مرآة حائط', 'MALMA wall mirror', 25, 0.45, CATEGORIES[8]],
  ['شمعة معطرة', 'SINNLIG scented candle', 6, 0.4, CATEGORIES[8]],
  ['شمعدان', 'BLOMSTER candle holder', 8, 0.4, CATEGORIES[8]],
  ['وعاء زينة', 'GRADVIS decorative bowl', 12, 0.4, CATEGORIES[8]],
  ['ساعة حائط', 'STURSK wall clock', 19, 0.45, CATEGORIES[8]],
  ['لوحة جدارية', 'BILD poster art', 15, 0.4, CATEGORIES[8]],
  ['أصيص نباتات داخلي', 'NYPON plant pot', 7, 0.4, CATEGORIES[8]],
];

// [category, expense_date_days_ago, amount, currency, notes]
export const EXPENSES = [
  ['إيجار', 58, 800, 'USD', 'إيجار المحل — شهري'],
  ['إيجار', 28, 800, 'USD', 'إيجار المحل — شهري'],
  ['كهرباء', 52, 65, 'USD', 'فاتورة كهرباء'],
  ['كهرباء', 22, 70, 'USD', 'فاتورة كهرباء'],
  ['رواتب', 50, 1200, 'USD', 'رواتب الموظفين — نهاية الشهر'],
  ['رواتب', 20, 1200, 'USD', 'رواتب الموظفين — نهاية الشهر'],
  ['بضاعة', 45, 3500, 'USD', 'شحنة أثاث من المورد'],
  ['بضاعة', 15, 2800, 'USD', 'شحنة إكسسوارات منزلية'],
  ['صيانة', 40, 120, 'USD', 'صيانة نظام التكييف'],
  ['صيانة', 10, 45, 'USD', 'إصلاح باب المحل'],
  ['أخرى', 35, 60, 'USD', 'مصاريف تسويق — منشورات'],
  ['أخرى', 25, 90000, 'SYP', 'قرطاسية ومستلزمات مكتبية'],
  ['كهرباء', 8, 68, 'USD', 'فاتورة كهرباء'],
  ['أخرى', 5, 40, 'USD', 'وجبات موظفين'],
  ['صيانة', 3, 200, 'USD', 'صيانة سيارة التوصيل'],
];

// [name, phone, address]
export const CUSTOMERS = [
  ['أحمد الحلبي', '+963944112233', 'دمشق - المزة'],
  ['فاطمة العلي', '+963955223344', 'دمشق - أبو رمانة'],
  ['محمد الخطيب', '+963933445566', 'حلب - الفرقان'],
  ['رنا يوسف', '+963966778899', 'دمشق - كفرسوسة'],
  ['خالد حمدان', '+963922334455', 'اللاذقية - الشاطئ'],
  ['ليلى صالح', '+963977889900', 'دمشق - المالكي'],
  ['يوسف مراد', '+963911223344', 'حمص - الوعر'],
  ['سارة قاسم', '+963988990011', 'دمشق - دمر'],
  ['عمر النجار', '+963900112233', 'حلب - الشهباء'],
  ['هبة درويش', '+963944556677', 'دمشق - قدسيا'],
  ['طارق العبدالله', '+963955667788', 'اللاذقية - المشروع'],
  ['ريم شحادة', '+963966889900', 'دمشق - برزة'],
];

// [name, phone, contact_person, address]
export const SUPPLIERS = [
  ['شركة إيكيا للتجارة', '+96170123456', 'كريستيان لارسون', 'بيروت - المنطقة الصناعية'],
  ['دمشق للتجهيزات المنزلية', '+963988112233', 'وائل مصطفى', 'دمشق - عدرا الصناعية'],
  ['الشرق للأثاث والديكور', '+963955223344', 'نور الدين حسن', 'حلب - الشيخ نجار'],
  ['مؤسسة النور للإضاءة', '+963933445566', 'باسل رزق', 'دمشق - ركن الدين'],
  ['الأمانة للمنسوجات', '+963944556677', 'هالة كنعان', 'حمص - الإنشاءات'],
  ['شام للاستيراد والتوزيع', '+963966778899', 'سامر قدور', 'دمشق - المنطقة الحرة'],
];

// [supplier_index, days_ago, [[product_index, qty, cost_multiplier], ...]]
// cost_multiplier applied to the product's base cost_price to vary receiving cost slightly
export const RECEIVINGS = [
  [0, 47, [[0, 8, 1.0], [3, 15, 1.0], [4, 6, 1.0], [1, 5, 1.0]]],
  [1, 44, [[14, 20, 1.0], [15, 25, 1.0], [17, 15, 1.0], [23, 30, 0.95]]],
  [2, 40, [[29, 10, 1.0], [31, 12, 1.0], [35, 8, 1.0], [38, 10, 1.0]]],
  [3, 36, [[59, 20, 1.0], [60, 40, 1.0], [61, 15, 1.0], [63, 25, 1.0]]],
  [4, 32, [[70, 10, 1.0], [72, 8, 1.0], [74, 12, 1.0], [76, 15, 1.0]]],
  [5, 28, [[46, 15, 1.0], [48, 10, 1.0], [50, 8, 1.0], [52, 20, 1.0]]],
  [0, 20, [[93, 6, 1.05], [95, 10, 1.05], [98, 8, 1.05]]],
  [1, 16, [[6, 5, 1.0], [9, 6, 1.0], [12, 4, 1.0]]],
  [2, 12, [[100, 15, 1.0], [101, 20, 1.0], [103, 10, 1.0]]],
  [3, 6, [[52, 12, 1.0], [55, 10, 1.0], [57, 15, 1.0]]],
];
