// بيانات تجريبية: شركتان عميلتان، ناقلان، سائقون، مواقع، معدات، خزانان، ورحلات منفذة عبر خدمات النظام نفسها
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, q, uid, ML, ROOT, UPLOAD_DIR } from './db.js';
import { hashPassword, createSession, loadContext } from './auth.js';
import * as trips from './services/trips.js';
import * as inv from './services/inventory.js';
import * as fuel from './services/fueling.js';
import * as docs from './services/documents.js';
import { sampleAramcoPdf, makePng, PHOTO_COLORS } from './samples.js';

export const DEMO_PASSWORD = 'Hajoom@2026';

export async function seedDemo({ history = true } = {}) {
  const pw = hashPassword(DEMO_PASSWORD);
  const company = (id, type, name_ar, name_en, city, status = 'approved', settings = {}) =>
    q.run('INSERT INTO companies(id,type,name_ar,name_en,city,status,cr_number,vat_number,settings_json) VALUES (?,?,?,?,?,?,?,?,?)', id, type, name_ar, name_en, city, status,
      '10' + Math.floor(1e7 + Math.random() * 9e7), '3' + Math.floor(1e13 + Math.random() * 9e13) + '03', JSON.stringify(settings));
  const user = (email, name, phone) => { const id = uid('usr_'); q.run('INSERT INTO users(id,name,email,phone,password_hash) VALUES (?,?,?,?,?)', id, name, email, phone || null, pw); return id; };
  const member = (userId, companyId, role, extra = {}) => { const id = uid('mem_'); q.run('INSERT INTO memberships(id,user_id,company_id,role,scope_project_id,scope_site_id) VALUES (?,?,?,?,?,?)', id, userId, companyId, role, extra.project || null, extra.site || null); return id; };

  // ---- المنصة ----
  company('co_hajoom', 'platform', 'هجوم', 'Hajoom', 'الرياض', 'approved', { commission_pct: 3 });
  member(user('admin@hajoom.demo', 'إدارة هجوم'), 'co_hajoom', 'platform_admin');

  // ---- نقاط التحميل (أسماء تجريبية) ----
  const LP = [['lp_ryd', 'RBP', 'محطة توزيع الرياض', 'الرياض', 24.58, 46.84], ['lp_dmm', 'DBP', 'محطة توزيع الدمام', 'الدمام', 26.39, 50.10],
    ['lp_jed', 'JBP', 'محطة توزيع جدة', 'جدة', 21.42, 39.21], ['lp_qsm', 'QBP', 'محطة توزيع القصيم', 'بريدة', 26.33, 43.97]];
  for (const l of LP) q.run('INSERT INTO loading_points(id,code,name,city,lat,lng) VALUES (?,?,?,?,?,?)', ...l);

  // ---- الناقل الأول ----
  company('co_car1', 'carrier', 'ناقلات الوسطى (تجريبي)', 'Central Tankers (Demo)', 'الرياض');
  const car1Admin = user('carrier1@hajoom.demo', 'سلطان العتيبي', '0551000001'); member(car1Admin, 'co_car1', 'carrier_admin');
  const car1Disp = user('dispatch1@hajoom.demo', 'نواف الشمري', '0551000002'); member(car1Disp, 'co_car1', 'dispatcher');
  const d1u = user('driver1@hajoom.demo', 'محمد القحطاني', '0552000001'); member(d1u, 'co_car1', 'driver');
  const d2u = user('driver2@hajoom.demo', 'عبدالله الدوسري', '0552000002'); member(d2u, 'co_car1', 'driver');
  q.run("INSERT INTO drivers(id,company_id,user_id,name,phone,license_no,license_expiry) VALUES ('drv_1','co_car1',?,?,?,?,?)", d1u, 'محمد القحطاني', '0552000001', 'L-883201', '2028-03-01');
  q.run("INSERT INTO drivers(id,company_id,user_id,name,phone,license_no,license_expiry) VALUES ('drv_2','co_car1',?,?,?,?,?)", d2u, 'عبدالله الدوسري', '0552000002', 'L-552910', '2027-08-15');
  q.run("INSERT INTO vehicles(id,company_id,plate,capacity_ml,products,docs_valid_until) VALUES ('veh_1','co_car1','أ ب ج 4512',?, 'diesel', '2027-12-31')", ML(36000));
  q.run("INSERT INTO vehicles(id,company_id,plate,capacity_ml,products,docs_valid_until) VALUES ('veh_2','co_car1','د ر س 7781',?, 'diesel,gasoline91', '2027-06-30')", ML(32000));
  q.run("INSERT INTO vehicles(id,company_id,plate,capacity_ml,products,docs_valid_until) VALUES ('veh_3','co_car1','ص ط ع 2290',?, 'diesel', '2027-09-30')", ML(20000));
  const price = (id, carrier, lp, city, product, type, sar, wait = 75, cancel = 350) => {
    q.run('INSERT INTO route_prices(id,carrier_id,loading_point_id,delivery_city,product,pricing_type,price_halalas,waiting_fee_halalas_per_hour,cancel_fee_halalas) VALUES (?,?,?,?,?,?,?,?,?)', id, carrier, lp, city, product, type, Math.round(sar * 100), wait * 100, cancel * 100);
    q.run("INSERT OR IGNORE INTO carrier_coverage(id,carrier_id,kind,ref) VALUES (?,?,'loading',?)", uid('cov_'), carrier, lp);
    q.run("INSERT OR IGNORE INTO carrier_coverage(id,carrier_id,kind,ref) VALUES (?,?,'delivery',?)", uid('cov_'), carrier, city);
  };
  price('rp_c1_ryd', 'co_car1', 'lp_ryd', 'الرياض', 'diesel', 'fixed', 1450);
  price('rp_c1_ryd_g', 'co_car1', 'lp_ryd', 'الرياض', 'gasoline91', 'fixed', 1550);
  price('rp_c1_qsm', 'co_car1', 'lp_qsm', 'بريدة', 'diesel', 'fixed', 1200);

  // ---- الناقل الثاني ----
  company('co_car2', 'carrier', 'أسطول الشرقية للنقل (تجريبي)', 'Eastern Fleet (Demo)', 'الدمام');
  member(user('carrier2@hajoom.demo', 'فهد الحربي', '0553000001'), 'co_car2', 'carrier_admin');
  const d3u = user('driver3@hajoom.demo', 'خالد الزهراني', '0554000001'); member(d3u, 'co_car2', 'driver');
  q.run("INSERT INTO drivers(id,company_id,user_id,name,phone,license_no,license_expiry) VALUES ('drv_3','co_car2',?,?,?,?,?)", d3u, 'خالد الزهراني', '0554000001', 'L-120934', '2027-11-20');
  q.run("INSERT INTO vehicles(id,company_id,plate,capacity_ml,products,docs_valid_until) VALUES ('veh_4','co_car2','ك ل م 9031',?, 'diesel', '2027-10-31')", ML(36000));
  q.run("INSERT INTO vehicles(id,company_id,plate,capacity_ml,products,docs_valid_until) VALUES ('veh_5','co_car2','ن هـ و 1187',?, 'diesel', '2026-01-31')", ML(30000)); // وثائق منتهية
  price('rp_c2_dmm', 'co_car2', 'lp_dmm', 'الدمام', 'diesel', 'per_1000l', 42);
  price('rp_c2_ryd', 'co_car2', 'lp_ryd', 'الرياض', 'diesel', 'per_1000l', 46);

  // ---- ناقل بانتظار الاعتماد ----
  company('co_car3', 'carrier', 'مؤسسة الجنوب للنقليات (تجريبي)', 'South Haulage (Demo)', 'أبها', 'pending');
  member(user('carrier3@hajoom.demo', 'سعيد القرني'), 'co_car3', 'carrier_admin');
  for (const [co, t, st, exp] of [['co_car1', 'cr', 'approved', '2027-05-01'], ['co_car1', 'transport_license', 'approved', '2027-02-01'], ['co_car1', 'insurance', 'approved', '2026-12-10'],
    ['co_car2', 'cr', 'approved', '2027-09-01'], ['co_car2', 'transport_license', 'approved', '2027-03-15'], ['co_car3', 'cr', 'pending', '2027-08-01'], ['co_car3', 'transport_license', 'pending', '2027-01-20']])
    q.run('INSERT INTO company_documents(id,company_id,doc_type,number,expires_at,status) VALUES (?,?,?,?,?,?)', uid('cd_'), co, t, String(Math.floor(1e6 + Math.random() * 9e6)), exp, st);

  // ---- العميل الأول: شركة مقاولات ----
  company('co_cli1', 'client', 'شركة الراسخ للمقاولات (تجريبي)', 'Al-Rasikh Contracting (Demo)', 'الرياض', 'approved', { allow_qr: true, allow_manual: true, rapid_repeat_minutes: 15 });
  q.run("INSERT INTO branches(id,company_id,name,city) VALUES ('br_1','co_cli1','فرع الرياض','الرياض')");
  q.run("INSERT INTO cost_centers(id,company_id,code,name) VALUES ('cc_1','co_cli1','CC-410','معدات الطرق'), ('cc_2','co_cli1','CC-420','المباني'), ('cc_3','co_cli1','CC-900','الخدمات المساندة')");
  q.run("INSERT INTO projects(id,company_id,branch_id,code,name,cost_center_id,budget_ml,budget_halalas) VALUES ('prj_1','co_cli1','br_1','PRJ-101','مشروع طريق الخرج السريع','cc_1',?,?)", ML(120000), 32000000);
  q.run("INSERT INTO projects(id,company_id,branch_id,code,name,cost_center_id,budget_ml,budget_halalas) VALUES ('prj_2','co_cli1','br_1','PRJ-102','مجمع الملقا السكني','cc_2',?,?)", ML(40000), 11000000);
  q.run(`INSERT INTO sites(id,company_id,project_id,name,city,lat,lng,receiver_name,receiver_phone,access_notes) VALUES
    ('sit_1','co_cli1','prj_1','موقع الخرج - كيلو 42','الرياض',24.30,47.18,'ماجد السبيعي','0561000001','البوابة الشمالية، يلزم سترة سلامة'),
    ('sit_2','co_cli1','prj_2','موقع الملقا','الرياض',24.80,46.61,'تركي المطيري','0561000002','الدخول من شارع أنس بن مالك')`);
  q.run(`INSERT INTO tanks(id,company_id,site_id,code,name,product,capacity_ml,reorder_ml) VALUES
    ('tnk_1','co_cli1','sit_1','TNK-01','خزان الخرج الرئيسي','diesel',?,?), ('tnk_2','co_cli1','sit_2','TNK-02','خزان الملقا','diesel',?,?)`, ML(50000), ML(8000), ML(30000), ML(5000));
  const cAdmin = user('client1@hajoom.demo', 'م. عبدالرحمن الراشد', '0560000001'); member(cAdmin, 'co_cli1', 'client_admin');
  member(user('procure1@hajoom.demo', 'ريم السالم', '0560000002'), 'co_cli1', 'procurement');
  member(user('pm1@hajoom.demo', 'م. يوسف العنزي', '0560000003'), 'co_cli1', 'project_manager', { project: 'prj_1' });
  const sup = user('fuel1@hajoom.demo', 'أحمد الغامدي', '0560000004'); member(sup, 'co_cli1', 'fuel_supervisor');
  member(user('finance1@hajoom.demo', 'نورة الحمدان', '0560000005'), 'co_cli1', 'finance');
  member(user('receiver1@hajoom.demo', 'ماجد السبيعي', '0561000001'), 'co_cli1', 'site_receiver', { site: 'sit_1' });
  member(cAdmin, 'co_car1', 'dispatcher'); // مثال: مستخدم واحد في أكثر من شركة بصلاحيات مستقلة

  const assets = [
    ['ast_1', 'EX-336-01', 'حفار كاتربيلر 336', 'heavy_equipment', 'CAT336-7781', 'prj_1', 'sit_1', 'cc_1', 'hours', 700, 600, 1200],
    ['ast_2', 'LD-950-02', 'شيول كاتربيلر 950', 'heavy_equipment', 'CAT950-1102', 'prj_1', 'sit_1', 'cc_1', 'hours', 400, 400, 800],
    ['ast_3', 'GR-14M-03', 'جريدر 14M', 'heavy_equipment', 'CAT14M-5521', 'prj_1', 'sit_1', 'cc_1', 'hours', 450, 400, 900],
    ['ast_4', 'GEN-500-04', 'مولد 500 كيلوفولت أمبير', 'generator', 'PRK-500-2231', 'prj_1', 'sit_1', 'cc_1', 'hours', 1000, 800, 1600],
    ['ast_5', 'VH-HLX-05', 'هايلكس دفع رباعي', 'vehicle', 'ر س ع 4410', 'prj_1', 'sit_1', 'cc_3', 'km', 80, 80, 160],
    ['ast_6', 'WT-20K-06', 'وايت ماء 20 ألف', 'vehicle', 'م ن ق 7712', 'prj_1', 'sit_1', 'cc_1', 'km', 300, 300, 600],
    ['ast_7', 'CR-50T-07', 'رافعة 50 طن', 'heavy_equipment', 'LBH-50-0912', 'prj_2', 'sit_2', 'cc_2', 'hours', 400, 350, 700],
    ['ast_8', 'GEN-250-08', 'مولد 250 كيلوفولت أمبير', 'generator', 'CMS-250-3381', 'prj_2', 'sit_2', 'cc_2', 'hours', 500, 450, 900],
    ['ast_9', 'DZ-D8-09', 'بلدوزر D8', 'heavy_equipment', 'CATD8-6620', 'prj_1', 'sit_1', 'cc_1', 'hours', 700, 600, 1200],
  ];
  for (const a of assets) {
    q.run(`INSERT INTO assets(id,company_id,code,name,category,fuel_type,plate_or_serial,project_id,site_id,cost_center_id,meter_type,tank_capacity_ml,per_tx_limit_ml,daily_limit_ml,monthly_limit_ml)
        VALUES (?, 'co_cli1', ?,?,?, 'diesel', ?,?,?,?,?,?,?,?,?)`, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], ML(a[9]), ML(a[10]), ML(a[11]), ML(a[11] * 25));
    q.run('INSERT INTO asset_assignments(id,asset_id,project_id,site_id,cost_center_id,effective_from,created_by) VALUES (?,?,?,?,?,?,?)', uid('asg_'), a[0], a[5], a[6], a[7], '2026-09-01T00:00:00.000Z', cAdmin);
  }

  // ---- العميل الثاني: مصنع ----
  company('co_cli2', 'client', 'مصنع الصفوة للصناعات (تجريبي)', 'Al-Safwa Industries (Demo)', 'الدمام');
  q.run("INSERT INTO cost_centers(id,company_id,code,name) VALUES ('cc_21','co_cli2','CC-100','التشغيل')");
  q.run("INSERT INTO projects(id,company_id,code,name,cost_center_id) VALUES ('prj_21','co_cli2','OPS','تشغيل المصنع','cc_21')");
  q.run("INSERT INTO sites(id,company_id,project_id,name,city,receiver_name,receiver_phone) VALUES ('sit_21','co_cli2','prj_21','المصنع - المدينة الصناعية الثانية','الدمام','بندر الخالدي','0571000001')");
  q.run(`INSERT INTO assets(id,company_id,code,name,category,fuel_type,plate_or_serial,project_id,site_id,cost_center_id,meter_type,per_tx_limit_ml,daily_limit_ml)
      VALUES ('ast_21','co_cli2','GEN-1000','مولد المصنع الاحتياطي','generator','diesel','SFW-1000','prj_21','sit_21','cc_21','hours',?,?)`, ML(2000), ML(4000));
  member(user('client2@hajoom.demo', 'م. سارة البقمي', '0570000001'), 'co_cli2', 'client_admin');
  member(user('fuel2@hajoom.demo', 'حسن الشهري', '0570000002'), 'co_cli2', 'fuel_supervisor');
  q.run("INSERT INTO nfc_tags(id,company_id,uid,display_no,status,asset_id) VALUES ('tag_21','co_cli2','04C2A1F0B9C201','NFC-00001','active','ast_21')");

  // ---- شرائح NFC للعميل الأول ----
  const ctx = (email, membershipRole) => {
    const m = q.get('SELECT m.id, m.user_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = ?' + (membershipRole ? ' AND m.role = ?' : ''), ...[email, membershipRole].filter(Boolean));
    return loadContext(createSession(m.user_id, m.id));
  };
  const admin = ctx('client1@hajoom.demo', 'client_admin');
  const supervisor = ctx('fuel1@hajoom.demo');
  fuel.issueTagBatch(admin, { batch_no: 'B-2026-11', uids: ['04A1B2C3D4E501', '04A1B2C3D4E502', '04A1B2C3D4E503', '04A1B2C3D4E504', '04A1B2C3D4E505', '04A1B2C3D4E506', '04A1B2C3D4E507', '04A1B2C3D4E508', '04A1B2C3D4E509', '04A1B2C3D4E510', '04A1B2C3D4E511', '04A1B2C3D4E512'] });
  ['ast_1', 'ast_2', 'ast_3', 'ast_4', 'ast_5', 'ast_6', 'ast_7', 'ast_8'].forEach((a, i) => fuel.bindTag(supervisor, { uid: `04A1B2C3D4E5${String(i + 1).padStart(2, '0')}`, asset_id: a, test_read_ok: true }));
  fuel.bindTag(supervisor, { uid: '04A1B2C3D4E509', asset_id: 'ast_9', test_read_ok: false }); // بانتظار التفعيل

  if (history) await seedHistory({ ctx, admin, supervisor });
  return { password: DEMO_PASSWORD };
}

async function seedHistory({ ctx, admin, supervisor }) {
  const procure = ctx('procure1@hajoom.demo');
  const dispatcher = ctx('dispatch1@hajoom.demo');
  const driver1 = ctx('driver1@hajoom.demo');
  const driver2 = ctx('driver2@hajoom.demo');
  const receiver = ctx('receiver1@hajoom.demo');
  const finance = ctx('finance1@hajoom.demo');
  const day = (offset) => new Date(Date.now() + offset * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);

  // رصيد افتتاحي لخزان الملقا
  inv.openingBalance(admin, 'tnk_2', { liters: 12000, cost_per_liter: 1.66, note: 'رصيد افتتاحي عند بدء التشغيل على هجوم' });

  // مستند أرامكو نموذجي للخرج + اعتماد
  const pdf = sampleAramcoPdf({ docNumber: 'SA-FLA-2026-118734', lpCode: 'RBP', lpName: 'Riyadh Distribution Plant', liters: 60000, issue: day(-16), valid: day(30) });
  const doc = await docs.uploadAramcoDocument(procure, { buffer: pdf, originalname: 'aramco-SA-FLA-2026-118734.pdf', mimetype: 'application/pdf' });
  docs.approveDocument(procure, doc.id, { doc_number: doc.doc_number, loading_point_id: doc.loading_point_id, product: doc.product, quantity_liters: 60000, issue_date: doc.issue_date, expiry_date: doc.expiry_date });

  const photo = async (drv, tripId, kind, stopId, at) => {
    const buf = makePng(320, 220, PHOTO_COLORS[kind]);
    const f = docs.storeFile(drv, { buffer: buf, originalname: kind + '.png', mimetype: 'image/png' }, 'trip_photo');
    trips.addPhoto(drv, tripId, { kind, stop_id: stopId, file_id: f.id, lat: 24.3 + Math.random() * 0.05, lng: 47.1 + Math.random() * 0.05, captured_at: at, client_op_id: uid('op_') });
  };
  const runTrip = async ({ date, stops, driver, vehicle, driverCtx, loaded, deliveries, fuelPrice = 1.66, by = procure, rp = 'rp_c1_ryd' }) => {
    const o = trips.createOrder(by, { route_price_id: rp, aramco_document_id: doc.id, date, window_start: '06:00', window_end: '14:00', stops, fuel_price_per_liter: fuelPrice, idempotency_key: uid('idem_') });
    trips.acceptTrip(dispatcher, o.trip_id);
    trips.assignTrip(dispatcher, o.trip_id, { vehicle_id: vehicle, driver_id: driver });
    const ts = new Date(date + 'T05:10:00+03:00').getTime();
    const T = (min) => new Date(ts + min * 60000).toISOString();
    trips.driverAdvance(driverCtx, o.trip_id, { to: 'to_loading', captured_at: T(0) });
    trips.driverAdvance(driverCtx, o.trip_id, { to: 'at_loading', captured_at: T(45) });
    await photo(driverCtx, o.trip_id, 'before_loading', null, T(50));
    trips.driverAdvance(driverCtx, o.trip_id, { to: 'loaded', loaded_liters: loaded, measure_method: 'عداد محطة التحميل', captured_at: T(95) });
    await photo(driverCtx, o.trip_id, 'after_loading', null, T(97));
    trips.driverAdvance(driverCtx, o.trip_id, { to: 'to_delivery', captured_at: T(100) });
    const stopRows = q.all('SELECT * FROM trip_stops WHERE trip_id = ? ORDER BY seq', o.trip_id);
    for (const [i, s] of stopRows.entries()) {
      trips.driverAdvance(driverCtx, o.trip_id, { to: 'at_site', captured_at: T(170 + i * 60) });
      await photo(driverCtx, o.trip_id, 'before_unloading', s.id, T(175 + i * 60));
      if (deliveries[i].beforeDeliver) await deliveries[i].beforeDeliver(o.trip_id, s);
      trips.driverDeliverStop(driverCtx, o.trip_id, s.id, { delivered_liters: deliveries[i].liters, measure_method: 'عداد الصهريج', captured_at: T(210 + i * 60) });
      await photo(driverCtx, o.trip_id, 'after_unloading', s.id, T(212 + i * 60));
    }
    // ضبط الأوقات الفعلية للبيانات التاريخية
    q.run('UPDATE trips SET created_at = ?, accepted_at = ?, assigned_at = ?, loaded_at = ?, delivered_at = ? WHERE id = ?', T(-900), T(-860), T(-840), T(95), T(212 + (stopRows.length - 1) * 60), o.trip_id);
    q.run('UPDATE orders SET created_at = ? WHERE id = ?', T(-900), o.order_id);
    q.run("UPDATE trip_events SET received_at = COALESCE(captured_at, received_at) WHERE trip_id = ?", o.trip_id);
    q.run("UPDATE trip_events SET captured_at = ? WHERE trip_id = ? AND to_status IN ('awaiting_acceptance')", T(-900), o.trip_id);
    q.run("UPDATE trip_events SET captured_at = ? WHERE trip_id = ? AND to_status IN ('awaiting_assignment')", T(-860), o.trip_id);
    q.run("UPDATE trip_events SET captured_at = ? WHERE trip_id = ? AND to_status IN ('assigned')", T(-840), o.trip_id);
    q.run("UPDATE trip_photos SET received_at = datetime(captured_at, '+20 seconds') WHERE trip_id = ?", o.trip_id);
    return { ...o, stops: stopRows, T };
  };

  // رحلة 1: 20,000 لتر إلى خزان الخرج قبل 12 يومًا
  const r1 = await runTrip({ date: day(-12), driver: 'drv_1', vehicle: 'veh_1', driverCtx: driver1, loaded: 20000,
    stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 20000 }], deliveries: [{ liters: 20000 }] });
  trips.confirmStop(receiver, r1.stops[0], { ack: 'confirmed', note: 'استلام مطابق لعداد الصهريج' });
  backdate(r1, 230);

  // تزويد المعدات من الخزان خلال الأيام التالية (عبر NFC)
  const meters = { ast_1: 4120, ast_2: 2210, ast_3: 3305, ast_4: 8840, ast_5: 48210, ast_6: 90310, ast_9: 1500 };
  const plan = [
    [-11, 'ast_1', 380, 9.5], [-11, 'ast_2', 240, 8], [-11, 'ast_4', 620, 21], [-11, 'ast_5', 70, 412],
    [-10, 'ast_1', 410, 10], [-10, 'ast_3', 260, 9], [-10, 'ast_6', 220, 340],
    [-9, 'ast_1', 395, 9.8], [-9, 'ast_2', 230, 7.5], [-9, 'ast_4', 640, 22], [-9, 'ast_5', 65, 380],
    [-8, 'ast_1', 420, 10.2], [-8, 'ast_3', 250, 8.5], [-8, 'ast_6', 240, 365],
    [-7, 'ast_1', 400, 9.9], [-7, 'ast_2', 250, 8.2], [-7, 'ast_4', 610, 20.5], [-7, 'ast_5', 72, 430],
    [-6, 'ast_1', 415, 10.1], [-6, 'ast_3', 255, 8.8], [-6, 'ast_4', 630, 21],
    [-5, 'ast_1', 405, 9.7], [-5, 'ast_2', 245, 8.1], [-5, 'ast_6', 235, 350], [-5, 'ast_5', 68, 401],
    [-4, 'ast_1', 590, 10], [-4, 'ast_4', 600, 20], [-4, 'ast_3', 240, 8],
  ];
  const tagOf = Object.fromEntries(q.all("SELECT asset_id, uid FROM nfc_tags WHERE company_id='co_cli1' AND status='active'").map((t) => [t.asset_id, t.uid]));
  let hourShift = 0;
  for (const [d, asset, liters, meterInc] of plan) {
    meters[asset] = +(meters[asset] + meterInc * (['ast_1', 'ast_2', 'ast_3'].includes(asset) ? 1.6 : 1)).toFixed(1);
    const at = new Date(day(d) + `T${String(7 + (hourShift++ % 9)).padStart(2, '0')}:${String((hourShift * 7) % 60).padStart(2, '0')}:00+03:00`).toISOString();
    const r = fuel.createFueling(supervisor, { client_op_id: uid('op_'), uid: tagOf[asset], verification: 'nfc', source_type: 'tank', source_id: 'tnk_1', quantity_liters: liters, meter_value: meters[asset], measure_source: 'pump_meter', captured_at: at });
    backdateFueling(r.id, at);
  }
  // استثناء: تحقق يدوي بديل لشريحة تالفة
  {
    const at = new Date(day(-3) + 'T09:20:00+03:00').toISOString();
    meters.ast_2 += 8;
    const r = fuel.createFueling(supervisor, { client_op_id: uid('op_'), asset_id: 'ast_2', verification: 'manual', source_type: 'tank', source_id: 'tnk_1', quantity_liters: 235, meter_value: meters.ast_2, captured_at: at });
    backdateFueling(r.id, at);
  }

  // رحلة 2: تزويد مباشر 5,000 لتر لمعدات الملقا قبل 3 أيام
  const r2 = await runTrip({ date: day(-3), driver: 'drv_2', vehicle: 'veh_3', driverCtx: driver2, loaded: 5000,
    stops: [{ site_id: 'sit_2', mode: 'direct', quantity_liters: 5000 }],
    deliveries: [{ liters: 5000, beforeDeliver: async (tripId, s) => {
      const b = q.get('SELECT id FROM fuel_batches WHERE trip_stop_id = ?', s.id);
      const at = new Date(day(-3) + 'T08:40:00+03:00').toISOString();
      const f1 = fuel.createFueling(supervisor, { client_op_id: uid('op_'), uid: tagOf.ast_7, source_type: 'batch', source_id: b.id, quantity_liters: 320, meter_value: 6120, captured_at: at });
      backdateFueling(f1.id, at);
      const at2 = new Date(day(-3) + 'T08:55:00+03:00').toISOString();
      const f2 = fuel.createFueling(supervisor, { client_op_id: uid('op_'), uid: tagOf.ast_8, source_type: 'batch', source_id: b.id, quantity_liters: 410, meter_value: 3310, captured_at: at2 });
      backdateFueling(f2.id, at2);
    } }] });
  trips.confirmStop(admin, r2.stops[0], { ack: 'confirmed', note: 'تزويد مباشر للمعدات - المتبقي في الدفعة المخصصة' });
  backdate(r2, 230);

  // رحلة 3: مسلّمة إلى خزان الخرج اليوم بانتظار تأكيد المستلم (فرق بسيط)
  const r3 = await runTrip({ date: day(-1), driver: 'drv_1', vehicle: 'veh_1', driverCtx: driver1, loaded: 18000,
    stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 18000 }], deliveries: [{ liters: 17940 }] });
  backdate(r3, null);

  // رحلة 4: مسندة للسائق الأول اليوم (لتجربة تطبيق السائق)
  const o4 = trips.createOrder(procure, { route_price_id: 'rp_c1_ryd', aramco_document_id: doc.id, date: day(0), window_start: '10:00', window_end: '20:00',
    stops: [{ site_id: 'sit_2', mode: 'tank', tank_id: 'tnk_2', quantity_liters: 12000 }], fuel_price_per_liter: 1.66 });
  trips.acceptTrip(dispatcher, o4.trip_id);
  trips.assignTrip(dispatcher, o4.trip_id, { vehicle_id: 'veh_2', driver_id: 'drv_2' });
  // رحلة 5: بانتظار قبول الناقل غدًا
  trips.createOrder(procure, { route_price_id: 'rp_c1_ryd', aramco_document_id: doc.id, date: day(1), window_start: '07:00', window_end: '13:00',
    stops: [{ site_id: 'sit_1', mode: 'direct', quantity_liters: 4500 }], fuel_price_per_liter: 1.66 });

  // جرد بفرق ينتظر الاعتماد
  inv.stockCount(supervisor, 'tnk_2', { measured_liters: 11935 });
  void finance;
}

function backdate(r, offsetMin) {
  const ids = q.all('SELECT id FROM trip_stops WHERE trip_id = ?', r.trip_id).map((s) => s.id);
  for (const id of ids) {
    q.run('UPDATE trip_stops SET delivered_at = ?, arrived_at = ? WHERE id = ?', r.T(212), r.T(170), id);
    if (offsetMin != null) q.run('UPDATE trip_stops SET receiver_ack_at = ? WHERE id = ?', r.T(offsetMin), id);
    q.run('UPDATE fuel_movements SET created_at = ?, effective_at = ? WHERE ref_type = ? AND ref_id = ?', r.T(offsetMin ?? 212), r.T(offsetMin ?? 212), 'trip_stop', id);
    q.run('UPDATE fuel_batches SET created_at = ? WHERE trip_stop_id = ?', r.T(offsetMin ?? 212), id);
  }
  q.run("UPDATE trip_events SET captured_at = ?, received_at = ? WHERE trip_id = ? AND (type LIKE 'receiver_%' OR to_status IN ('closed','under_review'))", r.T(offsetMin ?? 215), r.T(offsetMin ?? 215), r.trip_id);
  if (offsetMin != null) q.run('UPDATE trips SET closed_at = ? WHERE id = ? AND closed_at IS NOT NULL', r.T(offsetMin), r.trip_id);
}
function backdateFueling(id, at) {
  q.run('UPDATE fuelings SET created_at = ?, approved_at = ? WHERE id = ?', at, at, id);
  q.run('UPDATE fuel_movements SET created_at = ?, effective_at = ? WHERE ref_type = ? AND ref_id = ?', at, at, 'fueling', id);
  q.run("UPDATE audit_log SET at = ? WHERE entity = 'fueling' AND entity_id = ?", at, id);
  q.run("UPDATE nfc_tag_events SET at = ? WHERE reason = (SELECT number FROM fuelings WHERE id = ?)", at, id);
}

// تشغيل مباشر: npm run seed
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.env.HAJOOM_DB || path.join(ROOT, 'data', 'hajoom.db');
  for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  openDb(file);
  await seedDemo();
  q.run('DELETE FROM sessions');
  console.log('✓ تم إنشاء البيانات التجريبية. كلمة المرور لكل الحسابات:', DEMO_PASSWORD);
}
