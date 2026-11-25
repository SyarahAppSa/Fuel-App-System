// الدفعة الأولى — تجربة الحجز: دليل الناقلين وملفاتهم، المفضلون لكل مشروع، التقييم، العرض البديل، وصفحات المشروع والموقع
import { q, tx, uid, now, audit, notify, HttpError, L, ML } from '../db.js';
import { performance } from './market.js';
import { quotePrice, planWindow, TRIP_STATUS_AR, missingProofs } from './trips.js';
import { tankBalance } from './inventory.js';
import { PRODUCTS } from './documents.js';

/* ------------------------------------------------------------------ */
/* التقييم                                                              */
/* ------------------------------------------------------------------ */
export function ratingSummary(carrierId) {
  const r = q.get(`SELECT COUNT(*) n, AVG(on_time) t, AVG(communication) c, AVG(documentation) d FROM trip_ratings WHERE carrier_id = ?`, carrierId);
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  return { count: r.n, on_time: r1(r.t), communication: r1(r.c), documentation: r1(r.d), overall: r.n ? r1((r.t + r.c + r.d) / 3) : null };
}

export function rateTrip(ctx, tripId, b) {
  const t = q.get('SELECT * FROM trips WHERE id = ? AND company_id = ?', tripId, ctx.companyId);
  if (!t) throw new HttpError(404, 'الرحلة غير موجودة');
  if (!t.delivered_at || !['delivered', 'under_review', 'closed'].includes(t.status)) throw new HttpError(409, 'التقييم بعد التسليم فقط');
  if (q.get("SELECT 1 FROM trip_stops WHERE trip_id = ? AND receiver_ack IS NULL", t.id)) throw new HttpError(409, 'التقييم بعد تأكيد المستلم للكمية');
  if (q.get('SELECT 1 FROM trip_ratings WHERE trip_id = ?', t.id)) throw new HttpError(409, 'قُيّمت هذه الرحلة سابقًا');
  const v = ['on_time', 'communication', 'documentation'].map((k) => Number(b[k]));
  if (v.some((x) => !(x >= 1 && x <= 5))) throw new HttpError(400, 'قيّم كل معيار من 1 إلى 5');
  q.run('INSERT INTO trip_ratings(trip_id,client_id,carrier_id,on_time,communication,documentation,comment,rated_by) VALUES (?,?,?,?,?,?,?,?)', t.id, ctx.companyId, t.carrier_id, ...v, b.comment || null, ctx.userId);
  audit(ctx, 'trip.rate', 'trip', t.id, { on_time: v[0], communication: v[1], documentation: v[2] });
  notify(t.carrier_id, 'carrier_admin', `تقييم جديد للرحلة ${t.number}`, `${Math.round((v[0] + v[1] + v[2]) / 3 * 10) / 10} من 5`, '/trips/' + t.id, `rate:${t.id}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* دليل الناقلين وملف الناقل                                              */
/* ------------------------------------------------------------------ */
function carrierFacts(ctx, c) {
  const coverage = q.all("SELECT cc.id, cc.kind, cc.ref, COALESCE(lp.name, cc.ref) label FROM carrier_coverage cc LEFT JOIN loading_points lp ON lp.id = cc.ref WHERE cc.carrier_id = ?", c.id);
  const vehicles = q.all("SELECT capacity_ml, products, status, docs_valid_until FROM vehicles WHERE company_id = ?", c.id);
  const active = vehicles.filter((v) => v.status === 'active' && (!v.docs_valid_until || v.docs_valid_until >= now().slice(0, 10)));
  const products = [...new Set([...active.flatMap((v) => v.products.split(',')), ...q.all('SELECT DISTINCT product FROM route_prices WHERE carrier_id = ? AND active = 1', c.id).map((x) => x.product)])];
  const caps = [...new Set(active.map((v) => L(v.capacity_ml)))].sort((a, b) => a - b);
  const fees = q.get('SELECT MIN(waiting_fee_halalas_per_hour) wmin, MAX(waiting_fee_halalas_per_hour) wmax, MIN(cancel_fee_halalas) cmin, MAX(cancel_fee_halalas) cmax, MIN(free_waiting_hours) free FROM route_prices WHERE carrier_id = ? AND active = 1', c.id);
  const resp = q.get('SELECT AVG((julianday(responded_at) - julianday(sent_at)) * 1440) m, COUNT(*) n FROM order_offers WHERE carrier_id = ? AND responded_at IS NOT NULL', c.id);
  const fav = ctx ? !!q.get('SELECT 1 FROM favorite_carriers WHERE client_id = ? AND carrier_id = ?', ctx.companyId, c.id) : false;
  return {
    id: c.id, name: c.name_ar, name_en: c.name_en, city: c.city, logo_url: c.logo_file_id ? `/api/public/logos/${c.id}` : null, favorite: fav,
    loading: coverage.filter((x) => x.kind === 'loading').map((x) => ({ id: x.ref, label: x.label })), delivery: coverage.filter((x) => x.kind === 'delivery').map((x) => x.ref),
    products: products.map((p) => ({ key: p, label: PRODUCTS[p] || p })), capacities_l: caps, active_vehicles: active.length, drivers: q.get("SELECT COUNT(*) n FROM drivers WHERE company_id = ? AND status = 'active'", c.id).n,
    fees: fees.wmax == null ? null : { waiting_min: fees.wmin, waiting_max: fees.wmax, free_hours: fees.free, cancel_min: fees.cmin, cancel_max: fees.cmax },
    avg_response_min: resp.n ? Math.round(resp.m) : null, response_sample: resp.n, ...performance(c.id), rating: ratingSummary(c.id),
  };
}

export function carrierDirectory(ctx, f = {}) {
  const where = ["c.type = 'carrier'", "c.status = 'approved'"]; const p = [];
  if (f.loading_point_id) { where.push("EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = c.id AND cc.kind = 'loading' AND cc.ref = ?)"); p.push(f.loading_point_id); }
  if (f.city) { where.push("EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = c.id AND cc.kind = 'delivery' AND cc.ref = ?)"); p.push(f.city); }
  if (f.q) { where.push('(c.name_ar LIKE ? OR c.name_en LIKE ?)'); p.push(`%${f.q}%`, `%${f.q}%`); }
  let rows = q.all(`SELECT * FROM companies c WHERE ${where.join(' AND ')} ORDER BY c.name_ar`, ...p).map((c) => carrierFacts(ctx, c));
  if (f.product) rows = rows.filter((r) => r.products.some((x) => x.key === f.product));
  if (f.favorites === '1') rows = rows.filter((r) => r.favorite);
  const pref = f.project_id ? Object.fromEntries(q.all('SELECT carrier_id, priority FROM preferred_carriers WHERE client_id = ? AND project_id = ?', ctx.companyId, f.project_id).map((x) => [x.carrier_id, x.priority])) : {};
  rows = rows.map((r) => ({ ...r, project_priority: pref[r.id] ?? null }));
  rows.sort((a, b) => (a.project_priority ?? 99) - (b.project_priority ?? 99) || (b.favorite - a.favorite) || ((b.rating.overall ?? 0) - (a.rating.overall ?? 0)) || b.trips_done - a.trips_done);
  return rows;
}

export function carrierProfile(ctx, id) {
  const c = q.get("SELECT * FROM companies WHERE id = ? AND type = 'carrier' AND status = 'approved'", id);
  if (!c) throw new HttpError(404, 'الناقل غير موجود');
  const facts = carrierFacts(ctx, c);
  const routes = q.all(`SELECT rp.*, lp.name loading_point_name FROM route_prices rp JOIN loading_points lp ON lp.id = rp.loading_point_id WHERE rp.carrier_id = ? AND rp.active = 1 ORDER BY lp.name, rp.delivery_city`, id)
    .map((r) => ({ id: r.id, loading_point_id: r.loading_point_id, loading_point_name: r.loading_point_name, delivery_city: r.delivery_city, product: r.product, product_ar: PRODUCTS[r.product], pricing_type: r.pricing_type,
      price_halalas: r.price_halalas, waiting_fee_halalas_per_hour: r.waiting_fee_halalas_per_hour, free_waiting_hours: r.free_waiting_hours, cancel_fee_halalas: r.cancel_fee_halalas, accept_within_minutes: r.accept_within_minutes }));
  const fleet = q.all("SELECT capacity_ml, products, status FROM vehicles WHERE company_id = ? ORDER BY capacity_ml DESC", id).map((v) => ({ capacity_l: L(v.capacity_ml), products: v.products.split(',').map((p) => PRODUCTS[p] || p), status: v.status }));
  const reviews = q.all('SELECT r.on_time, r.communication, r.documentation, r.comment, r.created_at, cl.name_ar client_name FROM trip_ratings r JOIN companies cl ON cl.id = r.client_id WHERE r.carrier_id = ? ORDER BY r.created_at DESC LIMIT 6', id)
    .map((r) => ({ ...r, client_name: ctx.companyId === undefined ? null : r.client_name.replace(/\s*\(.*\)$/, '').split(' ').slice(0, 2).join(' ') }));
  const myTrips = ctx.companyType === 'client' ? q.all(`SELECT t.id, t.number, t.status, t.delivered_at FROM trips t WHERE t.company_id = ? AND t.carrier_id = ? AND t.accepted_at IS NOT NULL ORDER BY t.created_at DESC LIMIT 8`, ctx.companyId, id).map((t) => ({ ...t, status_ar: TRIP_STATUS_AR[t.status] })) : [];
  const contracts = ctx.companyType === 'client' ? q.all("SELECT number, type, start_date, end_date, status FROM contracts WHERE client_id = ? AND carrier_id = ?", ctx.companyId, id) : [];
  const preferredIn = ctx.companyType === 'client' ? q.all('SELECT pc.project_id, pc.priority, p.code, p.name FROM preferred_carriers pc JOIN projects p ON p.id = pc.project_id WHERE pc.client_id = ? AND pc.carrier_id = ?', ctx.companyId, id) : [];
  const docs = q.all("SELECT doc_type, expires_at, status FROM company_documents WHERE company_id = ? AND status = 'approved'", id);
  return { ...facts, cr_number: c.cr_number, routes, fleet, reviews, my_trips: myTrips, contracts, preferred_in: preferredIn, documents: docs };
}

/** ترتيب الناقلين المفضلين لمشروع: قائمة مرتبة تستبدل السابقة */
export function setProjectPreferred(ctx, projectId, carrierIds) {
  if (!q.get('SELECT 1 FROM projects WHERE id = ? AND company_id = ?', projectId, ctx.companyId)) throw new HttpError(404, 'المشروع غير موجود');
  return tx(() => {
    q.run('DELETE FROM preferred_carriers WHERE client_id = ? AND project_id = ?', ctx.companyId, projectId);
    (carrierIds || []).slice(0, 10).forEach((cid, i) => {
      if (!q.get("SELECT 1 FROM companies WHERE id = ? AND type = 'carrier'", cid)) throw new HttpError(400, 'ناقل غير معروف');
      q.run('INSERT INTO preferred_carriers(client_id,project_id,carrier_id,priority,created_by) VALUES (?,?,?,?,?)', ctx.companyId, projectId, cid, i + 1, ctx.userId);
    });
    audit(ctx, 'project.preferred_carriers', 'project', projectId, { carriers: carrierIds });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* العرض البديل من الناقل                                                */
/* ------------------------------------------------------------------ */
export function proposeCounter(ctx, tripId, b) {
  return tx(() => {
    const t = q.get('SELECT * FROM trips WHERE id = ?', tripId);
    const off = t && q.get("SELECT * FROM order_offers WHERE order_id = ? AND carrier_id = ? AND status = 'pending'", t.order_id, ctx.companyId);
    if (!t || !off) throw new HttpError(404, 'الطلب غير موجود');
    if (t.status !== 'awaiting_acceptance') throw new HttpError(409, 'العرض البديل قبل القبول فقط');
    if (!(Number(b.price_sar) > 0)) throw new HttpError(400, 'حدد سعر النقل للعرض البديل');
    if (!b.date && !b.liters) throw new HttpError(400, 'اقترح موعدًا أو سعة مختلفة');
    const o = q.get('SELECT * FROM orders WHERE id = ?', t.order_id);
    if (b.date && b.date < now().slice(0, 10)) throw new HttpError(400, 'الموعد المقترح في الماضي');
    if (b.liters) {
      if (q.get('SELECT COUNT(*) n FROM trips WHERE order_id = ?', o.id).n !== 1 || q.get('SELECT COUNT(*) n FROM trip_stops WHERE trip_id = ?', t.id).n !== 1) throw new HttpError(409, 'تعديل السعة متاح لطلب برحلة ونقطة تسليم واحدة');
      if (ML(b.liters) >= o.quantity_ml) throw new HttpError(400, 'السعة المقترحة يجب أن تكون أقل من الكمية المطلوبة');
    }
    q.run("UPDATE offer_counters SET status = 'superseded' WHERE order_id = ? AND carrier_id = ? AND status = 'pending'", o.id, ctx.companyId);
    const id = uid('cnt_');
    q.run(`INSERT INTO offer_counters(id,order_id,carrier_id,proposed_date,window_start,window_end,proposed_ml,price_halalas,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id, o.id, ctx.companyId, b.date || null, b.window_start || null, b.window_end || null, b.liters ? ML(b.liters) : null, Math.round(b.price_sar * 100), b.note || null, ctx.userId);
    // مهلة قرار العميل 24 ساعة؛ الحجز لا يُثبت قبل قبوله
    q.run('UPDATE order_offers SET deadline = ? WHERE id = ?', new Date(Date.now() + 24 * 3600e3).toISOString(), off.id);
    audit(ctx, 'offer.counter', 'order', o.id, { date: b.date, liters: b.liters, price_sar: b.price_sar });
    notify(o.company_id, 'procurement', `عرض بديل من ${ctx.companyName} للطلب ${o.number}`, [b.date && `موعد ${b.date}`, b.liters && `${b.liters} لتر`, `${b.price_sar} ر.س`].filter(Boolean).join(' · '), '/trips/' + t.id, `counter:${id}`);
    return { id };
  });
}

export function decideCounter(ctx, counterId, accept, note) {
  return tx(() => {
    const c = q.get("SELECT k.*, o.company_id FROM offer_counters k JOIN orders o ON o.id = k.order_id WHERE k.id = ? AND k.status = 'pending'", counterId);
    if (!c || c.company_id !== ctx.companyId) throw new HttpError(404, 'العرض البديل غير موجود');
    const o = q.get('SELECT * FROM orders WHERE id = ?', c.order_id);
    const off = q.get("SELECT * FROM order_offers WHERE order_id = ? AND carrier_id = ? AND status = 'pending'", o.id, c.carrier_id);
    if (!off) throw new HttpError(409, 'انتهى العرض');
    const trips = q.all("SELECT * FROM trips WHERE order_id = ? AND status = 'awaiting_acceptance'", o.id);
    if (!accept) {
      q.run("UPDATE offer_counters SET status = 'declined', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", ctx.userId, now(), note || null, c.id);
      q.run("UPDATE order_offers SET status = 'rejected', reason = 'رفض العميل العرض البديل', responded_at = COALESCE(responded_at, ?) WHERE id = ?", now(), off.id);
      if (!q.get("SELECT 1 FROM order_offers WHERE order_id = ? AND status = 'pending'", o.id)) {
        for (const t of trips) q.run("UPDATE trips SET status = 'rejected', reject_reason = 'رفض العميل العرض البديل' WHERE id = ?", t.id);
        q.run("UPDATE orders SET status = 'rejected' WHERE id = ?", o.id);
      }
      audit(ctx, 'offer.counter.decline', 'order', o.id);
      notify(c.carrier_id, 'dispatcher', `رفض العميل عرضك البديل للطلب ${o.number}`, note || '', '/trips/' + trips[0]?.id, `counter-d:${c.id}`);
      return { ok: true, accepted: false };
    }
    // قبول التعديل: تحديث الموعد/الكمية والسعر ثم تثبيت الحجز مع الناقل
    const date = c.proposed_date || o.requested_date;
    const toHHMM = (iso) => new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(11, 16);
    const { start, end } = planWindow(date, c.window_start || toHHMM(o.window_start), c.window_end || toHHMM(o.window_end));
    const quote = { ...quotePrice({ pricing_type: 'fixed', price_halalas: c.price_halalas, waiting_fee_halalas_per_hour: 0, free_waiting_hours: 2, cancel_fee_halalas: JSON.parse(o.price_snapshot_json || '{}').terms?.cancel_fee_halalas || 0, accept_within_minutes: 120 }, 0), counter_id: c.id, note: 'عرض بديل مقبول' };
    if (c.proposed_ml) {
      q.run('UPDATE trip_stops SET requested_ml = ? WHERE trip_id = ?', c.proposed_ml, trips[0].id);
      q.run('UPDATE orders SET quantity_ml = ? WHERE id = ?', c.proposed_ml, o.id);
    }
    q.run('UPDATE orders SET requested_date = ?, window_start = ?, window_end = ?, price_snapshot_json = ?, transport_halalas = ?, status = ? WHERE id = ?', date, start, end, JSON.stringify({ ...quote, snapshot_at: now() }), quote.base_halalas, 'accepted', o.id);
    for (const t of trips) {
      q.run("UPDATE trips SET status = 'awaiting_assignment', carrier_id = ?, accepted_at = ?, planned_start = ?, planned_end = ?, window_start = ?, window_end = ? WHERE id = ?", c.carrier_id, now(), start, end, start, end, t.id);
      q.run(`INSERT INTO trip_events(trip_id,type,from_status,to_status,actor_user_id,actor_role,note,captured_at) VALUES (?,'status','awaiting_acceptance','awaiting_assignment',?,?,?,?)`, t.id, ctx.userId, ctx.role, 'قبول العرض البديل', now());
      q.run("INSERT INTO assignment_history(trip_id,carrier_id,action,reason,by_user) VALUES (?,?,'accepted','عرض بديل مقبول من العميل',?)", t.id, c.carrier_id, ctx.userId);
    }
    q.run("UPDATE order_offers SET status = 'accepted', responded_at = COALESCE(responded_at, ?) WHERE id = ?", now(), off.id);
    q.run("UPDATE order_offers SET status = 'withdrawn', reason = 'قبل العميل عرضًا بديلًا' WHERE order_id = ? AND status = 'pending'", o.id);
    q.run("UPDATE offer_counters SET status = 'accepted', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", ctx.userId, now(), note || null, c.id);
    audit(ctx, 'offer.counter.accept', 'order', o.id, { counter: c.id });
    notify(c.carrier_id, 'dispatcher', `قبل العميل عرضك البديل — الطلب ${o.number} مؤكد`, 'أسند الصهريج والسائق', '/trips/' + trips[0].id, `counter-a:${c.id}`);
    return { ok: true, accepted: true };
  });
}

/* ------------------------------------------------------------------ */
/* صفحة المشروع وصفحة الموقع                                             */
/* ------------------------------------------------------------------ */
function daysLeft(tankId, bookMl) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const used = -q.get("SELECT COALESCE(SUM(quantity_ml),0) s FROM fuel_movements WHERE tank_id = ? AND status = 'approved' AND quantity_ml < 0 AND kind IN ('issue','transfer_out') AND effective_at >= ?", tankId, since).s;
  const daily = used / 14;
  return { daily_ml: Math.round(daily), days_left: daily > 0 ? Math.round((bookMl / daily) * 10) / 10 : null, basis_days: 14 };
}

export function siteView(ctx, siteId) {
  const s = q.get(`SELECT s.*, p.code project_code, p.name project_name, u.name access_updated_by_name FROM sites s LEFT JOIN projects p ON p.id = s.project_id LEFT JOIN users u ON u.id = s.access_updated_by
      WHERE s.id = ? AND s.company_id = ?`, siteId, ctx.companyId);
  if (!s || (ctx.scopeProjectId && s.project_id !== ctx.scopeProjectId) || (ctx.scopeSiteId && ctx.scopeSiteId !== s.id)) throw new HttpError(404, 'الموقع غير موجود');
  const tanks = q.all('SELECT * FROM tanks WHERE site_id = ?', s.id).map((t) => { const b = tankBalance(t.id); return { id: t.id, code: t.code, name: t.name, product: t.product, capacity_ml: t.capacity_ml, reorder_ml: t.reorder_ml, book_ml: b.book_ml, ...daysLeft(t.id, b.book_ml) }; });
  const tripRows = q.all(`SELECT t.id, t.number, t.status, t.window_start, t.window_end, t.loaded_ml, t.delivered_at, ca.name_ar carrier_name, v.plate, d.name driver_name, o.number order_number, o.product,
      st.requested_ml, st.delivered_ml, st.returned_ml, st.mode, st.receiver_name, st.receiver_ack, st.receiver_ack_by, st.receiver_ack_at, st.receiver_note, st.id stop_id, tk.code tank_code,
      (SELECT COUNT(DISTINCT kind || COALESCE(stop_id,'')) FROM trip_photos ph WHERE ph.trip_id = t.id AND (ph.stop_id IS NULL OR ph.stop_id = st.id)) photos,
      (SELECT AVG((r.on_time + r.communication + r.documentation) / 3.0) FROM trip_ratings r WHERE r.trip_id = t.id) rating
    FROM trip_stops st JOIN trips t ON t.id = st.trip_id JOIN orders o ON o.id = t.order_id JOIN companies ca ON ca.id = t.carrier_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN tanks tk ON tk.id = st.tank_id
    WHERE st.site_id = ? AND t.status NOT IN ('cancelled','rejected') ORDER BY t.window_start DESC LIMIT 60`, s.id).map((t) => ({ ...t, status_ar: TRIP_STATUS_AR[t.status], rating: t.rating ? Math.round(t.rating * 10) / 10 : null }));
  const upcoming = tripRows.filter((t) => !t.delivered_at).sort((a, b) => a.window_start.localeCompare(b.window_start));
  const delivered = tripRows.filter((t) => t.delivered_at);
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const issued = q.get("SELECT COALESCE(SUM(quantity_ml),0) ml, COUNT(*) n FROM fuelings WHERE site_id = ? AND status = 'approved' AND created_at >= ?", s.id, since30);
  const totals = { requested_ml: delivered.reduce((a, t) => a + t.requested_ml, 0), delivered_ml: delivered.reduce((a, t) => a + (t.delivered_ml || 0), 0), trips: delivered.length,
    confirmed: delivered.filter((t) => t.receiver_ack === 'confirmed').length, disputed: delivered.filter((t) => t.receiver_ack === 'disputed').length,
    full_photos: delivered.filter((t) => t.photos >= 4).length, issued_30d_ml: issued.ml, fuelings_30d: issued.n };
  return { site: s, tanks, upcoming, delivered, totals, generated_at: now() };
}

export function updateSiteAccess(ctx, siteId, b) {
  const s = q.get('SELECT * FROM sites WHERE id = ? AND company_id = ?', siteId, ctx.companyId);
  if (!s) throw new HttpError(404, 'الموقع غير موجود');
  const lat = b.gate_lat === '' || b.gate_lat == null ? null : Number(b.gate_lat), lng = b.gate_lng === '' || b.gate_lng == null ? null : Number(b.gate_lng);
  if ((lat != null && !(lat > 15 && lat < 33)) || (lng != null && !(lng > 34 && lng < 56))) throw new HttpError(400, 'إحداثيات البوابة خارج المملكة');
  q.run(`UPDATE sites SET gate_lat = ?, gate_lng = ?, receiving_hours = ?, receiving_days = ?, receiver_name = ?, receiver_phone = ?, access_notes = ?, access_updated_at = ?, access_updated_by = ? WHERE id = ?`,
    lat, lng, b.receiving_hours || null, b.receiving_days || null, b.receiver_name || s.receiver_name, b.receiver_phone || s.receiver_phone, b.access_notes ?? s.access_notes, now(), ctx.userId, s.id);
  audit(ctx, 'site.access.update', 'site', s.id, b);
  return { ok: true };
}

export function projectView(ctx, projectId) {
  const p = q.get('SELECT p.*, cc.code cost_center_code FROM projects p LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id WHERE p.id = ? AND p.company_id = ?', projectId, ctx.companyId);
  if (!p || (ctx.scopeProjectId && ctx.scopeProjectId !== p.id)) throw new HttpError(404, 'المشروع غير موجود');
  const sites = q.all('SELECT id, name, city, receiver_name, receiving_hours, gate_lat FROM sites WHERE project_id = ?', p.id).map((s) => ({ ...s, tanks: q.all('SELECT id, code FROM tanks WHERE site_id = ?', s.id).map((t) => ({ ...t, book_ml: tankBalance(t.id).book_ml })) }));
  const preferred = q.all(`SELECT pc.carrier_id, pc.priority, c.name_ar, c.logo_file_id FROM preferred_carriers pc JOIN companies c ON c.id = pc.carrier_id WHERE pc.client_id = ? AND pc.project_id = ? ORDER BY pc.priority`, ctx.companyId, p.id)
    .map((x) => ({ ...x, logo_url: x.logo_file_id ? `/api/public/logos/${x.carrier_id}` : null }));
  const orders = q.all(`SELECT o.id, o.number, o.status, o.quantity_ml, o.created_at, ca.name_ar carrier_name, (SELECT id FROM trips WHERE order_id = o.id LIMIT 1) trip_id FROM orders o LEFT JOIN companies ca ON ca.id = o.carrier_id WHERE o.project_id = ? ORDER BY o.created_at DESC LIMIT 10`, p.id);
  const used = q.get("SELECT COALESCE(SUM(quantity_ml),0) ml, COALESCE(SUM(cost_halalas),0) cost FROM fuelings WHERE project_id = ? AND status = 'approved'", p.id);
  return { project: p, sites, preferred, orders, used };
}
