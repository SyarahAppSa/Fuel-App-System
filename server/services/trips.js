import crypto from 'node:crypto';
import { q, tx, uid, now, nextNumber, audit, notify, HttpError, L, ML } from '../db.js';
import { createReceiptForStop, createDirectBatchForStop } from './inventory.js';
import * as K from './contracts.js';
import * as F from './finance.js';

export const VAT_RATE = 0.15;
export const ACTIVE_TRIP = ['awaiting_assignment','assigned','to_loading','at_loading','loaded','to_delivery','at_site','on_hold'];
export const TRIP_STATUS_AR = {
  awaiting_acceptance: 'بانتظار قبول الناقل', awaiting_assignment: 'بانتظار الإسناد', assigned: 'مسندة',
  to_loading: 'في الطريق للتحميل', at_loading: 'وصل لنقطة التحميل', loaded: 'تم التحميل', to_delivery: 'في الطريق للتسليم',
  at_site: 'وصل للموقع', delivered: 'تم التسليم', under_review: 'بانتظار المراجعة', closed: 'مغلقة',
  cancelled: 'ملغاة', rejected: 'مرفوضة', on_hold: 'متوقفة',
};
const DRIVER_FLOW = {
  assigned: ['to_loading'],
  to_loading: ['at_loading'],
  at_loading: ['loaded'],
  loaded: ['to_delivery'],
  to_delivery: ['at_site'],
};

function platformSettings() {
  const p = q.get("SELECT settings_json FROM companies WHERE type='platform' LIMIT 1");
  return { commission_pct: 3, ...(p ? JSON.parse(p.settings_json) : {}) };
}

/* ------------------------------------------------------------------ */
/* السوق: البحث عن ناقلين مؤهلين ومتاحين                                */
/* ------------------------------------------------------------------ */
export function quotePrice(rp, quantityMl) {
  const base = rp.pricing_type === 'fixed' ? rp.price_halalas : Math.round((rp.price_halalas * quantityMl) / 1_000_000);
  const { commission_pct } = platformSettings();
  const platform = Math.round((base * commission_pct) / 100);
  const subtotal = base + platform;
  const vat = Math.round(subtotal * VAT_RATE);
  return {
    pricing_type: rp.pricing_type, unit_price_halalas: rp.price_halalas,
    base_halalas: base, platform_fee_halalas: platform, platform_commission_pct: commission_pct,
    vat_halalas: vat, total_halalas: subtotal + vat,
    terms: {
      waiting_fee_halalas_per_hour: rp.waiting_fee_halalas_per_hour, free_waiting_hours: rp.free_waiting_hours,
      cancel_fee_halalas: rp.cancel_fee_halalas, accept_within_minutes: rp.accept_within_minutes,
    },
  };
}

/** سعر طلب من عدة رحلات: مجموع تسعير كل رحلة (السعر الثابت للرحلة يتكرر) */
export function quoteTrips(rp, qtys) {
  const parts = qtys.map((x) => quotePrice(rp, x));
  if (parts.length === 1) return parts[0];
  const sum = (k) => parts.reduce((a, p) => a + p[k], 0);
  return { ...parts[0], base_halalas: sum('base_halalas'), platform_fee_halalas: sum('platform_fee_halalas'), vat_halalas: sum('vat_halalas'), total_halalas: sum('total_halalas'), trips: parts.length };
}

function overlapping(col, id, start, end, excludeTripId) {
  return q.get(`SELECT id, number FROM trips WHERE ${col} = ? AND status IN (${ACTIVE_TRIP.map(() => '?').join(',')})
      AND planned_start < ? AND planned_end > ? AND id <> ? LIMIT 1`, id, ...ACTIVE_TRIP, end, start, excludeTripId || '');
}

export function eligibleVehicles(carrierId, product, quantityMl, start, end, excludeTripId) {
  const day = start.slice(0, 10);
  return q.all('SELECT * FROM vehicles WHERE company_id = ? ORDER BY capacity_ml', carrierId).map((v) => {
    const reasons = [];
    if (v.status !== 'active') reasons.push('المركبة غير نشطة');
    if (!v.products.split(',').includes(product)) reasons.push('المنتج غير مسموح للمركبة');
    if (v.capacity_ml < quantityMl) reasons.push('السعة أقل من الكمية');
    if (v.docs_valid_until && v.docs_valid_until < day) reasons.push('وثائق المركبة منتهية');
    const clash = overlapping('vehicle_id', v.id, start, end, excludeTripId);
    if (clash) reasons.push(`محجوزة لرحلة ${clash.number} في نفس الفترة`);
    return { ...v, eligible: reasons.length === 0, reasons };
  });
}

export function eligibleDrivers(carrierId, start, end, excludeTripId) {
  const day = start.slice(0, 10);
  return q.all('SELECT * FROM drivers WHERE company_id = ? ORDER BY name', carrierId).map((d) => {
    const reasons = [];
    if (d.status !== 'active') reasons.push('السائق موقوف');
    if (d.license_expiry && d.license_expiry < day) reasons.push('رخصة السائق منتهية');
    const clash = overlapping('driver_id', d.id, start, end, excludeTripId);
    if (clash) reasons.push(`مسند لرحلة ${clash.number} في نفس الفترة`);
    return { ...d, eligible: reasons.length === 0, reasons };
  });
}

export function carrierPerformance(carrierId, loadingPointId, city) {
  const rows = q.all(`SELECT t.window_end, t.delivered_at FROM trips t JOIN orders o ON o.id = t.order_id
      JOIN trip_stops s ON s.trip_id = t.id AND s.seq = 1 JOIN sites st ON st.id = s.site_id
      WHERE t.carrier_id = ? AND t.status IN ('delivered','closed','under_review')` + (loadingPointId ? ' AND o.loading_point_id = ? AND st.city = ?' : ''),
    ...[carrierId, loadingPointId, city].filter(Boolean));
  const withWindow = rows.filter((r) => r.window_end && r.delivered_at);
  const onTime = withWindow.filter((r) => r.delivered_at <= r.window_end).length;
  const all = q.get(`SELECT COUNT(*) n, SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) c FROM trips WHERE carrier_id = ?`, carrierId);
  return {
    route_sample: withWindow.length,
    on_time_pct: withWindow.length ? Math.round((onTime / withWindow.length) * 100) : null,
    total_trips: all.n, cancelled: all.c || 0,
  };
}

export function searchCarriers({ loading_point_id, city, product, quantity_liters, date, window_start, window_end, project_id }, ctx) {
  if (!loading_point_id || !city || !product || !quantity_liters || !date) throw new HttpError(400, 'حدد نقطة التحميل والمدينة والمنتج والكمية والتاريخ');
  const qty = ML(quantity_liters);
  const { start, end } = planWindow(date, window_start, window_end);
  const rps = q.all(`SELECT rp.*, c.name_ar carrier_name, c.city carrier_city FROM route_prices rp
      JOIN companies c ON c.id = rp.carrier_id AND c.status = 'approved'
      WHERE rp.active = 1 AND rp.loading_point_id = ? AND rp.delivery_city = ? AND rp.product = ?
        AND EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = rp.carrier_id AND cc.kind='loading' AND cc.ref = rp.loading_point_id)
        AND EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = rp.carrier_id AND cc.kind='delivery' AND cc.ref = rp.delivery_city)`,
    loading_point_id, city, product);
  const avail = (carrierId) => {
    const okV = eligibleVehicles(carrierId, product, qty, start, end).filter((v) => v.eligible);
    const okD = eligibleDrivers(carrierId, start, end).filter((d) => d.eligible);
    return { available: okV.length > 0 && okD.length > 0, available_vehicles: okV.length, available_drivers: okD.length,
      best_vehicle_capacity_liters: okV[0] ? L(okV[0].capacity_ml) : null, performance: carrierPerformance(carrierId, loading_point_id, city), window: { start, end } };
  };
  const offers = rps.map((rp) => ({ kind: 'public', route_price_id: rp.id, carrier_id: rp.carrier_id, carrier_name: rp.carrier_name, quote: quotePrice(rp, qty), ...avail(rp.carrier_id) }));
  if (ctx) {
    const k = K.contractOffers(ctx, { loading_point_id, city, product, quantity_ml: qty, date, project_id });
    for (const r of k.rates) offers.push({ kind: 'contract', contract_rate_id: r.id, contract_id: r.contract_id, contract_number: r.contract_number, contract_type: r.contract_type,
      carrier_id: r.carrier_id, carrier_name: r.carrier_name, quote: { ...quotePrice(r, qty), contract_number: r.contract_number }, ...avail(r.carrier_id) });
    for (const p of k.packages) {
      const a = avail(p.carrier_id);
      const reasons = [!p.fits && `الكمية تتجاوز حد الرحلة في الباقة (${L(p.max_liters_per_trip_ml)} لتر)`, p.project_available <= 0 && 'لا رصيد متاح لهذا المشروع'].filter(Boolean);
      offers.push({ kind: 'package', package_id: p.id, package_number: p.number, carrier_id: p.carrier_id, carrier_name: p.carrier_name, quote: K.packageQuote(p),
        package_balance: { available: p.balance.available, project_available: p.project_available, total: p.total_trips, expiry_date: p.expiry_date }, ...a,
        available: a.available && reasons.length === 0, blocked_reasons: reasons });
    }
  }
  const rank = { package: 0, contract: 1, public: 2 };
  return offers.sort((a, b) => (b.available - a.available) || (rank[a.kind] - rank[b.kind]) || (a.quote.total_halalas - b.quote.total_halalas));
}

export function planWindow(date, ws, we) {
  const start = `${date}T${ws || '06:00'}:00+03:00`;
  const end = `${date}T${we || '18:00'}:00+03:00`;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/* ------------------------------------------------------------------ */
/* كميات مستند أرامكو: المصرح / المحجوز / المحمل / المسلّم / الملغى      */
/* ------------------------------------------------------------------ */
export function documentQuantities(docId) {
  const doc = q.get('SELECT * FROM aramco_documents WHERE id = ?', docId);
  if (!doc) return null;
  const trips = q.all(`SELECT t.id, t.number, t.status, t.loaded_ml, (SELECT SUM(requested_ml) FROM trip_stops WHERE trip_id=t.id) requested_ml,
      (SELECT SUM(COALESCE(delivered_ml,0)) FROM trip_stops WHERE trip_id=t.id) delivered_ml,
      (SELECT SUM(COALESCE(returned_ml,0)) FROM trip_stops WHERE trip_id=t.id) returned_ml
    FROM trips t JOIN orders o ON o.id = t.order_id WHERE o.aramco_document_id = ?`, docId);
  let reserved = 0, loaded = 0, delivered = 0, cancelled = 0, returned = 0;
  for (const t of trips) {
    if (['cancelled', 'rejected'].includes(t.status)) { cancelled += t.requested_ml; continue; }
    if (t.loaded_ml != null) { loaded += t.loaded_ml; delivered += t.delivered_ml || 0; returned += t.returned_ml || 0; }
    else reserved += t.requested_ml;
  }
  const committed = reserved + loaded - returned;
  return {
    authorized_ml: doc.authorized_ml, reserved_ml: reserved, loaded_ml: loaded, delivered_ml: delivered,
    returned_ml: returned, cancelled_ml: cancelled, committed_ml: committed,
    available_ml: (doc.authorized_ml ?? 0) - committed, trips,
  };
}

/* ------------------------------------------------------------------ */
/* إنشاء طلب نقل + رحلة                                                 */
/* ------------------------------------------------------------------ */
export function createOrder(ctx, body) {
  const { route_price_id, contract_rate_id, package_id, aramco_document_id, date, window_start, window_end, stops, notes, idempotency_key, fuel_price_per_liter, project_id, extra_route_price_ids = [], split_trips } = body;
  if (idempotency_key) {
    const ex = q.get('SELECT id FROM orders WHERE idempotency_key = ? AND company_id = ?', idempotency_key, ctx.companyId);
    if (ex) return { order_id: ex.id, duplicate: true };
  }
  if (!Array.isArray(stops) || !stops.length) throw new HttpError(400, 'أضف موقع تسليم واحدًا على الأقل');
  return tx(() => {
    let rp, pkg = null, contractId = null, contractNumber = null;
    if (package_id) {
      pkg = q.get("SELECT * FROM trip_packages WHERE id = ? AND client_id = ? AND status = 'active'", package_id, ctx.companyId);
      if (!pkg) throw new HttpError(404, 'الباقة غير موجودة أو غير مفعّلة');
      if (pkg.start_date > date || pkg.expiry_date < date) throw new HttpError(409, 'الباقة غير سارية في تاريخ الطلب');
      rp = { id: null, carrier_id: pkg.carrier_id, loading_point_id: pkg.loading_point_id, delivery_city: pkg.delivery_city, product: pkg.product, accept_within_minutes: 120 };
      contractId = pkg.contract_id;
    } else if (contract_rate_id) {
      const cr = q.get(`SELECT r.*, c.carrier_id, c.id cid, c.number cnum, c.start_date, c.end_date, c.status FROM contract_rates r JOIN contracts c ON c.id = r.contract_id
          WHERE r.id = ? AND c.client_id = ?`, contract_rate_id, ctx.companyId);
      if (!cr || cr.status !== 'active') throw new HttpError(404, 'العقد غير مفعّل');
      if (cr.start_date > date || cr.end_date < date) throw new HttpError(409, 'تاريخ الطلب خارج مدة العقد');
      rp = { ...cr, id: null }; contractId = cr.cid; contractNumber = cr.cnum;
    } else {
      rp = q.get('SELECT * FROM route_prices WHERE id = ? AND active = 1', route_price_id);
      if (!rp) throw new HttpError(400, 'السعر المختار غير متاح');
    }
    const carrier = q.get("SELECT * FROM companies WHERE id = ? AND status = 'approved'", rp.carrier_id);
    if (!carrier) throw new HttpError(409, 'الناقل غير مؤهل حاليًا');
    const totalMl = stops.reduce((s, x) => s + ML(x.quantity_liters), 0);
    if (totalMl <= 0) throw new HttpError(400, 'الكمية غير صحيحة');

    let doc = null;
    if (aramco_document_id) {
      doc = q.get('SELECT * FROM aramco_documents WHERE id = ? AND company_id = ?', aramco_document_id, ctx.companyId);
      if (!doc) throw new HttpError(404, 'المستند غير موجود');
      if (doc.status !== 'approved') throw new HttpError(409, 'اعتمد بيانات المستند قبل استخدامه');
      if (doc.product !== rp.product) throw new HttpError(409, 'نوع الوقود في المستند لا يطابق الطلب');
      if (doc.loading_point_id !== rp.loading_point_id) throw new HttpError(409, 'نقطة التحميل في المستند لا تطابق السعر المختار');
      const qty = documentQuantities(doc.id);
      if (totalMl > qty.available_ml) throw new HttpError(409, `الكمية تتجاوز المتاح من المستند (${L(qty.available_ml)} لتر)`, qty);
    } else {
      throw new HttpError(400, 'ارفع مستند أرامكو واعتمده قبل الطلب');
    }

    const sitesRows = stops.map((s) => {
      const site = q.get('SELECT * FROM sites WHERE id = ? AND company_id = ?', s.site_id, ctx.companyId);
      if (!site) throw new HttpError(404, 'موقع التسليم غير موجود');
      if (site.city !== rp.delivery_city && stops.length === 1) throw new HttpError(409, 'مدينة الموقع لا تطابق مسار السعر');
      if (s.mode === 'tank') {
        const tank = q.get('SELECT * FROM tanks WHERE id = ? AND site_id = ?', s.tank_id, site.id);
        if (!tank) throw new HttpError(400, 'حدد خزانًا في موقع التسليم');
        if (tank.product !== rp.product) throw new HttpError(409, 'منتج الخزان لا يطابق المنتج');
      }
      return site;
    });

    const { start, end } = planWindow(date, window_start, window_end);
    // تقسيم الطلب إلى عدة رحلات (لنقطة تسليم واحدة): طلب واحد ← n رحلة
    const nSplit = Math.max(1, Math.min(10, Number(split_trips) || 1));
    if (nSplit > 1 && (stops.length !== 1 || pkg)) throw new HttpError(400, 'التقسيم متاح لطلب بنقطة تسليم واحدة وخارج الباقات');
    const tripPlans = nSplit > 1
      ? Array.from({ length: nSplit }, (_, i) => { const each = Math.floor(ML(stops[0].quantity_liters) / nSplit); return [{ ...stops[0], ml: i === nSplit - 1 ? ML(stops[0].quantity_liters) - each * (nSplit - 1) : each }]; })
      : [stops.map((x) => ({ ...x, ml: ML(x.quantity_liters) }))];
    const tripQtys = tripPlans.map((st) => st.reduce((a, x) => a + x.ml, 0));
    if (pkg && totalMl > pkg.max_liters_per_trip_ml) throw new HttpError(409, `الكمية تتجاوز حد الرحلة في الباقة (${L(pkg.max_liters_per_trip_ml)} لتر)`);
    const quote = pkg ? K.packageQuote(pkg) : { ...quoteTrips(rp, tripQtys), ...(contractNumber ? { contract_number: contractNumber } : {}) };
    // إرسال الطلب لناقلين إضافيين (أسعار منشورة لنفس المسار): أول من يقبل يُعتمد
    const extras = (pkg || contract_rate_id) ? [] : [...new Set(extra_route_price_ids)].map((rid) => {
      const x = q.get(`SELECT rp.* FROM route_prices rp JOIN companies c ON c.id = rp.carrier_id AND c.status = 'approved' WHERE rp.id = ? AND rp.active = 1`, rid);
      if (!x || x.loading_point_id !== rp.loading_point_id || x.delivery_city !== rp.delivery_city || x.product !== rp.product) throw new HttpError(400, 'أحد الناقلين الإضافيين لا يخدم نفس المسار');
      return x;
    }).filter((x) => x.carrier_id !== rp.carrier_id);
    const orderId = uid('ord_');
    const orderNo = nextNumber('order', 'FA-ORD');
    q.run(`INSERT INTO orders(id,number,company_id,project_id,created_by,product,quantity_ml,loading_point_id,aramco_document_id,requested_date,
        window_start,window_end,carrier_id,route_price_id,price_snapshot_json,transport_halalas,fuel_price_halalas_per_l,status,idempotency_key,notes,contract_id,contract_rate_id,package_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderId, orderNo, ctx.companyId, project_id || sitesRows[0].project_id, ctx.userId, rp.product, totalMl, rp.loading_point_id, doc?.id ?? null,
      date, start, end, rp.carrier_id, rp.id, JSON.stringify({ ...quote, snapshot_at: now(), route_price_id: rp.id, contract_rate_id: contract_rate_id || null, package_id: pkg?.id ?? null }),
      quote.base_halalas, fuel_price_per_liter != null && fuel_price_per_liter !== '' ? Math.round(Number(fuel_price_per_liter) * 100) : null,
      'pending_carrier', idempotency_key || null, notes || null, contractId, contract_rate_id || null, pkg?.id ?? null);

    const deadline = new Date(Date.now() + rp.accept_within_minutes * 60000).toISOString();
    const created = [];
    tripPlans.forEach((plan) => {
      const tripId = uid('trp_'); const tripNo = nextNumber('trip', 'FA-TRP');
      q.run(`INSERT INTO trips(id,number,order_id,company_id,carrier_id,status,planned_start,planned_end,window_start,window_end,accept_deadline)
          VALUES (?,?,?,?,?,'awaiting_acceptance',?,?,?,?,?)`, tripId, tripNo, orderId, ctx.companyId, rp.carrier_id, start, end, start, end, deadline);
      plan.forEach((s, i) => {
        const site = sitesRows[nSplit > 1 ? 0 : i];
        q.run(`INSERT INTO trip_stops(id,trip_id,seq,site_id,mode,tank_id,requested_ml,receiver_name,receiver_phone,access_notes,receipt_token)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`, uid('stp_'), tripId, i + 1, site.id, s.mode === 'direct' ? 'direct' : 'tank',
          s.mode === 'tank' ? s.tank_id : null, s.ml, s.receiver_name || site.receiver_name, s.receiver_phone || site.receiver_phone,
          s.access_notes || site.access_notes, crypto.randomBytes(16).toString('hex'));
      });
      for (const c of [rp, ...extras]) q.run("INSERT INTO assignment_history(trip_id,carrier_id,action,by_user) VALUES (?,?,'offered',?)", tripId, c.carrier_id, ctx.userId);
      event(tripId, null, 'created', null, 'awaiting_acceptance', ctx);
      K.onOrderCreated(ctx, { orderId, tripId, packageId: pkg?.id, projectId: project_id || sitesRows[0].project_id, carrierId: rp.carrier_id, city: sitesRows[0].city, product: rp.product, date });
      created.push({ tripId, tripNo });
    });
    // سطر عرض لكل ناقل وصله الطلب
    for (const c of [rp, ...extras]) {
      const cq = c === rp ? quote : quoteTrips(c, tripQtys);
      const dl = new Date(Date.now() + (c.accept_within_minutes || 120) * 60000).toISOString();
      q.run('INSERT INTO order_offers(id,order_id,carrier_id,route_price_id,quote_json,deadline) VALUES (?,?,?,?,?,?)', uid('off_'), orderId, c.carrier_id, c.id || null, JSON.stringify(cq), dl);
      notify(c.carrier_id, 'dispatcher', `طلب نقل جديد ${orderNo}`, `${L(totalMl).toLocaleString('ar-SA')} لتر - ${rp.delivery_city}${created.length > 1 ? ` · ${created.length} رحلات` : ''}`, `/carrier/trips/${created[0].tripId}`, `offer:${orderId}:${c.carrier_id}`);
    }
    const tripId = created[0].tripId, tripNo = created[0].tripNo;
    audit(ctx, 'order.create', 'order', orderId, { trips: created.map((x) => x.tripNo), carriers: [rp, ...extras].map((c) => c.carrier_id), total: quote.total_halalas });
    return { order_id: orderId, order_number: orderNo, trip_id: tripId, trip_number: tripNo, trip_ids: created.map((x) => x.tripId) };
  });
}

function event(tripId, stopId, type, from, to, ctx, extra = {}) {
  q.run(`INSERT INTO trip_events(trip_id,stop_id,type,from_status,to_status,actor_user_id,actor_role,note,lat,lng,captured_at,client_op_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, tripId, stopId, type, from, to, ctx?.userId ?? null, ctx?.role ?? null,
    extra.note ?? null, extra.lat ?? null, extra.lng ?? null, extra.captured_at ?? now(), extra.client_op_id ?? null);
}

function setStatus(trip, to, ctx, extra = {}, fields = {}) {
  const sets = ['status = ?'], params = [to];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); params.push(v); }
  const r = q.run(`UPDATE trips SET ${sets.join(', ')} WHERE id = ? AND status = ?`, ...params, trip.id, trip.status);
  if (r.changes !== 1) throw new HttpError(409, 'تغيرت حالة الرحلة، حدّث الصفحة');
  event(trip.id, extra.stop_id ?? null, 'status', trip.status, to, ctx, extra);
}

/* ------------------------------------------------------------------ */
/* الناقل: قبول / رفض / إسناد                                          */
/* ------------------------------------------------------------------ */
function carrierTrip(ctx, tripId) {
  const t = q.get('SELECT * FROM trips WHERE id = ? AND carrier_id = ?', tripId, ctx.companyId);
  if (!t) throw new HttpError(404, 'الرحلة غير موجودة');
  return t;
}

/** الناقل الذي وصله الطلب (المعتمد أو أحد المعروض عليهم) */
function offerFor(ctx, tripId) {
  const t = q.get('SELECT * FROM trips WHERE id = ?', tripId);
  if (!t) throw new HttpError(404, 'الرحلة غير موجودة');
  const off = q.get('SELECT * FROM order_offers WHERE order_id = ? AND carrier_id = ?', t.order_id, ctx.companyId);
  if (!off && t.carrier_id !== ctx.companyId) throw new HttpError(404, 'الرحلة غير موجودة');
  return { t, off };
}

/** القبول يشمل كل رحلات الطلب، ويسحب العرض من باقي الناقلين */
export function acceptTrip(ctx, tripId) {
  return tx(() => {
    const { t, off } = offerFor(ctx, tripId);
    if (off && off.status !== 'pending') throw new HttpError(409, off.status === 'withdrawn' ? 'قبل ناقل آخر هذا الطلب' : 'لا يمكن قبول الطلب في حالته الحالية');
    if (t.status !== 'awaiting_acceptance') throw new HttpError(409, 'لا يمكن قبول الرحلة في حالتها الحالية');
    const dl = off?.deadline || t.accept_deadline;
    if (dl && dl < now()) { if (off) q.run("UPDATE order_offers SET status='expired' WHERE id = ?", off.id); throw new HttpError(409, 'انتهت مهلة القبول'); }
    const sibs = q.all("SELECT * FROM trips WHERE order_id = ? AND status = 'awaiting_acceptance'", t.order_id);
    for (const x of sibs) {
      setStatus(x, 'awaiting_assignment', ctx, {}, { accepted_at: now(), carrier_id: ctx.companyId });
      q.run("INSERT INTO assignment_history(trip_id,carrier_id,action,by_user) VALUES (?,?,'accepted',?)", x.id, ctx.companyId, ctx.userId);
    }
    if (off) {
      q.run("UPDATE order_offers SET status='accepted', responded_at=?, responded_by=? WHERE id = ?", now(), ctx.userId, off.id);
      q.run("UPDATE order_offers SET status='withdrawn', reason='قبل ناقل آخر' WHERE order_id = ? AND status = 'pending'", t.order_id);
      const o = q.get('SELECT * FROM orders WHERE id = ?', t.order_id);
      if (o.carrier_id !== ctx.companyId) {
        const qj = JSON.parse(off.quote_json || '{}');
        q.run('UPDATE orders SET carrier_id = ?, route_price_id = ?, price_snapshot_json = ?, transport_halalas = ? WHERE id = ?',
          ctx.companyId, off.route_price_id, JSON.stringify({ ...qj, snapshot_at: now(), route_price_id: off.route_price_id }), qj.base_halalas, o.id);
      }
    }
    q.run("UPDATE orders SET status='accepted' WHERE id = ?", t.order_id);
    audit(ctx, 'trip.accept', 'trip', t.id, { order: t.order_id, trips: sibs.length });
    notify(t.company_id, 'procurement', `قبل الناقل الطلب (${sibs.length} رحلة)`, ctx.companyName, `/trips/${t.id}`, `accepted:${t.order_id}`);
    return { ok: true, trips: sibs.length };
  });
}

/** الرفض يخص هذا الناقل؛ يُرفض الطلب فقط عندما لا يبقى ناقل لم يرد */
export function rejectTrip(ctx, tripId, reason) {
  if (!reason) throw new HttpError(400, 'سبب الرفض مطلوب');
  return tx(() => {
    const { t, off } = offerFor(ctx, tripId);
    if (t.status !== 'awaiting_acceptance' || (off && off.status !== 'pending')) throw new HttpError(409, 'لا يمكن رفض الطلب في حالته الحالية');
    if (off) q.run("UPDATE order_offers SET status='rejected', responded_at=?, responded_by=?, reason=? WHERE id = ?", now(), ctx.userId, reason, off.id);
    const sibs = q.all("SELECT * FROM trips WHERE order_id = ? AND status = 'awaiting_acceptance'", t.order_id);
    for (const x of sibs) q.run("INSERT INTO assignment_history(trip_id,carrier_id,action,reason,by_user) VALUES (?,?,'rejected',?,?)", x.id, ctx.companyId, reason, ctx.userId);
    const left = q.get("SELECT COUNT(*) n FROM order_offers WHERE order_id = ? AND status = 'pending' AND (deadline IS NULL OR deadline >= ?)", t.order_id, now()).n;
    if (!left) {
      for (const x of sibs) { setStatus(x, 'rejected', ctx, { note: reason }, { reject_reason: reason }); K.onTripReleased(x, { afterAcceptance: false }); }
      q.run("UPDATE orders SET status='rejected' WHERE id = ?", t.order_id);
    }
    notify(t.company_id, 'procurement', `رفض ${ctx.companyName} الطلب`, reason, `/trips/${t.id}`, `rejected:${t.order_id}:${ctx.companyId}`);
    return { ok: true, order_rejected: !left };
  });
}

export function assignTrip(ctx, tripId, { vehicle_id, driver_id }) {
  return tx(() => {
    const t = carrierTrip(ctx, tripId);
    if (!['awaiting_assignment', 'assigned'].includes(t.status)) throw new HttpError(409, 'لا يمكن الإسناد في حالة الرحلة الحالية');
    const order = q.get('SELECT * FROM orders WHERE id = ?', t.order_id);
    const tripMl = q.get('SELECT COALESCE(SUM(requested_ml),0) s FROM trip_stops WHERE trip_id = ?', t.id).s; // كمية هذه الرحلة (قد تكون جزءًا من طلب مقسّم)
    const v = eligibleVehicles(ctx.companyId, order.product, tripMl, t.planned_start, t.planned_end, t.id).find((x) => x.id === vehicle_id);
    if (!v) throw new HttpError(404, 'المركبة غير موجودة');
    if (!v.eligible) throw new HttpError(409, `المركبة غير مؤهلة: ${v.reasons.join('، ')}`);
    const d = eligibleDrivers(ctx.companyId, t.planned_start, t.planned_end, t.id).find((x) => x.id === driver_id);
    if (!d) throw new HttpError(404, 'السائق غير موجود');
    if (!d.eligible) throw new HttpError(409, `السائق غير مؤهل: ${d.reasons.join('، ')}`);
    const action = t.status === 'assigned' ? 'reassigned' : 'assigned';
    setStatus(t, 'assigned', ctx, {}, { vehicle_id, driver_id, assigned_at: now() });
    q.run('INSERT INTO assignment_history(trip_id,carrier_id,vehicle_id,driver_id,action,by_user) VALUES (?,?,?,?,?,?)', t.id, ctx.companyId, vehicle_id, driver_id, action, ctx.userId);
    audit(ctx, 'trip.' + action, 'trip', t.id, { vehicle_id, driver_id });
    return { ok: true };
  });
}

export function cancelTrip(ctx, tripId, reason) {
  return tx(() => {
    const t = q.get('SELECT * FROM trips WHERE id = ? AND company_id = ?', tripId, ctx.companyId);
    if (!t) throw new HttpError(404, 'الرحلة غير موجودة');
    if (!['awaiting_acceptance', 'awaiting_assignment', 'assigned'].includes(t.status)) throw new HttpError(409, 'لا يمكن الإلغاء بعد بدء التنفيذ');
    const snap = JSON.parse(q.get('SELECT price_snapshot_json FROM orders WHERE id = ?', t.order_id).price_snapshot_json || '{}');
    const fee = t.status === 'awaiting_acceptance' ? 0 : snap.terms?.cancel_fee_halalas || 0;
    setStatus(t, 'cancelled', ctx, { note: reason }, { cancel_reason: reason || null });
    K.onTripReleased(t, { afterAcceptance: t.status !== 'awaiting_acceptance' });
    q.run("UPDATE orders SET status='cancelled' WHERE id = ?", t.order_id);
    q.run("INSERT INTO assignment_history(trip_id,carrier_id,action,reason,by_user) VALUES (?,?,'released',?,?)", t.id, t.carrier_id, reason || null, ctx.userId);
    notify(t.carrier_id, 'dispatcher', `ألغى العميل الرحلة ${t.number}`, reason || '', `/carrier/trips/${t.id}`, `cancel:${t.id}`);
    return { ok: true, cancel_fee_halalas: fee };
  });
}

/* ------------------------------------------------------------------ */
/* السائق: تقدم الحالة، التسليم، الصور (مع معرف عملية يمنع التكرار)       */
/* ------------------------------------------------------------------ */
export function driverTrip(ctx, tripId) {
  const t = q.get('SELECT * FROM trips WHERE id = ? AND driver_id = ?', tripId, ctx.driverId);
  if (!t) throw new HttpError(404, 'الرحلة غير مسندة إليك');
  return t;
}

export function driverAdvance(ctx, tripId, body) {
  const { to, client_op_id, lat, lng, captured_at, loaded_liters, measure_method, stop_id, note } = body;
  if (client_op_id) {
    const ex = q.get('SELECT id FROM trip_events WHERE client_op_id = ?', client_op_id);
    if (ex) return { ok: true, duplicate: true };
  }
  return tx(() => {
    const t = driverTrip(ctx, tripId);
    const extra = { lat, lng, captured_at, client_op_id, note, stop_id };
    if (to === 'on_hold') {
      if (!ACTIVE_TRIP.includes(t.status) || t.status === 'on_hold') throw new HttpError(409, 'لا يمكن إيقاف الرحلة');
      setStatus(t, 'on_hold', ctx, extra);
      return { ok: true };
    }
    if (to === 'resume') {
      if (t.status !== 'on_hold') throw new HttpError(409, 'الرحلة ليست متوقفة');
      const prev = q.get("SELECT from_status FROM trip_events WHERE trip_id = ? AND to_status = 'on_hold' ORDER BY id DESC LIMIT 1", t.id);
      setStatus(t, prev.from_status, ctx, extra);
      return { ok: true };
    }
    if (to === 'at_site') {
      if (t.status !== 'to_delivery') throw new HttpError(409, `انتقال غير مسموح من «${TRIP_STATUS_AR[t.status]}»`);
      const stop = nextPendingStop(t.id);
      if (!stop) throw new HttpError(409, 'لا توجد نقطة تسليم متبقية');
      setStatus(t, 'at_site', ctx, { ...extra, stop_id: stop.id });
      q.run("UPDATE trip_stops SET status='arrived', arrived_at=? WHERE id = ?", now(), stop.id);
      if (stop.mode === 'direct') createDirectBatchForStop(ctx, t, stop);
      notify(t.company_id, 'fuel_supervisor', `وصل الصهريج ${t.number} إلى الموقع`, '', `/trips/${t.id}`, `arrived:${stop.id}`);
      return { ok: true, stop_id: stop.id };
    }
    const allowed = DRIVER_FLOW[t.status] || [];
    if (!allowed.includes(to)) throw new HttpError(409, `انتقال غير مسموح من «${TRIP_STATUS_AR[t.status]}»`);
    const fields = {};
    if (to === 'loaded') {
      const ml = ML(loaded_liters);
      if (!(ml > 0)) throw new HttpError(400, 'أدخل الكمية المحملة فعليًا');
      const v = q.get('SELECT capacity_ml FROM vehicles WHERE id = ?', t.vehicle_id);
      if (ml > v.capacity_ml) throw new HttpError(409, 'الكمية المحملة تتجاوز سعة الصهريج');
      Object.assign(fields, { loaded_ml: ml, load_measure_method: measure_method || 'meter', loaded_at: now() });
      q.run("UPDATE orders SET status='in_progress' WHERE id = ?", t.order_id);
    }
    setStatus(t, to, ctx, extra, fields);
    return { ok: true };
  });
}

function nextPendingStop(tripId) {
  return q.get("SELECT * FROM trip_stops WHERE trip_id = ? AND status = 'pending' ORDER BY seq LIMIT 1", tripId);
}

export function driverDeliverStop(ctx, tripId, stopId, body) {
  const { delivered_liters, returned_liters, measure_method, receiver_name, client_op_id, lat, lng, captured_at } = body;
  if (client_op_id) {
    const ex = q.get('SELECT id FROM trip_events WHERE client_op_id = ?', client_op_id);
    if (ex) return { ok: true, duplicate: true };
  }
  return tx(() => {
    const t = driverTrip(ctx, tripId);
    if (t.status !== 'at_site') throw new HttpError(409, 'سجّل الوصول للموقع أولًا');
    const stop = q.get("SELECT * FROM trip_stops WHERE id = ? AND trip_id = ? AND status = 'arrived'", stopId, t.id);
    if (!stop) throw new HttpError(404, 'نقطة التسليم غير صحيحة');
    const del = ML(delivered_liters);
    if (!(del >= 0)) throw new HttpError(400, 'أدخل الكمية المسلّمة');
    const ret = returned_liters ? ML(returned_liters) : 0;
    const deliveredSoFar = q.get('SELECT COALESCE(SUM(delivered_ml),0) s FROM trip_stops WHERE trip_id = ?', t.id).s;
    if (deliveredSoFar + del > t.loaded_ml) throw new HttpError(409, 'المسلّم يتجاوز الكمية المحملة');
    if (stop.mode === 'direct') {
      const b = q.get('SELECT id FROM fuel_batches WHERE trip_stop_id = ?', stop.id);
      const used = -q.get("SELECT COALESCE(SUM(quantity_ml),0) s FROM fuel_movements WHERE batch_id = ? AND kind='issue' AND status='approved'", b.id).s;
      if (del < used) throw new HttpError(409, `تم صرف ${L(used)} لتر مباشرة من هذه الدفعة، لا يمكن أن يقل المسلّم عنها`);
    }
    q.run(`UPDATE trip_stops SET status='delivered', delivered_ml=?, returned_ml=?, measure_method=?, receiver_name=COALESCE(?,receiver_name), delivered_at=? WHERE id = ?`,
      del, ret, measure_method || 'meter', receiver_name || null, now(), stop.id);
    event(t.id, stop.id, 'stop_delivered', null, null, ctx, { client_op_id, lat, lng, captured_at, note: `${L(del)} لتر` });
    const remaining = nextPendingStop(t.id);
    const to = remaining ? 'to_delivery' : 'delivered';
    if (to === 'delivered') { K.onTripDelivered(t); F.onTripDelivered(t); }
    setStatus(t, to, ctx, { stop_id: stop.id }, to === 'delivered' ? { delivered_at: now() } : {});
    notify(t.company_id, 'site_receiver', `بانتظار تأكيد استلام ${t.number}`, `${L(del)} لتر`, `/trips/${t.id}`, `confirm:${stop.id}`);
    return { ok: true, next: to };
  });
}

export function addPhoto(ctx, tripId, { kind, stop_id, file_id, lat, lng, captured_at, client_op_id }) {
  if (client_op_id) {
    const ex = q.get('SELECT id FROM trip_photos WHERE client_op_id = ?', client_op_id);
    if (ex) return { ok: true, duplicate: true, id: ex.id };
  }
  const t = driverTrip(ctx, tripId);
  const isUnload = kind === 'before_unloading' || kind === 'after_unloading';
  if (isUnload && !stop_id) throw new HttpError(400, 'صور التفريغ تخص نقطة تسليم');
  if (isUnload && !q.get('SELECT 1 FROM trip_stops WHERE id = ? AND trip_id = ?', stop_id, t.id)) throw new HttpError(400, 'نقطة تسليم غير صحيحة');
  const id = uid('pho_');
  q.run(`INSERT INTO trip_photos(id,trip_id,stop_id,kind,file_id,driver_id,lat,lng,captured_at,client_op_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, t.id, isUnload ? stop_id : null, kind, file_id, ctx.driverId, lat ?? null, lng ?? null, captured_at || now(), client_op_id || null);
  event(t.id, isUnload ? stop_id : null, 'photo', null, null, ctx, { note: kind, lat, lng, captured_at });
  return { ok: true, id };
}

/** الإثباتات الناقصة: زوج تحميل للرحلة + زوج تفريغ لكل نقطة تسليم */
export function missingProofs(tripId) {
  const photos = q.all('SELECT kind, stop_id FROM trip_photos WHERE trip_id = ?', tripId);
  const has = (k, s) => photos.some((p) => p.kind === k && (s ? p.stop_id === s : true));
  const missing = [];
  if (!has('before_loading')) missing.push({ kind: 'before_loading' });
  if (!has('after_loading')) missing.push({ kind: 'after_loading' });
  for (const s of q.all('SELECT id, seq FROM trip_stops WHERE trip_id = ? ORDER BY seq', tripId)) {
    if (!has('before_unloading', s.id)) missing.push({ kind: 'before_unloading', stop_id: s.id, seq: s.seq });
    if (!has('after_unloading', s.id)) missing.push({ kind: 'after_unloading', stop_id: s.id, seq: s.seq });
  }
  return missing;
}

/* ------------------------------------------------------------------ */
/* تأكيد المستلم / اعتراضه → إنشاء الاستلام والمخزون                      */
/* ------------------------------------------------------------------ */
export function confirmStop(ctx, stop, { ack, note, actorName }) {
  return tx(() => {
    const s = q.get('SELECT * FROM trip_stops WHERE id = ?', stop.id);
    if (s.status !== 'delivered') throw new HttpError(409, 'لا يمكن التأكيد قبل تسجيل التسليم من السائق');
    const t = q.get('SELECT * FROM trips WHERE id = ?', s.trip_id);
    if (ack === 'disputed') {
      if (!note) throw new HttpError(400, 'اذكر سبب الاعتراض والكمية المستلمة');
      q.run("UPDATE trip_stops SET status='disputed', receiver_ack='disputed', receiver_ack_by=?, receiver_ack_at=?, receiver_note=? WHERE id = ?",
        actorName || ctx?.userName, now(), note, s.id);
      openException(t.company_id, 'quantity_variance', 'trip_stop', s.id, `اعتراض المستلم على كمية ${t.number}`, { note, delivered_ml: s.delivered_ml, trip_id: t.id });
    } else {
      q.run("UPDATE trip_stops SET status='confirmed', receiver_ack='confirmed', receiver_ack_by=?, receiver_ack_at=?, receiver_note=? WHERE id = ?",
        actorName || ctx?.userName, now(), note || null, s.id);
      createReceiptForStop(ctx, t, { ...s, status: 'confirmed' });
    }
    event(t.id, s.id, 'receiver_' + ack, null, null, ctx, { note: actorName ? `${actorName}: ${note || ''}` : note });
    maybeCloseTrip(ctx, t.id);
    return { ok: true };
  });
}

export function openException(companyId, type, refType, refId, title, details) {
  // استثناء مفتوح أو معتمد سابقًا لنفس السجل لا يُعاد فتحه (القرار المعتمد نهائي ومسجل)
  const existing = q.get("SELECT id FROM exceptions WHERE ref_type=? AND ref_id=? AND type=? AND status IN ('open','approved')", refType, refId, type);
  if (existing) return existing.id;
  const id = uid('exc_');
  q.run('INSERT INTO exceptions(id,company_id,type,ref_type,ref_id,title,details_json) VALUES (?,?,?,?,?,?,?)', id, companyId, type, refType, refId, title, JSON.stringify(details || {}));
  notify(companyId, 'project_manager', title, '', '/approvals', `exc:${id}`);
  return id;
}

/** إغلاق الرحلة عند اكتمال التأكيد والإثباتات وعدم وجود فروقات، وإلا فهي بانتظار المراجعة */
export function maybeCloseTrip(ctx, tripId) {
  const t = q.get('SELECT * FROM trips WHERE id = ?', tripId);
  if (!['delivered', 'under_review'].includes(t.status)) return;
  const stops = q.all('SELECT * FROM trip_stops WHERE trip_id = ?', tripId);
  if (stops.some((s) => s.status === 'delivered')) return; // بانتظار تأكيد المستلم
  const delivered = stops.reduce((a, s) => a + (s.delivered_ml || 0) + (s.returned_ml || 0), 0);
  const variance = (t.loaded_ml || 0) - delivered;
  const tolerance = Math.max(20_000, Math.round((t.loaded_ml || 0) * 0.002)); // 20 لتر أو 0.2%
  const missing = missingProofs(tripId);
  if (Math.abs(variance) > tolerance) openException(t.company_id, 'quantity_variance', 'trip', t.id, `فرق كمية ${L(variance)} لتر في ${t.number}`, { loaded_ml: t.loaded_ml, delivered_ml: delivered, variance_ml: variance });
  if (missing.length) openException(t.company_id, 'missing_proof', 'trip', t.id, `إثباتات ناقصة في ${t.number}`, { missing });
  const open = q.get(`SELECT COUNT(*) n FROM exceptions WHERE status='open' AND ((ref_type='trip' AND ref_id=?) OR (ref_type='trip_stop' AND ref_id IN (SELECT id FROM trip_stops WHERE trip_id=?)))`, tripId, tripId).n;
  const to = open ? 'under_review' : 'closed';
  if (to !== t.status) setStatus(t, to, ctx, {}, to === 'closed' ? { closed_at: now() } : {});
  if (to === 'closed') q.run("UPDATE orders SET status='completed' WHERE id = ?", t.order_id);
}

/** عرض الرحلة مع إخفاء ما لا يحتاجه الدور (السعر/المستلم/المستند) */
export function tripView(ctx, tripId) {
  const t = q.get(`SELECT t.*, o.number order_number, o.product, o.quantity_ml, o.loading_point_id, o.aramco_document_id, o.price_snapshot_json,
      o.transport_halalas, o.fuel_price_halalas_per_l, o.notes, o.project_id, o.created_at order_created_at, o.contract_id, o.package_id, o.reservation_id, (SELECT number FROM contracts WHERE id = o.contract_id) contract_number, (SELECT number FROM trip_packages WHERE id = o.package_id) package_number, (SELECT number FROM capacity_reservations WHERE id = o.reservation_id) reservation_number, (SELECT name FROM users WHERE id = o.created_by) order_created_by, lp.name loading_point_name, lp.city loading_city,
      cl.name_ar client_name, ca.name_ar carrier_name, v.plate, v.capacity_ml vehicle_capacity_ml, d.name driver_name, d.phone driver_phone,
      ad.doc_number, ad.file_id doc_file_id, p.name project_name
    FROM trips t JOIN orders o ON o.id = t.order_id JOIN loading_points lp ON lp.id = o.loading_point_id
    JOIN companies cl ON cl.id = t.company_id JOIN companies ca ON ca.id = t.carrier_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
    LEFT JOIN aramco_documents ad ON ad.id = o.aramco_document_id LEFT JOIN projects p ON p.id = o.project_id
    WHERE t.id = ?`, tripId);
  if (!t) throw new HttpError(404, 'الرحلة غير موجودة');
  const isClient = t.company_id === ctx.companyId;
  const myOffer = ctx.companyType === 'carrier' ? q.get('SELECT * FROM order_offers WHERE order_id = ? AND carrier_id = ?', t.order_id, ctx.companyId) : null;
  const isCarrier = ctx.companyType === 'carrier' && (t.carrier_id === ctx.companyId || myOffer?.status === 'pending');
  const isDriver = ctx.role === 'driver' && t.driver_id === ctx.driverId;
  const isAdmin = ctx.can('platform.view');
  if (!isClient && !isCarrier && !isDriver && !isAdmin) throw new HttpError(404, 'الرحلة غير موجودة');
  if (isClient && ctx.scopeProjectId && t.project_id !== ctx.scopeProjectId) throw new HttpError(404, 'الرحلة غير موجودة');
  const accepted = !['awaiting_acceptance', 'rejected'].includes(t.status);
  const stops = q.all(`SELECT s.*, st.name site_name, st.city, st.lat, st.lng, tk.code tank_code, tk.name tank_name
      FROM trip_stops s JOIN sites st ON st.id = s.site_id LEFT JOIN tanks tk ON tk.id = s.tank_id WHERE s.trip_id = ? ORDER BY seq`, tripId);
  const photos = q.all('SELECT id, stop_id, kind, file_id, lat, lng, captured_at, received_at FROM trip_photos WHERE trip_id = ? ORDER BY captured_at', tripId);
  const events = q.all(`SELECT e.*, u.name actor_name FROM trip_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE trip_id = ? ORDER BY e.id`, tripId);
  const history = q.all(`SELECT h.*, c.name_ar carrier_name, v.plate, d.name driver_name, u.name by_name FROM assignment_history h
      LEFT JOIN companies c ON c.id = h.carrier_id LEFT JOIN vehicles v ON v.id = h.vehicle_id LEFT JOIN drivers d ON d.id = h.driver_id
      LEFT JOIN users u ON u.id = h.by_user WHERE trip_id = ? ORDER BY h.id`, tripId);
  const exceptions = q.all(`SELECT * FROM exceptions WHERE (ref_type='trip' AND ref_id=?) OR (ref_type='trip_stop' AND ref_id IN (SELECT id FROM trip_stops WHERE trip_id=?)) ORDER BY created_at`, tripId, tripId);
  const out = {
    ...t, status_ar: TRIP_STATUS_AR[t.status], stops, photos, events, history,
    exceptions: isClient || isAdmin ? exceptions : [],
    missing_proofs: missingProofs(tripId),
    price: (isClient || isCarrier) && ctx.can('price.view') || ctx.can('platform.finance') ? JSON.parse(t.price_snapshot_json || 'null') : null,
  };
  delete out.price_snapshot_json;
  if (myOffer && t.carrier_id !== ctx.companyId && ctx.can('price.view')) out.price = JSON.parse(myOffer.quote_json || 'null');
  out.offers = (isClient || isAdmin) ? q.all(`SELECT f.*, c.name_ar carrier_name, u.name responded_by_name FROM order_offers f JOIN companies c ON c.id = f.carrier_id LEFT JOIN users u ON u.id = f.responded_by WHERE f.order_id = ? ORDER BY f.sent_at`, t.order_id)
    .map((f) => ({ ...f, status: f.status === 'pending' && f.deadline < now() ? 'expired' : f.status, quote: ctx.can('price.view') || ctx.can('platform.finance') ? JSON.parse(f.quote_json || 'null') : null, quote_json: undefined })) : [];
  out.sibling_trips = q.all('SELECT id, number, status FROM trips WHERE order_id = ? ORDER BY number', t.order_id).map((x) => ({ ...x, status_ar: TRIP_STATUS_AR[x.status] }));
  if (isClient || isAdmin) {
    out.inventory = q.all(`SELECT m.id, m.kind, m.quantity_ml, m.tank_id, m.batch_id, m.effective_at, tk.code tank_code, b.mode FROM fuel_movements m LEFT JOIN tanks tk ON tk.id = m.tank_id LEFT JOIN fuel_batches b ON b.id = m.batch_id
        WHERE m.ref_type = 'trip_stop' AND m.ref_id IN (SELECT id FROM trip_stops WHERE trip_id = ?) ORDER BY m.effective_at`, tripId);
    out.fuelings = q.all(`SELECT f.id, f.number, f.quantity_ml, f.created_at, a.code asset_code, f.source_type FROM fuelings f JOIN assets a ON a.id = f.asset_id
        WHERE f.status = 'approved' AND (f.trip_id = ? OR f.batch_id IN (SELECT b.id FROM fuel_batches b JOIN trip_stops s ON s.id = b.trip_stop_id WHERE s.trip_id = ?)) ORDER BY f.created_at`, tripId, tripId);
    out.invoice = ctx.can('price.view') || ctx.can('platform.finance') ? q.get('SELECT number, total_halalas, paid_halalas, status FROM invoices WHERE trip_id = ?', tripId) : null;
  }
  if (!(ctx.can('price.view') || ctx.can('platform.finance'))) { out.transport_halalas = null; out.fuel_price_halalas_per_l = null; }
  if (isCarrier || isDriver) {
    out.fuel_price_halalas_per_l = null;
    if (!accepted) {
      // قبل القبول: ملخص كافٍ للتسعير فقط
      out.doc_number = null; out.doc_file_id = null; out.notes = null;
      out.stops = stops.map((s) => ({ ...s, receiver_name: null, receiver_phone: null, access_notes: null, receipt_token: undefined }));
    }
    out.stops = out.stops.map((s) => ({ ...s, receipt_token: undefined, tank_id: undefined }));
  }
  if (isClient && !ctx.can('doc.view')) { out.doc_file_id = null; }
  return out;
}
