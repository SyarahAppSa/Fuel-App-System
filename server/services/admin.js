// مركز تشغيل فيول آب: كل مؤشر = كيان + شرط واحد؛ نفس الاستعلام يحسب الرقم ويعرض سجلاته ويُصدَّر
import { q, now, HttpError, L } from '../db.js';
import { TRIP_STATUS_AR } from './trips.js';
import { PRODUCTS } from './documents.js';

/* ------------------------------------------------------------------ */
/* الفلاتر                                                              */
/* ------------------------------------------------------------------ */
const riyadhToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const startOfDay = (d) => new Date(d + 'T00:00:00+03:00').toISOString();
const endOfDay = (d) => new Date(d + 'T23:59:59.999+03:00').toISOString();
export function parseFilters(x = {}) {
  const t = riyadhToday();
  const period = x.period || 'month';
  let from, to;
  if (period === 'today') { from = startOfDay(t); to = endOfDay(t); }
  else if (period === '7d') { from = startOfDay(new Date(Date.now() - 6 * 864e5 + 3 * 3600e3).toISOString().slice(0, 10)); to = endOfDay(t); }
  else if (period === 'month') { from = startOfDay(t.slice(0, 8) + '01'); to = endOfDay(t); }
  else if (period === 'custom') { from = x.from ? startOfDay(x.from) : '0000'; to = x.to ? endOfDay(x.to) : '9999'; }
  else { from = '0000'; to = '9999'; }
  return { period, from, to, from_date: x.from || null, to_date: x.to || null, company_id: x.company_id || null, city: x.city || null, project_id: x.project_id || null, product: x.product || null, now: now() };
}
export const PERIOD_AR = { today: 'اليوم', '7d': 'آخر 7 أيام', month: 'هذا الشهر', custom: 'فترة محددة', all: 'كل الفترات' };

/* ------------------------------------------------------------------ */
/* الكيانات                                                             */
/* ------------------------------------------------------------------ */
const ACTIVE_EXEC = "('awaiting_assignment','assigned','to_loading','at_loading','loaded','to_delivery','at_site','on_hold')";
const ON_TRIP = "('assigned','to_loading','at_loading','loaded','to_delivery','at_site','on_hold')";
const CITY_O = '(SELECT st.city FROM trips t2 JOIN trip_stops s2 ON s2.trip_id = t2.id JOIN sites st ON st.id = s2.site_id WHERE t2.order_id = o.id LIMIT 1)';
const CITY_T = '(SELECT st.city FROM trip_stops s2 JOIN sites st ON st.id = s2.site_id WHERE s2.trip_id = t.id LIMIT 1)';

const ENT = {
  orders: {
    label: 'الطلبات',
    from: `FROM orders o JOIN companies cl ON cl.id = o.company_id LEFT JOIN companies ca ON ca.id = o.carrier_id LEFT JOIN projects p ON p.id = o.project_id`,
    select: `o.id, o.number, o.status, o.created_at, o.quantity_ml, o.product, o.transport_halalas, o.company_id, o.carrier_id, cl.name_ar client_name, ca.name_ar carrier_name, p.code project_code, ${CITY_O} city,
      (SELECT COUNT(*) FROM trips t WHERE t.order_id = o.id) trips_count, (SELECT COUNT(*) FROM order_offers f WHERE f.order_id = o.id) offers_count`,
    period: 'o.created_at', company: `(o.company_id = :c OR o.carrier_id = :c OR EXISTS (SELECT 1 FROM order_offers f WHERE f.order_id = o.id AND f.carrier_id = :c) OR EXISTS (SELECT 1 FROM supply_offers so WHERE so.order_id = o.id AND so.supplier_id = :c))`,
    city: CITY_O, project: 'o.project_id', product: 'o.product', order: 'o.created_at DESC',
    columns: [['number', 'رقم الطلب'], ['created_at', 'التاريخ', 'dt'], ['client_name', 'العميل'], ['carrier_name', 'الناقل المعتمد'], ['offers_count', 'ناقلون وصلهم'], ['trips_count', 'الرحلات'],
      ['quantity_ml', 'الكمية (لتر)', 'l'], ['product', 'المنتج', 'prod'], ['city', 'المدينة'], ['project_code', 'المشروع'], ['status_ar', 'الحالة'], ['transport_halalas', 'قيمة النقل (ر.س)', 'sar', 'finance']],
    link: (r) => `/admin/orders/${r.id}`,
  },
  trips: {
    label: 'الرحلات',
    from: `FROM trips t JOIN orders o ON o.id = t.order_id JOIN companies cl ON cl.id = t.company_id JOIN companies ca ON ca.id = t.carrier_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN projects p ON p.id = o.project_id`,
    select: `t.id, t.number, t.status, t.created_at, t.planned_end, t.window_end, t.delivered_at, t.loaded_ml, t.carrier_id, t.company_id, o.number order_number, o.id order_id, cl.name_ar client_name, ca.name_ar carrier_name,
      v.plate, d.name driver_name, d.phone driver_phone, p.code project_code, o.product, ${CITY_T} city,
      (SELECT COALESCE(SUM(requested_ml),0) FROM trip_stops WHERE trip_id = t.id) requested_ml, (SELECT SUM(delivered_ml) FROM trip_stops WHERE trip_id = t.id) delivered_ml,
      (SELECT COUNT(DISTINCT kind || COALESCE(stop_id,'')) FROM trip_photos WHERE trip_id = t.id) photos, (SELECT COUNT(*) FROM trip_stops WHERE trip_id = t.id) stops`,
    period: 't.created_at', company: '(t.company_id = :c OR (t.carrier_id = :c AND t.accepted_at IS NOT NULL))', city: CITY_T, project: 'o.project_id', product: 'o.product', order: 't.created_at DESC',
    columns: [['number', 'الرحلة'], ['order_number', 'الطلب'], ['created_at', 'التاريخ', 'dt'], ['client_name', 'العميل'], ['carrier_name', 'الناقل'], ['plate', 'الصهريج'], ['driver_name', 'السائق'],
      ['city', 'المدينة'], ['requested_ml', 'المطلوبة', 'l'], ['loaded_ml', 'المحملة', 'l'], ['delivered_ml', 'المسلّمة', 'l'], ['photos', 'الصور'], ['status_ar', 'الحالة']],
    link: (r) => `/trips/${r.id}`,
  },
  offers: {
    label: 'الطلبات الواردة للناقلين',
    from: `FROM order_offers f JOIN orders o ON o.id = f.order_id JOIN companies ca ON ca.id = f.carrier_id JOIN companies cl ON cl.id = o.company_id LEFT JOIN users u ON u.id = f.responded_by`,
    select: `f.id, f.status, f.sent_at, f.deadline, f.responded_at, f.reason, o.id order_id, o.number order_number, o.quantity_ml, o.product, cl.name_ar client_name, ca.name_ar carrier_name, f.carrier_id, u.name responded_by_name, ${CITY_O} city,
      CASE WHEN f.responded_at IS NOT NULL THEN ROUND((julianday(f.responded_at) - julianday(f.sent_at)) * 1440) END response_minutes`,
    period: 'f.sent_at', company: '(f.carrier_id = :c OR o.company_id = :c)', city: CITY_O, project: 'o.project_id', product: 'o.product', order: 'f.sent_at DESC',
    columns: [['order_number', 'الطلب'], ['sent_at', 'وصل في', 'dt'], ['carrier_name', 'الناقل'], ['client_name', 'العميل'], ['quantity_ml', 'الكمية', 'l'], ['offer_status_ar', 'الرد'], ['response_minutes', 'زمن الرد (دقيقة)'], ['responded_by_name', 'بواسطة'], ['reason', 'السبب']],
    link: (r) => `/admin/orders/${r.order_id}`,
  },
  companies: {
    label: 'الشركات',
    from: `FROM companies c`, base: "c.type <> 'platform'",
    select: `c.id, c.name_ar, c.type, c.status, c.city, c.cr_number, c.created_at,
      (SELECT COUNT(*) FROM drivers WHERE company_id = c.id) drivers, (SELECT COUNT(*) FROM vehicles WHERE company_id = c.id) vehicles,
      (SELECT COUNT(*) FROM company_documents WHERE company_id = c.id AND status = 'pending') pending_docs`,
    company: 'c.id = :c', city: 'c.city', order: "c.type, c.name_ar",
    columns: [['name_ar', 'الشركة'], ['type_ar', 'النوع'], ['city', 'المدينة'], ['status_ar', 'الحالة'], ['drivers', 'السائقون'], ['vehicles', 'الصهاريج'], ['pending_docs', 'وثائق معلقة']],
    link: (r) => `/admin/companies/${r.id}`,
  },
  drivers: {
    label: 'السائقون',
    from: `FROM drivers d JOIN companies c ON c.id = d.company_id`,
    select: `d.id, d.name, d.phone, d.status, d.license_no, d.license_expiry, c.name_ar company_name, c.city, d.company_id,
      (SELECT t.number FROM trips t WHERE t.driver_id = d.id AND t.status IN ${ON_TRIP} LIMIT 1) current_trip,
      (SELECT COUNT(*) FROM trips t WHERE t.driver_id = d.id AND t.status IN ('delivered','under_review','closed')) trips_done`,
    company: 'd.company_id = :c', city: 'c.city', order: 'c.name_ar, d.name',
    columns: [['name', 'السائق'], ['company_name', 'الشركة'], ['city', 'المنطقة'], ['phone', 'الجوال'], ['license_expiry', 'انتهاء الرخصة'], ['driver_state', 'الحالة'], ['current_trip', 'الرحلة الحالية'], ['trips_done', 'رحلات منفذة']],
    link: (r) => `/admin/companies/${r.company_id}`,
  },
  vehicles: {
    label: 'المركبات والصهاريج',
    from: `FROM vehicles v JOIN companies c ON c.id = v.company_id`,
    select: `v.id, v.plate, v.capacity_ml, v.products, v.status, v.docs_valid_until, c.name_ar company_name, c.city, v.company_id,
      (SELECT t.number FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ${ON_TRIP} LIMIT 1) current_trip`,
    company: 'v.company_id = :c', city: 'c.city', order: 'c.name_ar, v.plate',
    columns: [['plate', 'اللوحة'], ['company_name', 'الشركة'], ['city', 'المنطقة'], ['capacity_ml', 'السعة (لتر)', 'l'], ['docs_valid_until', 'صلاحية الوثائق'], ['vehicle_state', 'الحالة'], ['current_trip', 'الرحلة الحالية']],
    link: (r) => `/admin/companies/${r.company_id}`,
  },
  fuelings: {
    label: 'عمليات التزويد',
    from: `FROM fuelings f JOIN assets a ON a.id = f.asset_id JOIN companies cl ON cl.id = f.company_id LEFT JOIN sites st ON st.id = f.site_id LEFT JOIN projects p ON p.id = f.project_id
      LEFT JOIN users u ON u.id = f.operator_user_id LEFT JOIN tanks tk ON tk.id = f.tank_id LEFT JOIN trips t ON t.id = f.trip_id`,
    base: "f.status = 'approved'",
    select: `f.id, f.number, f.created_at, f.quantity_ml, f.company_id, f.verification, f.source_type, f.cost_halalas, f.product, a.code asset_code, a.name asset_name, cl.name_ar client_name, st.city, p.code project_code, u.name operator_name, tk.code tank_code, t.number trip_number`,
    period: 'f.created_at', company: 'f.company_id = :c', city: 'st.city', project: 'f.project_id', product: 'f.product', order: 'f.created_at DESC',
    columns: [['number', 'العملية'], ['created_at', 'الوقت', 'dt'], ['client_name', 'الشركة'], ['asset_code', 'المعدة'], ['quantity_ml', 'اللترات', 'l'], ['verification', 'التحقق'], ['source', 'المصدر'], ['project_code', 'المشروع'], ['operator_name', 'المشغّل'], ['cost_halalas', 'التكلفة (ر.س)', 'sar', 'finance']],
    link: (r) => `/admin/companies/${r.company_id}`,
  },
  exceptions: {
    label: 'الاستثناءات',
    from: `FROM exceptions e JOIN companies cl ON cl.id = e.company_id`,
    select: `e.id, e.type, e.title, e.status, e.ref_type, e.ref_id, e.created_at, e.details_json, cl.name_ar client_name, e.company_id`,
    period: 'e.created_at', company: 'e.company_id = :c', order: 'e.created_at DESC',
    columns: [['title', 'الاستثناء'], ['type_ar', 'النوع'], ['client_name', 'الشركة'], ['created_at', 'منذ', 'dt'], ['variance_l', 'الفرق (لتر)'], ['status_ar', 'الحالة']],
    link: (r) => (r.ref_type === 'trip' ? `/trips/${r.ref_id}` : r.ref_type === 'trip_stop' && r.trip_id ? `/trips/${r.trip_id}` : `/admin/companies/${r.company_id}`),
  },
  invoices: {
    label: 'الفواتير', finance: true,
    from: `FROM invoices i JOIN companies cl ON cl.id = i.client_id JOIN companies ca ON ca.id = i.carrier_id JOIN orders o ON o.id = i.order_id JOIN trips t ON t.id = i.trip_id`,
    select: `i.id, i.number, i.issued_at, i.due_at, i.total_halalas, i.paid_halalas, i.platform_fee_halalas, i.transport_halalas, i.vat_halalas, i.status, cl.name_ar client_name, ca.name_ar carrier_name, t.number trip_number, t.id trip_id, (i.total_halalas - i.paid_halalas) outstanding_halalas`,
    period: 'i.issued_at', company: '(i.client_id = :c OR i.carrier_id = :c)', city: CITY_T, project: 'o.project_id', product: 'o.product', order: 'i.issued_at DESC',
    columns: [['number', 'الفاتورة'], ['issued_at', 'الإصدار', 'dt'], ['client_name', 'العميل'], ['carrier_name', 'الناقل'], ['trip_number', 'الرحلة'], ['transport_halalas', 'النقل', 'sar'], ['platform_fee_halalas', 'عمولة المنصة', 'sar'],
      ['vat_halalas', 'الضريبة', 'sar'], ['total_halalas', 'الإجمالي', 'sar'], ['paid_halalas', 'المسدد', 'sar'], ['outstanding_halalas', 'المتبقي', 'sar'], ['invoice_status_ar', 'الحالة']],
    link: (r) => `/trips/${r.trip_id}`,
  },
  settlements: {
    label: 'مستحقات الناقلين', finance: true,
    from: `FROM carrier_settlements s JOIN companies ca ON ca.id = s.carrier_id JOIN trips t ON t.id = s.trip_id JOIN orders o ON o.id = t.order_id JOIN invoices i ON i.trip_id = s.trip_id`,
    select: `s.id, s.number, s.amount_halalas, s.status, s.due_at, s.paid_at, ca.name_ar carrier_name, t.number trip_number, t.id trip_id, i.issued_at`,
    period: 'i.issued_at', company: 's.carrier_id = :c', city: CITY_T, project: 'o.project_id', product: 'o.product', order: 's.due_at',
    columns: [['number', 'المستحق'], ['carrier_name', 'الناقل'], ['trip_number', 'الرحلة'], ['amount_halalas', 'المبلغ (ر.س)', 'sar'], ['due_at', 'الاستحقاق', 'dt'], ['settlement_status_ar', 'الحالة'], ['paid_at', 'السداد', 'dt']],
    link: (r) => `/trips/${r.trip_id}`,
  },
  supply: {
    label: 'عروض التوريد',
    from: `FROM supply_offers so JOIN companies su ON su.id = so.supplier_id JOIN companies cl ON cl.id = so.client_id LEFT JOIN companies ca ON ca.id = so.carrier_id LEFT JOIN orders o ON o.id = so.order_id`,
    select: `so.id, so.number, so.status, so.created_at, so.quantity_ml, so.product, so.fuel_price_halalas_per_l, so.invoiced_halalas, so.paid_halalas, su.name_ar supplier_name, cl.name_ar client_name, ca.name_ar carrier_name, o.number order_number, o.id order_id`,
    period: 'so.created_at', company: '(so.supplier_id = :c OR so.client_id = :c OR so.carrier_id = :c)', product: 'so.product', order: 'so.created_at DESC',
    columns: [['number', 'العرض'], ['created_at', 'التاريخ', 'dt'], ['supplier_name', 'المورد'], ['client_name', 'العميل'], ['quantity_ml', 'الكمية', 'l'], ['carrier_name', 'الناقل المرتبط'], ['order_number', 'الطلب'], ['supply_status_ar', 'الحالة'], ['invoiced_halalas', 'المفوتر', 'sar', 'finance'], ['paid_halalas', 'المسدد', 'sar', 'finance']],
    link: (r) => (r.order_id ? `/admin/orders/${r.order_id}` : null),
  },
  documents: {
    label: 'الوثائق',
    from: `FROM (SELECT 'company' kind, d.id, c.id company_id, c.name_ar company_name, c.city, d.doc_type label, d.number ref, d.expires_at, d.status FROM company_documents d JOIN companies c ON c.id = d.company_id
      UNION ALL SELECT 'vehicle', v.id, c.id, c.name_ar, c.city, 'وثائق الصهريج', v.plate, v.docs_valid_until, v.status FROM vehicles v JOIN companies c ON c.id = v.company_id
      UNION ALL SELECT 'driver', d.id, c.id, c.name_ar, c.city, 'رخصة السائق', d.name, d.license_expiry, d.status FROM drivers d JOIN companies c ON c.id = d.company_id) x`,
    select: `x.*`, company: 'x.company_id = :c', city: 'x.city', order: 'x.expires_at',
    columns: [['company_name', 'الشركة'], ['label_ar', 'الوثيقة'], ['ref', 'المرجع'], ['expires_at', 'تنتهي'], ['days_left', 'متبقٍ (يوم)']],
    link: (r) => `/admin/companies/${r.company_id}`,
  },
};

/* ------------------------------------------------------------------ */
/* المؤشرات: كيان + شرط (+ تجميع)                                        */
/* ------------------------------------------------------------------ */
const N = ':now';
const LATE_RESPONSE = `o.status = 'pending_carrier' AND NOT EXISTS (SELECT 1 FROM order_offers f WHERE f.order_id = o.id AND f.status = 'pending' AND f.deadline >= ${N})`;
const LATE_EXEC = `EXISTS (SELECT 1 FROM trips t WHERE t.order_id = o.id AND t.status IN ${ACTIVE_EXEC} AND t.planned_end < ${N})`;
const D30 = `strftime('%Y-%m-%d', ${N}, '+30 days')`;
export const METRICS = {
  'orders.total': { e: 'orders', label: 'إجمالي الطلبات', def: 'الطلبات المنشأة في الفترة — الطلب يُحسب مرة واحدة مهما كان عدد الناقلين أو الرحلات' },
  'orders.new': { e: 'orders', label: 'جديدة (آخر 24 ساعة)', w: `o.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', ${N}, '-1 day')` },
  'orders.pending': { e: 'orders', label: 'بانتظار رد الناقل', w: `o.status = 'pending_carrier' AND NOT (${LATE_RESPONSE})`, def: 'لم يقبلها ناقل بعد، ومهلة رد ناقل واحد على الأقل سارية' },
  'orders.accepted': { e: 'orders', label: 'مقبولة / قيد التنفيذ', w: "o.status IN ('accepted','in_progress')" },
  'orders.rejected': { e: 'orders', label: 'مرفوضة', w: "o.status = 'rejected'" },
  'orders.cancelled': { e: 'orders', label: 'ملغاة', w: "o.status = 'cancelled'" },
  'orders.late': { e: 'orders', label: 'متأخرة', w: `((${LATE_RESPONSE}) OR (${LATE_EXEC}))`, tone: 'bad', def: 'انتهت مهلة كل الناقلين دون قبول، أو رحلة لم تُسلَّم بعد نهاية نافذة التسليم' },
  'orders.completed': { e: 'orders', label: 'مكتملة', w: "o.status = 'completed'" },

  'trips.total': { e: 'trips', label: 'إجمالي الرحلات' },
  'trips.awaiting_acceptance': { e: 'trips', label: 'بانتظار قبول ناقل', w: "t.status = 'awaiting_acceptance'" },
  'trips.awaiting_assignment': { e: 'trips', label: 'بانتظار الإسناد', w: "t.status = 'awaiting_assignment'" },
  'trips.assigned': { e: 'trips', label: 'مسندة', w: "t.status = 'assigned'" },
  'trips.loading': { e: 'trips', label: 'في التحميل', w: "t.status IN ('to_loading','at_loading')" },
  'trips.en_route': { e: 'trips', label: 'في الطريق / في الموقع', w: "t.status IN ('loaded','to_delivery','at_site')" },
  'trips.delivered': { e: 'trips', label: 'مسلّمة', w: "t.status IN ('delivered','under_review','closed')" },
  'trips.late': { e: 'trips', label: 'متأخرة عن نافذة التسليم', w: `t.status IN ${ACTIVE_EXEC} AND t.planned_end < ${N}`, tone: 'bad' },
  'trips.variance': { e: 'trips', label: 'عليها فرق كمية', w: `EXISTS (SELECT 1 FROM exceptions e WHERE e.type = 'quantity_variance' AND ((e.ref_type = 'trip' AND e.ref_id = t.id) OR (e.ref_type = 'trip_stop' AND e.ref_id IN (SELECT id FROM trip_stops WHERE trip_id = t.id))))`, tone: 'warn' },
  'trips.missing_proof': { e: 'trips', label: 'توثيق ناقص', w: `t.status IN ('delivered','under_review','closed') AND (SELECT COUNT(DISTINCT kind || COALESCE(stop_id,'')) FROM trip_photos WHERE trip_id = t.id) < 2 + 2 * (SELECT COUNT(*) FROM trip_stops WHERE trip_id = t.id)`, tone: 'warn', def: 'رحلة مسلّمة تنقصها صورة من صور التحميل أو التفريغ' },

  'offers.received': { e: 'offers', label: 'طلبات واردة', def: 'كل طلب وصل الناقل يُحسب مرة واحدة له' },
  'offers.accepted': { e: 'offers', label: 'قبلها', w: "f.status = 'accepted'" },
  'offers.rejected': { e: 'offers', label: 'رفضها', w: "f.status = 'rejected'" },
  'offers.expired': { e: 'offers', label: 'انتهت مهلتها', w: `(f.status = 'expired' OR (f.status = 'pending' AND f.deadline < ${N}))`, tone: 'warn' },
  'offers.withdrawn': { e: 'offers', label: 'قبلها ناقل آخر', w: "f.status = 'withdrawn'" },
  'offers.pending': { e: 'offers', label: 'بانتظار رده', w: `f.status = 'pending' AND f.deadline >= ${N}` },
  'offers.avg_response': { e: 'offers', label: 'متوسط زمن الرد', w: 'f.responded_at IS NOT NULL', agg: 'ROUND(AVG((julianday(f.responded_at) - julianday(f.sent_at)) * 1440))', unit: 'دقيقة', nullable: true },

  'companies.all': { e: 'companies', label: 'كل الشركات' },
  'companies.clients': { e: 'companies', label: 'شركات عميلة', w: "c.type = 'client'" },
  'companies.carriers': { e: 'companies', label: 'شركات نقل', w: "c.type = 'carrier'" },
  'companies.suppliers': { e: 'companies', label: 'موردو وقود', w: "c.type = 'supplier'" },
  'companies.active': { e: 'companies', label: 'مفعّلة', w: "c.status = 'approved'" },
  'companies.pending': { e: 'companies', label: 'تنتظر الاعتماد', w: "c.status = 'pending'", tone: 'warn' },

  'drivers.total': { e: 'drivers', label: 'إجمالي السائقين' },
  'drivers.active': { e: 'drivers', label: 'نشطون', w: "d.status = 'active'" },
  'drivers.available': { e: 'drivers', label: 'متاحون الآن', w: `d.status = 'active' AND (d.license_expiry IS NULL OR d.license_expiry >= strftime('%Y-%m-%d', ${N})) AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = d.id AND t.status IN ${ON_TRIP})` },
  'drivers.on_trip': { e: 'drivers', label: 'مسندون على رحلات', w: `EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = d.id AND t.status IN ${ON_TRIP})` },
  'drivers.suspended': { e: 'drivers', label: 'موقوفون أو رخصة منتهية', w: `(d.status = 'suspended' OR d.license_expiry < strftime('%Y-%m-%d', ${N}))`, tone: 'warn' },

  'vehicles.total': { e: 'vehicles', label: 'إجمالي الصهاريج' },
  'vehicles.available': { e: 'vehicles', label: 'متاحة', w: `v.status = 'active' AND (v.docs_valid_until IS NULL OR v.docs_valid_until >= strftime('%Y-%m-%d', ${N})) AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ${ON_TRIP})` },
  'vehicles.busy': { e: 'vehicles', label: 'مشغولة برحلة', w: `EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ${ON_TRIP})` },
  'vehicles.down': { e: 'vehicles', label: 'صيانة / موقوفة / وثائق منتهية', w: `(v.status IN ('maintenance','suspended') OR v.docs_valid_until < strftime('%Y-%m-%d', ${N}))`, tone: 'warn' },
  'vehicles.capacity': { e: 'vehicles', label: 'السعة الإجمالية', agg: 'COALESCE(SUM(v.capacity_ml),0)', unit: 'لتر', fmt: 'l' },

  'fuel.requested': { e: 'orders', label: 'المطلوبة', w: "o.status NOT IN ('cancelled','rejected')", agg: 'COALESCE(SUM(o.quantity_ml),0)', unit: 'لتر', fmt: 'l' },
  'fuel.loaded': { e: 'trips', label: 'المحملة', w: 't.loaded_ml IS NOT NULL', agg: 'COALESCE(SUM(t.loaded_ml),0)', unit: 'لتر', fmt: 'l' },
  'fuel.delivered': { e: 'trips', label: 'المسلّمة', w: "t.status IN ('delivered','under_review','closed')", agg: 'COALESCE(SUM((SELECT SUM(delivered_ml) FROM trip_stops WHERE trip_id = t.id)),0)', unit: 'لتر', fmt: 'l' },
  'fuel.issued': { e: 'fuelings', label: 'المصروفة على المعدات', agg: 'COALESCE(SUM(f.quantity_ml),0)', unit: 'لتر', fmt: 'l' },
  'fuel.variances': { e: 'exceptions', label: 'فروقات تحتاج مراجعة', w: "e.type IN ('quantity_variance','stock_variance') AND e.status = 'open'", tone: 'warn', state: true },

  'finance.transport': { e: 'orders', label: 'قيمة النقل', w: "o.status NOT IN ('cancelled','rejected')", agg: 'COALESCE(SUM(o.transport_halalas),0)', unit: 'ر.س', fmt: 'sar', finance: true },
  'finance.invoiced': { e: 'invoices', label: 'المفوتر', agg: 'COALESCE(SUM(i.total_halalas),0)', unit: 'ر.س', fmt: 'sar', finance: true },
  'finance.paid': { e: 'invoices', label: 'المسدد', agg: 'COALESCE(SUM(i.paid_halalas),0)', unit: 'ر.س', fmt: 'sar', finance: true },
  'finance.outstanding': { e: 'invoices', label: 'المتبقي على العملاء', w: 'i.total_halalas > i.paid_halalas', agg: 'COALESCE(SUM(i.total_halalas - i.paid_halalas),0)', unit: 'ر.س', fmt: 'sar', finance: true, tone: 'warn' },
  'finance.carrier_due': { e: 'settlements', label: 'مستحقات الناقلين غير المسددة', w: "s.status = 'due'", agg: 'COALESCE(SUM(s.amount_halalas),0)', unit: 'ر.س', fmt: 'sar', finance: true },
  'finance.commission': { e: 'invoices', label: 'عمولة المنصة', agg: 'COALESCE(SUM(i.platform_fee_halalas),0)', unit: 'ر.س', fmt: 'sar', finance: true },

  'supply.received': { e: 'supply', label: 'عروض وردت' },
  'supply.accepted': { e: 'supply', label: 'مقبولة', w: "so.status IN ('accepted','delivered')" },
  'supply.delivered': { e: 'supply', label: 'منفذة', w: "so.status = 'delivered'" },
  'supply.liters': { e: 'supply', label: 'الكميات المقبولة', w: "so.status IN ('accepted','delivered')", agg: 'COALESCE(SUM(so.quantity_ml),0)', unit: 'لتر', fmt: 'l' },

  'docs.expiring': { e: 'documents', label: 'وثائق تنتهي خلال 30 يومًا أو منتهية', w: `x.expires_at IS NOT NULL AND x.expires_at <= ${D30} AND x.status NOT IN ('rejected')`, tone: 'warn' },
};

/* ------------------------------------------------------------------ */
/* بناء الاستعلام                                                       */
/* ------------------------------------------------------------------ */
function build(key, f, extra = {}) {
  const m = METRICS[key]; if (!m) throw new HttpError(400, 'مؤشر غير معروف');
  const e = ENT[m.e];
  const where = [];
  if (e.base) where.push(e.base);
  if (m.w) where.push(`(${m.w})`);
  if (e.period && !m.state && !extra.noPeriod) where.push(`${e.period} BETWEEN :from AND :to`);
  if (f.company_id && e.company) where.push(e.company);
  if (f.city && e.city) where.push(`${e.city} = :city`);
  if (f.project_id && e.project) where.push(`${e.project} = :project`);
  if (f.product && e.product) where.push(`${e.product} = :product`);
  if (extra.where) where.push(extra.where);
  const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const all = { now: f.now, from: f.from, to: f.to, c: f.company_id, city: f.city, project: f.project_id, product: f.product, ...(extra.params || {}) };
  const bind = (sql) => Object.fromEntries([...new Set([...sql.matchAll(/:([a-z_]+)/g)].map((x) => x[1]))].map((k) => [k, all[k] ?? null]));
  return { m, e, sqlWhere, bind };
}
const fmtCell = (v, t) => (v == null ? '' : t === 'l' ? L(v) : t === 'sar' ? v / 100 : v);

export function metricValue(key, f, extra) {
  const { m, e, sqlWhere, bind } = build(key, f, extra);
  const sql = `SELECT ${m.agg || 'COUNT(*)'} v ${e.from} ${sqlWhere}`;
  const v = q.get(sql, bind(sql)).v;
  return m.fmt === 'l' ? L(v) : m.fmt === 'sar' ? (v ?? 0) / 100 : v;
}
export function metricCount(key, f, extra) {
  const { e, sqlWhere, bind } = build(key, f, extra);
  const sql = `SELECT COUNT(*) v ${e.from} ${sqlWhere}`;
  return q.get(sql, bind(sql)).v;
}

const OFFER_AR = { pending: 'بانتظار الرد', accepted: 'قبل', rejected: 'رفض', withdrawn: 'قبله ناقل آخر', expired: 'انتهت المهلة' };
const ORDER_AR = { pending_carrier: 'بانتظار رد الناقل', accepted: 'مقبول', in_progress: 'قيد التنفيذ', completed: 'مكتمل', cancelled: 'ملغى', rejected: 'مرفوض' };
const EXC_AR = { quantity_variance: 'فرق كمية', missing_proof: 'إثبات ناقص', alt_verification: 'تحقق بديل', stock_variance: 'فرق جرد', offline_conflict: 'تعارض مزامنة', eligibility_change: 'تغير أهلية' };
const DOC_AR = { cr: 'السجل التجاري', vat: 'شهادة الضريبة', transport_license: 'ترخيص النقل', insurance: 'التأمين' };

/** إثراء الصف: الحالة بالعربي، أين توقف، ومن المسؤول عن المتابعة */
function enrich(ent, r, f) {
  const nowIso = f.now;
  if (ent === 'orders') {
    const late = q.get(`SELECT (${LATE_RESPONSE.replaceAll(N, '?')}) lr, (${LATE_EXEC.replaceAll(N, '?')}) le FROM orders o WHERE o.id = ?`, nowIso, nowIso, r.id);
    Object.assign(r, { status_ar: ORDER_AR[r.status] + (late.lr ? ' — انتهت مهلة الرد' : late.le ? ' — متأخر التنفيذ' : ''), late: !!(late.lr || late.le) }, orderResponsibility(r.id, nowIso));
  }
  if (ent === 'trips') Object.assign(r, { status_ar: TRIP_STATUS_AR[r.status] + (r.planned_end < nowIso && ACTIVE_EXEC.includes(`'${r.status}'`) ? ' — متأخرة' : '') }, tripResponsibility(r, nowIso));
  if (ent === 'offers') r.offer_status_ar = OFFER_AR[r.status === 'pending' && r.deadline < nowIso ? 'expired' : r.status];
  if (ent === 'companies') Object.assign(r, { type_ar: { client: 'عميل', carrier: 'ناقل', supplier: 'مورد' }[r.type], status_ar: { approved: 'مفعّلة', pending: 'تنتظر الاعتماد', suspended: 'موقوفة', rejected: 'مرفوضة' }[r.status] });
  if (ent === 'drivers') r.driver_state = r.status === 'suspended' ? 'موقوف' : r.license_expiry && r.license_expiry < nowIso.slice(0, 10) ? 'رخصة منتهية' : r.current_trip ? 'على رحلة' : 'متاح';
  if (ent === 'vehicles') r.vehicle_state = r.status === 'maintenance' ? 'صيانة' : r.status === 'suspended' ? 'موقوف' : r.docs_valid_until && r.docs_valid_until < nowIso.slice(0, 10) ? 'وثائق منتهية' : r.current_trip ? 'مشغول' : 'متاح';
  if (ent === 'fuelings') r.source = r.source_type === 'tank' ? `خزان ${r.tank_code}` : `مباشر ${r.trip_number || ''}`;
  if (ent === 'exceptions') {
    const d = JSON.parse(r.details_json || '{}'); delete r.details_json;
    Object.assign(r, { type_ar: EXC_AR[r.type] || r.type, status_ar: { open: 'مفتوح', approved: 'معتمد', rejected: 'مرفوض' }[r.status], variance_l: d.variance_ml != null ? L(d.variance_ml) : '', trip_id: d.trip_id || (r.ref_type === 'trip' ? r.ref_id : null) });
  }
  if (ent === 'invoices') r.invoice_status_ar = { issued: 'مصدرة', partially_paid: 'مسددة جزئيًا', paid: 'مسددة', void: 'ملغاة' }[r.status];
  if (ent === 'settlements') r.settlement_status_ar = r.status === 'paid' ? 'مسدد' : 'مستحق';
  if (ent === 'supply') r.supply_status_ar = { pending: 'بانتظار العميل', accepted: 'مقبول', rejected: 'مرفوض', delivered: 'منفذ', expired: 'منتهي' }[r.status];
  if (ent === 'documents') Object.assign(r, { label_ar: DOC_AR[r.label] || r.label, days_left: r.expires_at ? Math.round((new Date(r.expires_at) - new Date(nowIso.slice(0, 10))) / 864e5) : null });
  r.link = ENT[ent].link(r);
  return r;
}

function people(companyId, roles) {
  return q.all(`SELECT u.name, u.phone, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? AND m.active = 1 AND m.role IN (${roles.map(() => '?').join(',')})`, companyId, ...roles);
}
function followUp(type, id) {
  return q.get(`SELECT f.id, f.note, f.created_at, u.name assignee FROM follow_ups f LEFT JOIN users u ON u.id = f.assignee_user_id WHERE f.entity_type = ? AND f.entity_id = ? AND f.status = 'open' ORDER BY f.created_at DESC LIMIT 1`, type, id);
}
const lastEvent = (tripId) => q.get('SELECT MAX(received_at) at FROM trip_events WHERE trip_id = ?', tripId)?.at;

export function tripResponsibility(t, nowIso) {
  let stuck = TRIP_STATUS_AR[t.status], resp = '—';
  const carrierPeople = () => people(t.carrier_id, ['dispatcher', 'carrier_admin']).map((p) => `${p.name} (${p.phone || '—'})`).join('، ');
  if (t.status === 'awaiting_acceptance') { const o = q.get('SELECT order_id FROM trips WHERE id = ?', t.id); return { ...orderResponsibility(o.order_id, nowIso), since: lastEvent(t.id), follow_up: followUp('trip', t.id)?.assignee || null }; }
  if (t.status === 'awaiting_assignment') resp = `مسؤول الإسناد — ${t.carrier_name}: ${carrierPeople()}`;
  else if (['assigned', 'to_loading', 'at_loading', 'loaded', 'to_delivery', 'at_site', 'on_hold'].includes(t.status)) resp = `السائق ${t.driver_name || '—'} (${t.driver_phone || '—'}) · ${t.carrier_name}`;
  else if (t.status === 'delivered') { const s = q.get("SELECT receiver_name, receiver_phone FROM trip_stops WHERE trip_id = ? AND status = 'delivered' LIMIT 1", t.id); resp = `مستلم الموقع لدى ${t.client_name}: ${s?.receiver_name || '—'} (${s?.receiver_phone || '—'})`; }
  else if (t.status === 'under_review') resp = `مدير المشروع / الحساب لدى ${t.client_name}: ${people(t.company_id, ['project_manager', 'client_admin']).map((p) => p.name).join('، ')}`;
  return { stuck_at: stuck, responsible: resp, since: lastEvent(t.id), follow_up: followUp('trip', t.id)?.assignee || null };
}
export function orderResponsibility(orderId, nowIso) {
  const o = q.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (o.status === 'pending_carrier') {
    const offs = q.all('SELECT f.*, c.name_ar FROM order_offers f JOIN companies c ON c.id = f.carrier_id WHERE f.order_id = ?', orderId);
    const waiting = offs.filter((f) => f.status === 'pending');
    const resp = waiting.map((f) => `${f.name_ar}: ${people(f.carrier_id, ['dispatcher', 'carrier_admin']).map((p) => p.name).join('، ')}${f.deadline < nowIso ? ' (انتهت مهلته)' : ''}`).join(' | ');
    return { stuck_at: waiting.some((f) => f.deadline >= nowIso) ? 'بانتظار رد الناقل' : 'انتهت مهلة رد كل الناقلين', responsible: (resp || 'لا يوجد ناقل بانتظار الرد') + ' · متابعة: عمليات فيول آب', follow_up: followUp('order', orderId)?.assignee || null, since: o.created_at };
  }
  const t = q.get(`SELECT t.*, ca.name_ar carrier_name, cl.name_ar client_name, d.name driver_name, d.phone driver_phone FROM trips t JOIN companies ca ON ca.id = t.carrier_id JOIN companies cl ON cl.id = t.company_id LEFT JOIN drivers d ON d.id = t.driver_id
      WHERE t.order_id = ? AND t.status NOT IN ('closed','cancelled','rejected')
      ORDER BY (t.status IN ${ACTIVE_EXEC} AND t.planned_end < ?) DESC, (t.status IN ${ACTIVE_EXEC}) DESC, t.number LIMIT 1`, orderId, nowIso); // الرحلة المتأخرة أولًا
  if (!t) return { stuck_at: ORDER_AR[o.status], responsible: '—', follow_up: followUp('order', orderId)?.assignee || null, since: o.created_at };
  const r = tripResponsibility(t, nowIso);
  return { ...r, stuck_at: `${t.number}: ${r.stuck_at}`, follow_up: followUp('order', orderId)?.assignee || r.follow_up };
}

/** قائمة السجلات التي كوّنت المؤشر — بنفس الفلتر ونفس الشرط */
export function records(key, f, { limit = 500, finance = false, extra } = {}) {
  const { m, e, sqlWhere, bind } = build(key, f, extra);
  const total = q.get(`SELECT COUNT(*) v ${e.from} ${sqlWhere}`, bind(`${e.from} ${sqlWhere}`)).v;
  const sql = `SELECT ${e.select} ${e.from} ${sqlWhere} ORDER BY ${e.order} LIMIT ${Math.min(Number(limit) || 500, 5000)}`;
  const rows = q.all(sql, bind(sql)).map((r) => enrich(m.e, r, f));
  const extraCols = ['orders', 'trips'].includes(m.e) ? [['stuck_at', 'توقفت عند'], ['responsible', 'المسؤول عن المتابعة'], ['follow_up', 'المتابع المعيَّن']] : [];
  // للطلبات والرحلات: الحالة وأين توقف والمسؤول بجانب الرقم مباشرة
  const base = extraCols.length ? [e.columns[0], ...e.columns.filter((c) => c[0] === 'status_ar'), ...extraCols, ...e.columns.slice(1).filter((c) => c[0] !== 'status_ar')] : e.columns;
  const columns = base.filter((c) => finance || c[3] !== 'finance');
  return { metric: key, label: m.label, entity: m.e, entity_label: e.label, def: m.def || null, value: metricValue(key, f, extra), unit: m.unit || null, total, columns, rows };
}

/* ------------------------------------------------------------------ */
/* الصفحة الرئيسية للأدمن                                                */
/* ------------------------------------------------------------------ */
const SECTIONS = [
  ['orders', 'الطلبات', ['orders.total', 'orders.new', 'orders.pending', 'orders.accepted', 'orders.rejected', 'orders.cancelled', 'orders.late', 'orders.completed']],
  ['trips', 'الرحلات', ['trips.awaiting_assignment', 'trips.assigned', 'trips.loading', 'trips.en_route', 'trips.delivered', 'trips.late', 'trips.variance', 'trips.missing_proof']],
  ['companies', 'الشركات', ['companies.clients', 'companies.carriers', 'companies.suppliers', 'companies.active', 'companies.pending']],
  ['drivers', 'السائقون', ['drivers.total', 'drivers.active', 'drivers.available', 'drivers.on_trip', 'drivers.suspended']],
  ['vehicles', 'المركبات والصهاريج', ['vehicles.total', 'vehicles.available', 'vehicles.busy', 'vehicles.down', 'vehicles.capacity']],
  ['fuel', 'الوقود', ['fuel.requested', 'fuel.loaded', 'fuel.delivered', 'fuel.issued', 'fuel.variances']],
  ['finance', 'المالية', ['finance.transport', 'finance.invoiced', 'finance.paid', 'finance.outstanding', 'finance.carrier_due', 'finance.commission']],
];

export function home(ctx, f) {
  const fin = ctx.can('platform.finance');
  const sections = SECTIONS.map(([key, title, ms]) => ({
    key, title,
    restricted: key === 'finance' && !fin,
    metrics: key === 'finance' && !fin ? [] : ms.map((k) => ({ key: k, label: METRICS[k].label, value: metricValue(k, f), unit: METRICS[k].unit || null, tone: METRICS[k].tone || null, def: METRICS[k].def || null, state: !!METRICS[k].state || ['companies', 'drivers', 'vehicles', 'documents'].includes(METRICS[k].e) })),
  }));
  const capacity = q.all(`SELECT c.id, c.name_ar company, c.city region, COUNT(v.id) vehicles, COALESCE(SUM(v.capacity_ml),0) capacity_ml,
      COALESCE(SUM(CASE WHEN v.status = 'active' AND (v.docs_valid_until IS NULL OR v.docs_valid_until >= ?) AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.status IN ${ON_TRIP}) THEN v.capacity_ml END),0) available_ml
      FROM companies c LEFT JOIN vehicles v ON v.company_id = c.id WHERE c.type = 'carrier'` + (f.company_id ? ' AND c.id = ?' : '') + (f.city ? ' AND c.city = ?' : '') + ' GROUP BY c.id ORDER BY capacity_ml DESC',
    ...[f.now.slice(0, 10), f.company_id, f.city].filter(Boolean)).map((r) => ({ ...r, capacity_l: L(r.capacity_ml), available_l: L(r.available_ml) }));
  return { generated_at: now(), filters: f, period_ar: PERIOD_AR[f.period], sections, capacity, attention: attention(f), supply_connected: q.get("SELECT COUNT(*) n FROM companies WHERE type='supplier'").n > 0 };
}

/** «تحتاج تدخل»: طلبات بلا رد، رحلات متأخرة، فروقات كميات، وثائق قاربت الانتهاء — لا تتقيد بالفترة */
export function attention(f) {
  const ff = { ...f };
  const items = [];
  for (const r of records('orders.late', ff, { extra: { noPeriod: true, where: LATE_RESPONSE.replaceAll(N, ':now') } }).rows)
    items.push({ kind: 'no_response', icon: 'order', title: `الطلب ${r.number} بلا رد ناقل`, sub: `${r.client_name} · ${L(r.quantity_ml)} لتر`, since: r.since, responsible: r.responsible, follow_up: r.follow_up, link: r.link, entity_type: 'order', entity_id: r.id });
  for (const r of records('trips.late', ff, { extra: { noPeriod: true } }).rows)
    items.push({ kind: 'late_trip', icon: 'trip', title: `الرحلة ${r.number} متأخرة — ${r.stuck_at}`, sub: `${r.client_name} ← ${r.carrier_name}`, since: r.planned_end, responsible: r.responsible, follow_up: r.follow_up, link: r.link, entity_type: 'trip', entity_id: r.id });
  for (const r of records('fuel.variances', ff).rows)
    items.push({ kind: 'variance', icon: 'variance', title: r.title, sub: r.client_name, since: r.created_at, responsible: `مدير المشروع / الحساب لدى ${r.client_name}`, link: r.link, entity_type: r.trip_id ? 'trip' : null, entity_id: r.trip_id });
  for (const r of records('docs.expiring', ff).rows)
    items.push({ kind: 'document', icon: 'doc', title: `${r.label_ar} — ${r.ref} (${r.company_name})`, sub: r.days_left < 0 ? `منتهية منذ ${-r.days_left} يوم` : `تنتهي خلال ${r.days_left} يوم`, since: r.expires_at, responsible: `مدير ${r.company_name}`, link: r.link, entity_type: 'company', entity_id: r.company_id, tone: r.days_left < 0 ? 'bad' : 'warn' });
  return items;
}

/* ------------------------------------------------------------------ */
/* صفحة الشركة                                                          */
/* ------------------------------------------------------------------ */
const COMPANY_METRICS = {
  carrier: [['الطلبات الواردة', ['offers.received', 'offers.accepted', 'offers.rejected', 'offers.expired', 'offers.withdrawn', 'offers.pending', 'offers.avg_response']],
    ['الرحلات', ['trips.total', 'trips.awaiting_assignment', 'trips.assigned', 'trips.en_route', 'trips.delivered', 'trips.late']],
    ['السائقون والصهاريج', ['drivers.total', 'drivers.available', 'drivers.on_trip', 'drivers.suspended', 'vehicles.total', 'vehicles.available', 'vehicles.busy', 'vehicles.down']],
    ['المستحقات', ['finance.invoiced', 'finance.carrier_due']]],
  client: [['الطلبات والرحلات', ['orders.total', 'orders.pending', 'orders.accepted', 'orders.completed', 'orders.cancelled', 'orders.late', 'trips.delivered']],
    ['الوقود', ['fuel.requested', 'fuel.delivered', 'fuel.issued', 'fuel.variances']],
    ['المالية', ['finance.transport', 'finance.invoiced', 'finance.paid', 'finance.outstanding']]],
  supplier: [['التوريد', ['supply.received', 'supply.accepted', 'supply.delivered', 'supply.liters']]],
};

export function companyProfile(ctx, id, f0) {
  const c = q.get("SELECT * FROM companies WHERE id = ? AND type <> 'platform'", id);
  if (!c) throw new HttpError(404, 'الشركة غير موجودة');
  const f = { ...f0, company_id: id };
  const fin = ctx.can('platform.finance');
  const groups = (COMPANY_METRICS[c.type] || []).map(([title, ms]) => ({ title, metrics: ms.filter((k) => fin || !METRICS[k].finance).map((k) => ({ key: k, label: METRICS[k].label, value: metricValue(k, f), unit: METRICS[k].unit || null, tone: METRICS[k].tone || null })) })).filter((g) => g.metrics.length);
  const out = { company: c, filters: f, period_ar: PERIOD_AR[f.period], groups, generated_at: now() };
  out.documents = q.all('SELECT * FROM company_documents WHERE company_id = ? ORDER BY expires_at', id).map((d) => ({ ...d, label: DOC_AR[d.doc_type] || d.doc_type }));
  out.members = q.all('SELECT u.name, u.email, u.phone, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ?', id);
  if (c.type === 'carrier') {
    const deliveredWin = q.all(`SELECT t.delivered_at, t.window_end FROM trips t WHERE t.carrier_id = ? AND t.delivered_at IS NOT NULL AND t.window_end IS NOT NULL AND t.created_at BETWEEN ? AND ?`, id, f.from, f.to);
    out.on_time = { pct: deliveredWin.length ? Math.round(deliveredWin.filter((x) => x.delivered_at <= x.window_end).length / deliveredWin.length * 100) : null, sample: deliveredWin.length };
    out.drivers = records('drivers.total', f).rows; out.vehicles = records('vehicles.total', f).rows;
    out.coverage = q.all("SELECT cc.kind, COALESCE(lp.name, cc.ref) label FROM carrier_coverage cc LEFT JOIN loading_points lp ON lp.id = cc.ref WHERE cc.carrier_id = ?", id);
    out.prices = q.all('SELECT rp.*, lp.name loading_point_name FROM route_prices rp JOIN loading_points lp ON lp.id = rp.loading_point_id WHERE rp.carrier_id = ?', id).map((p) => (fin ? p : { ...p, price_halalas: null }));
    out.contracts = q.all("SELECT c.number, c.type, c.status, c.start_date, c.end_date, cl.name_ar client_name FROM contracts c JOIN companies cl ON cl.id = c.client_id WHERE c.carrier_id = ?", id);
  }
  if (c.type === 'client') {
    out.by_project = q.all(`SELECT p.id, p.code, p.name, (SELECT COUNT(*) FROM orders o WHERE o.project_id = p.id AND o.created_at BETWEEN ? AND ?) orders,
        (SELECT COALESCE(SUM(f.quantity_ml),0) FROM fuelings f WHERE f.project_id = p.id AND f.status = 'approved' AND f.created_at BETWEEN ? AND ?) issued_ml,
        (SELECT COALESCE(SUM(o.transport_halalas),0) FROM orders o WHERE o.project_id = p.id AND o.status NOT IN ('cancelled','rejected') AND o.created_at BETWEEN ? AND ?) transport_halalas,
        (SELECT COALESCE(SUM(f.cost_halalas),0) FROM fuelings f WHERE f.project_id = p.id AND f.status = 'approved' AND f.created_at BETWEEN ? AND ?) fuel_cost_halalas
      FROM projects p WHERE p.company_id = ?`, f.from, f.to, f.from, f.to, f.from, f.to, f.from, f.to, id).map((p) => (fin ? p : { ...p, transport_halalas: null, fuel_cost_halalas: null }));
    out.carriers = q.all(`SELECT ca.id, ca.name_ar, COUNT(*) trips FROM trips t JOIN companies ca ON ca.id = t.carrier_id WHERE t.company_id = ? AND t.status NOT IN ('cancelled','rejected','awaiting_acceptance') AND t.created_at BETWEEN ? AND ? GROUP BY ca.id ORDER BY trips DESC`, id, f.from, f.to);
    out.tanks = q.all('SELECT t.id, t.code, t.name, t.capacity_ml, (SELECT COALESCE(SUM(quantity_ml),0) FROM fuel_movements WHERE tank_id = t.id AND status = \'approved\') book_ml FROM tanks t WHERE t.company_id = ?', id);
    out.assets = q.get("SELECT COUNT(*) total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) active FROM assets WHERE company_id = ?", id);
    out.tags = q.all('SELECT status, COUNT(*) n FROM nfc_tags WHERE company_id = ? GROUP BY status', id);
    out.contracts = q.all("SELECT c.number, c.type, c.status, c.start_date, c.end_date, ca.name_ar carrier_name FROM contracts c JOIN companies ca ON ca.id = c.carrier_id WHERE c.client_id = ?", id);
    out.packages = q.all("SELECT number, total_trips, status, expiry_date FROM trip_packages WHERE client_id = ?", id);
  }
  if (c.type === 'supplier') out.supply = records('supply.received', f, { finance: fin }).rows;
  return out;
}

/* ------------------------------------------------------------------ */
/* البحث الموحد وتفاصيل الطلب                                            */
/* ------------------------------------------------------------------ */
export function search(term) {
  const t = `%${String(term || '').trim()}%`;
  if (t.length < 4) return [];
  const orders = q.all(`SELECT DISTINCT o.id, o.number, o.status, o.created_at, cl.name_ar client_name, ca.name_ar carrier_name FROM orders o JOIN companies cl ON cl.id = o.company_id LEFT JOIN companies ca ON ca.id = o.carrier_id
      LEFT JOIN trips t ON t.order_id = o.id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
      WHERE o.number LIKE ? OR t.number LIKE ? OR v.plate LIKE ? OR cl.name_ar LIKE ? OR ca.name_ar LIKE ? OR d.name LIKE ? ORDER BY o.created_at DESC LIMIT 50`, t, t, t, t, t, t)
    .map((o) => ({ ...o, kind: 'order', status_ar: ORDER_AR[o.status], link: `/admin/orders/${o.id}`, trips: q.all('SELECT t.id, t.number, t.status, v.plate, d.name driver_name FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id WHERE t.order_id = ?', o.id).map((x) => ({ ...x, status_ar: TRIP_STATUS_AR[x.status] })) }));
  const companies = q.all("SELECT id, name_ar, type FROM companies WHERE type <> 'platform' AND (name_ar LIKE ? OR name_en LIKE ?) LIMIT 10", t, t).map((c) => ({ ...c, kind: 'company', link: `/admin/companies/${c.id}` }));
  const drivers = q.all('SELECT d.id, d.name, d.phone, c.id company_id, c.name_ar company_name FROM drivers d JOIN companies c ON c.id = d.company_id WHERE d.name LIKE ? OR d.phone LIKE ? LIMIT 10', t, t).map((d) => ({ ...d, kind: 'driver', link: `/admin/companies/${d.company_id}` }));
  const vehicles = q.all('SELECT v.id, v.plate, c.id company_id, c.name_ar company_name FROM vehicles v JOIN companies c ON c.id = v.company_id WHERE v.plate LIKE ? LIMIT 10', t).map((v) => ({ ...v, kind: 'vehicle', link: `/admin/companies/${v.company_id}` }));
  return { orders, companies, drivers, vehicles };
}

export function orderDetail(ctx, id) {
  const o = q.get(`SELECT o.*, cl.name_ar client_name, ca.name_ar carrier_name, p.code project_code, p.name project_name, lp.name loading_point_name, ad.doc_number, ad.file_id doc_file_id, u.name created_by_name
      FROM orders o JOIN companies cl ON cl.id = o.company_id LEFT JOIN companies ca ON ca.id = o.carrier_id LEFT JOIN projects p ON p.id = o.project_id
      JOIN loading_points lp ON lp.id = o.loading_point_id LEFT JOIN aramco_documents ad ON ad.id = o.aramco_document_id LEFT JOIN users u ON u.id = o.created_by WHERE o.id = ?`, id);
  if (!o) throw new HttpError(404, 'الطلب غير موجود');
  const fin = ctx.can('platform.finance');
  const nowIso = now();
  const offers = q.all(`SELECT f.*, c.name_ar carrier_name, u.name responded_by_name FROM order_offers f JOIN companies c ON c.id = f.carrier_id LEFT JOIN users u ON u.id = f.responded_by WHERE f.order_id = ? ORDER BY f.sent_at`, id)
    .map((f) => ({ ...f, status: f.status === 'pending' && f.deadline < nowIso ? 'expired' : f.status, status_ar: OFFER_AR[f.status === 'pending' && f.deadline < nowIso ? 'expired' : f.status], quote: fin ? JSON.parse(f.quote_json || 'null') : null, quote_json: undefined,
      response_minutes: f.responded_at ? Math.round((new Date(f.responded_at) - new Date(f.sent_at)) / 60000) : null }));
  const trips = q.all(`SELECT t.*, v.plate, d.name driver_name, d.phone driver_phone FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id WHERE t.order_id = ? ORDER BY t.number`, id)
    .map((t) => ({ ...t, status_ar: TRIP_STATUS_AR[t.status], stops: q.all('SELECT s.*, st.name site_name, st.city FROM trip_stops s JOIN sites st ON st.id = s.site_id WHERE s.trip_id = ?', t.id),
      photos: q.get('SELECT COUNT(DISTINCT kind || COALESCE(stop_id,\'\')) n FROM trip_photos WHERE trip_id = ?', t.id).n }));
  const history = q.all(`SELECT e.*, t.number trip_number, u.name actor_name FROM trip_events e JOIN trips t ON t.id = e.trip_id LEFT JOIN users u ON u.id = e.actor_user_id WHERE t.order_id = ? AND (e.to_status IS NOT NULL OR e.type LIKE 'receiver_%') ORDER BY e.id`, id)
    .map((e) => ({ ...e, to_ar: e.to_status ? TRIP_STATUS_AR[e.to_status] : e.type === 'receiver_confirmed' ? 'تأكيد المستلم' : 'اعتراض المستلم' }));
  const follow = q.all(`SELECT f.*, u.name assignee, c.name created_by_name FROM follow_ups f LEFT JOIN users u ON u.id = f.assignee_user_id LEFT JOIN users c ON c.id = f.created_by WHERE (f.entity_type = 'order' AND f.entity_id = ?) OR (f.entity_type = 'trip' AND f.entity_id IN (SELECT id FROM trips WHERE order_id = ?)) ORDER BY f.created_at DESC`, id, id);
  return { ...o, price: fin ? JSON.parse(o.price_snapshot_json || 'null') : null, price_snapshot_json: undefined, transport_halalas: fin ? o.transport_halalas : null, fuel_price_halalas_per_l: fin ? o.fuel_price_halalas_per_l : null,
    status_ar: ORDER_AR[o.status], offers, trips, history, follow_ups: follow, ...orderResponsibility(id, nowIso) };
}

/* ------------------------------------------------------------------ */
/* التقارير                                                             */
/* ------------------------------------------------------------------ */
export const REPORTS = {
  orders: { title: 'تقرير الطلبات', metric: 'orders.total' },
  carriers: { title: 'أداء الناقلين', custom: true },
  drivers: { title: 'السائقون', metric: 'drivers.total' },
  vehicles: { title: 'الصهاريج والمركبات', metric: 'vehicles.total' },
  documentation: { title: 'توثيق التحميل والتفريغ', metric: 'trips.delivered' },
  fuel: { title: 'كميات الوقود وفروقاتها', custom: true },
  fuelings: { title: 'المخزون والتزويد عبر NFC', metric: 'fuel.issued' },
  invoices: { title: 'الفواتير والمالية', metric: 'finance.invoiced', finance: true },
  settlements: { title: 'مستحقات الناقلين', metric: 'finance.carrier_due', finance: true },
  contracts: { title: 'العقود والباقات', custom: true },
  exceptions: { title: 'الاستثناءات', custom: true },
};

export function report(ctx, key, f) {
  const r = REPORTS[key]; if (!r) throw new HttpError(404, 'تقرير غير معروف');
  const fin = ctx.can('platform.finance');
  if (r.finance && !fin) throw new HttpError(403, 'هذا التقرير يتطلب صلاحية المالية');
  if (!r.custom) { const x = records(r.metric, f, { limit: 5000, finance: fin }); return { key, title: r.title, ...x }; }
  if (key === 'carriers') {
    const carriers = q.all("SELECT id, name_ar, city FROM companies WHERE type = 'carrier'" + (f.company_id ? ' AND id = ?' : '') + (f.city ? ' AND city = ?' : ''), ...[f.company_id, f.city].filter(Boolean));
    const rows = carriers.map((c) => {
      const ff = { ...f, company_id: c.id };
      const win = q.all(`SELECT delivered_at, window_end FROM trips WHERE carrier_id = ? AND delivered_at IS NOT NULL AND window_end IS NOT NULL AND created_at BETWEEN ? AND ?`, c.id, f.from, f.to);
      return { id: c.id, name_ar: c.name_ar, city: c.city, received: metricValue('offers.received', ff), accepted: metricValue('offers.accepted', ff), rejected: metricValue('offers.rejected', ff),
        expired: metricValue('offers.expired', ff), avg_response: metricValue('offers.avg_response', ff), executed: metricValue('trips.delivered', ff), late: metricValue('trips.late', ff),
        on_time: win.length ? Math.round(win.filter((x) => x.delivered_at <= x.window_end).length / win.length * 100) : null, sample: win.length,
        drivers: metricValue('drivers.total', ff), vehicles: metricValue('vehicles.total', ff), link: `/admin/companies/${c.id}` };
    });
    return { key, title: r.title, columns: [['name_ar', 'الناقل'], ['city', 'المنطقة'], ['received', 'طلبات واردة'], ['accepted', 'قبل'], ['rejected', 'رفض'], ['expired', 'انتهت مهلته'], ['avg_response', 'متوسط الرد (دقيقة)'],
      ['executed', 'رحلات منفذة'], ['late', 'متأخرة'], ['on_time', 'في الموعد %'], ['sample', 'عينة'], ['drivers', 'سائقون'], ['vehicles', 'صهاريج']], rows, total: rows.length };
  }
  if (key === 'fuel') {
    const x = records('fuel.loaded', f, { limit: 5000 });
    const rows = x.rows.map((t) => ({ ...t, variance_ml: t.delivered_ml != null && t.loaded_ml != null ? t.loaded_ml - t.delivered_ml : null,
      reason: q.get(`SELECT COALESCE(receiver_note, '') n FROM trip_stops WHERE trip_id = ? AND receiver_note IS NOT NULL LIMIT 1`, t.id)?.n || '' }));
    return { key, title: r.title, columns: [['number', 'الرحلة'], ['order_number', 'الطلب'], ['client_name', 'العميل'], ['carrier_name', 'الناقل'], ['requested_ml', 'المطلوبة', 'l'], ['loaded_ml', 'المحملة', 'l'], ['delivered_ml', 'المسلّمة', 'l'], ['variance_ml', 'الفرق', 'l'], ['reason', 'سبب الفرق / ملاحظة المستلم'], ['status_ar', 'الحالة']],
      rows, total: rows.length, summary: [['المطلوبة', metricValue('fuel.requested', f)], ['المحملة', metricValue('fuel.loaded', f)], ['المسلّمة', metricValue('fuel.delivered', f)], ['المصروفة', metricValue('fuel.issued', f)]] };
  }
  if (key === 'contracts') {
    const rows = q.all(`SELECT 'عقد' kind, c.number, cl.name_ar client_name, ca.name_ar carrier_name, c.type sub, c.status, c.start_date, c.end_date FROM contracts c JOIN companies cl ON cl.id = c.client_id JOIN companies ca ON ca.id = c.carrier_id
        WHERE (? IS NULL OR c.client_id = ? OR c.carrier_id = ?)
      UNION ALL SELECT 'باقة', p.number, cl.name_ar, ca.name_ar, p.total_trips || ' رحلة', p.status, p.start_date, p.expiry_date FROM trip_packages p JOIN companies cl ON cl.id = p.client_id JOIN companies ca ON ca.id = p.carrier_id WHERE (? IS NULL OR p.client_id = ? OR p.carrier_id = ?)
      UNION ALL SELECT 'حجز سعة', r.number, cl.name_ar, ca.name_ar, r.trips || ' رحلة · ' || r.delivery_city, r.status, r.period_start, r.period_end FROM capacity_reservations r JOIN companies cl ON cl.id = r.client_id JOIN companies ca ON ca.id = r.carrier_id WHERE (? IS NULL OR r.client_id = ? OR r.carrier_id = ?)`,
      ...Array(9).fill(f.company_id)).map((x) => ({ ...x, sub: { monthly: 'شهري', annual: 'سنوي' }[x.sub] || x.sub }));
    return { key, title: r.title, columns: [['kind', 'النوع'], ['number', 'الرقم'], ['client_name', 'العميل'], ['carrier_name', 'الناقل'], ['sub', 'التفاصيل'], ['status', 'الحالة'], ['start_date', 'من'], ['end_date', 'إلى']], rows, total: rows.length };
  }
  if (key === 'exceptions') {
    const x = records('fuel.variances', { ...f }, { limit: 5000, extra: { where: '1=1' } });
    const all = q.all(`SELECT e.id, e.type, e.title, e.status, e.ref_type, e.ref_id, e.created_at, e.details_json, cl.name_ar client_name, e.company_id, u.name decided_by_name, e.decision_reason FROM exceptions e JOIN companies cl ON cl.id = e.company_id LEFT JOIN users u ON u.id = e.decided_by
        WHERE e.created_at BETWEEN ? AND ?` + (f.company_id ? ' AND e.company_id = ?' : '') + ' ORDER BY e.created_at DESC', ...[f.from, f.to, f.company_id].filter(Boolean)).map((e) => enrich('exceptions', e, f));
    void x;
    return { key, title: r.title, columns: [['title', 'الاستثناء'], ['type_ar', 'النوع'], ['client_name', 'الشركة'], ['created_at', 'التاريخ', 'dt'], ['variance_l', 'الفرق (لتر)'], ['status_ar', 'الحالة'], ['decided_by_name', 'القرار بواسطة'], ['decision_reason', 'السبب']], rows: all, total: all.length };
  }
}

/** تقرير الشركة للتصدير: نفس أرقام الصفحة ونفس الفلتر */
export function companyReport(ctx, id, f) {
  const p = companyProfile(ctx, id, f);
  const fin = ctx.can('platform.finance');
  const lists = p.company.type === 'carrier'
    ? [records('offers.received', p.filters, { limit: 5000, finance: fin }), records('trips.total', p.filters, { limit: 5000, finance: fin }), records('drivers.total', p.filters, { finance: fin }), records('vehicles.total', p.filters, { finance: fin })]
    : p.company.type === 'client'
      ? [records('orders.total', p.filters, { limit: 5000, finance: fin }), records('trips.total', p.filters, { limit: 5000, finance: fin }), records('fuel.issued', p.filters, { limit: 5000, finance: fin })]
      : [records('supply.received', p.filters, { limit: 5000, finance: fin })];
  return { profile: p, lists };
}
export const fmt = fmtCell;
