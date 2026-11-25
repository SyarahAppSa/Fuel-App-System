// «اختر شركة النقل»: بطاقة لكل ناقل معتمد يخدم المسار — مبنية من تغطيته وأسعاره وأسطوله ورحلاته الفعلية
import { q, tx, uid, now, nextNumber, audit, notify, HttpError, L, ML } from '../db.js';
import { eligibleVehicles, eligibleDrivers, planWindow, quotePrice, quoteTrips, quoteFromRequest } from './trips.js';
import * as K from './contracts.js';

const addDays = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

/** التوفر في يوم: هل لدى الناقل n صهريج مؤهل (سعة ≥ حصة الرحلة) وn سائق متاح؟ */
function availabilityOn(carrierId, product, perTripMl, n, date, ws, we) {
  const { start, end } = planWindow(date, ws, we);
  const vs = eligibleVehicles(carrierId, product, perTripMl, start, end).filter((v) => v.eligible);
  const ds = eligibleDrivers(carrierId, start, end).filter((d) => d.eligible);
  return { ok: vs.length >= n && ds.length >= n, vehicles: vs, drivers: ds };
}

/** أداء الناقل عبر فيول آب: الرحلات المنفذة ونسبة الالتزام بالموعد وحجم العينة */
export function performance(carrierId) {
  const done = q.all(`SELECT delivered_at, window_end FROM trips WHERE carrier_id = ? AND accepted_at IS NOT NULL AND status IN ('delivered','under_review','closed')`, carrierId);
  const withWin = done.filter((t) => t.window_end && t.delivered_at);
  const onTime = withWin.filter((t) => t.delivered_at <= t.window_end).length;
  return { trips_done: done.length, on_time_pct: withWin.length ? Math.round((onTime / withWin.length) * 100) : null, sample: withWin.length };
}

export function carrierCards(ctx, p) {
  const { loading_point_id, product } = p;
  const site = p.site_id ? q.get('SELECT * FROM sites WHERE id = ? AND company_id = ?', p.site_id, ctx.companyId) : null;
  const city = site?.city || p.city;
  const qty = ML(p.quantity_liters);
  if (!loading_point_id || !city || !product || !(qty > 0) || !p.date) throw new HttpError(400, 'حدد نقطة التحميل وموقع التسليم ونوع الوقود والكمية والموعد');
  const exclude = new Set(String(p.exclude || '').split(',').filter(Boolean));
  if (p.order_id) for (const r of q.all("SELECT carrier_id FROM order_offers WHERE order_id = ? AND status = 'rejected'", p.order_id)) exclude.add(r.carrier_id);
  const favs = new Set(q.all('SELECT carrier_id FROM favorite_carriers WHERE client_id = ?', ctx.companyId).map((r) => r.carrier_id));
  // الناقلون المعتمدون الذين يغطون نقطة التحميل ومدينة التسليم معًا
  const carriers = q.all(`SELECT c.* FROM companies c WHERE c.type = 'carrier' AND c.status = 'approved'
      AND EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = c.id AND cc.kind = 'loading' AND cc.ref = ?)
      AND EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = c.id AND cc.kind = 'delivery' AND cc.ref = ?) ORDER BY c.name_ar`, loading_point_id, city);
  const k = K.contractOffers(ctx, { loading_point_id, city, product, quantity_ml: qty, date: p.date, project_id: site?.project_id || p.project_id });

  const cards = carriers.filter((c) => !exclude.has(c.id)).map((c) => {
    const coverage = q.all("SELECT cc.kind, COALESCE(lp.name, cc.ref) label FROM carrier_coverage cc LEFT JOIN loading_points lp ON lp.id = cc.ref WHERE cc.carrier_id = ?", c.id);
    const caps = q.all("SELECT capacity_ml, products FROM vehicles WHERE company_id = ? AND status = 'active'", c.id).filter((v) => v.products.split(',').includes(product)).map((v) => v.capacity_ml);
    const maxCap = caps.length ? Math.max(...caps) : 0;
    const card = { carrier_id: c.id, name: c.name_ar, city: c.city, logo_url: c.logo_file_id ? `/api/public/logos/${c.id}` : null, favorite: favs.has(c.id),
      loading: coverage.filter((x) => x.kind === 'loading').map((x) => x.label), delivery: coverage.filter((x) => x.kind === 'delivery').map((x) => x.label), ...performance(c.id) };
    if (!maxCap) return { ...card, available: false, earliest_date: null, reason: 'لا يملك صهاريج نشطة لهذا المنتج', price: null };
    const n = qty <= maxCap ? 1 : Math.ceil(qty / maxCap);
    const perTrip = Math.ceil(qty / n);
    const qtys = Array.from({ length: n }, (_, i) => (i === n - 1 ? qty - Math.floor(qty / n) * (n - 1) : Math.floor(qty / n)));
    // أقرب موعد متاح: الموعد المطلوب أو أول يوم متاح خلال 14 يومًا
    let earliest = null, av = null;
    for (let i = 0; i <= 14 && !earliest; i++) { const d = addDays(p.date, i); const a = availabilityOn(c.id, product, perTrip, n, d, p.window_start, p.window_end); if (a.ok) { earliest = d; av = a; } }
    const suitable = av ? Math.min(...av.vehicles.map((v) => v.capacity_ml)) : caps.filter((x) => x >= perTrip).sort((a, b) => a - b)[0] || maxCap;
    // مصدر السعر: عقد ← عرض سعر مقبول ← سعر منشور ← «اطلب عرض سعر»
    const cr = k.rates.find((r) => r.carrier_id === c.id);
    const rp = q.get('SELECT * FROM route_prices WHERE carrier_id = ? AND loading_point_id = ? AND delivery_city = ? AND product = ? AND active = 1', c.id, loading_point_id, city, product);
    const qr = q.get(`SELECT * FROM quote_requests WHERE client_id = ? AND carrier_id = ? AND loading_point_id = ? AND delivery_city = ? AND product = ? AND status IN ('pending','quoted','declined')
        AND quantity_ml >= ? ORDER BY created_at DESC LIMIT 1`, ctx.companyId, c.id, loading_point_id, city, product, qty);
    const qrValid = qr && qr.status === 'quoted' && (!qr.valid_until || qr.valid_until >= now());
    let price = null;
    if (cr) price = { source: 'contract', label: `سعر العقد ${cr.contract_number}`, contract_rate_id: cr.id, quote: { ...quoteTrips(cr, qtys), contract_number: cr.contract_number } };
    else if (qrValid) price = { source: 'quote', label: `عرض سعر ${qr.number}`, quote_request_id: qr.id, valid_until: qr.valid_until, quote: quoteFromRequest(qr) };
    else if (rp) price = { source: 'public', label: rp.pricing_type === 'fixed' ? 'سعر ثابت للرحلة' : 'سعر لكل 1000 لتر', route_price_id: rp.id, quote: quoteTrips(rp, qtys) };
    const pkg = k.packages.find((x) => x.carrier_id === c.id && x.fits && x.project_available > 0);
    return { ...card, available: earliest === p.date, earliest_date: earliest, trips_needed: n, per_trip_l: L(perTrip), suitable_capacity_l: suitable ? L(suitable) : null,
      reason: earliest ? null : 'لا يوجد صهريج وسائق متاحان خلال 14 يومًا', price, package: pkg ? { package_id: pkg.id, number: pkg.number, available: pkg.project_available, quote: K.packageQuote(pkg) } : null,
      quote_request: qr ? { id: qr.id, number: qr.number, status: qrValid ? 'quoted' : qr.status === 'quoted' ? 'expired' : qr.status, price_halalas: qr.price_halalas, valid_until: qr.valid_until, earliest_date: qr.earliest_date, note: qr.carrier_note } : null };
  });
  const sort = p.sort || 'price';
  const priceOf = (x) => (x.price ? x.price.quote.total_halalas : Infinity);
  const dateOf = (x) => x.earliest_date || '9999';
  const perfOf = (x) => (x.on_time_pct == null ? -1 : x.on_time_pct * 1000 + x.sample);
  cards.sort((a, b) => sort === 'earliest' ? dateOf(a).localeCompare(dateOf(b)) || priceOf(a) - priceOf(b)
    : sort === 'performance' ? perfOf(b) - perfOf(a) || b.trips_done - a.trips_done
      : priceOf(a) - priceOf(b) || dateOf(a).localeCompare(dateOf(b)));
  const anyOnDate = cards.some((c) => c.available);
  const earliestOverall = cards.map((c) => c.earliest_date).filter(Boolean).sort()[0] || null;
  return { cards, city, quantity_l: L(qty), date: p.date, any_on_date: anyOnDate, earliest_overall: earliestOverall, excluded: [...exclude] };
}

/* ------------------------------------------------------------------ */
/* طلب عرض سعر                                                          */
/* ------------------------------------------------------------------ */
export function requestQuote(ctx, b) {
  const site = q.get('SELECT * FROM sites WHERE id = ? AND company_id = ?', b.site_id, ctx.companyId);
  if (!site) throw new HttpError(400, 'حدد موقع التسليم');
  const c = q.get(`SELECT c.* FROM companies c WHERE c.id = ? AND c.type = 'carrier' AND c.status = 'approved'
      AND EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = c.id AND cc.kind='loading' AND cc.ref = ?)
      AND EXISTS (SELECT 1 FROM carrier_coverage cc WHERE cc.carrier_id = c.id AND cc.kind='delivery' AND cc.ref = ?)`, b.carrier_id, b.loading_point_id, site.city);
  if (!c) throw new HttpError(409, 'الناقل لا يخدم هذا المسار');
  if (q.get("SELECT 1 FROM quote_requests WHERE client_id = ? AND carrier_id = ? AND loading_point_id = ? AND delivery_city = ? AND product = ? AND status = 'pending'", ctx.companyId, c.id, b.loading_point_id, site.city, b.product))
    throw new HttpError(409, 'يوجد طلب عرض سعر بانتظار رد هذا الناقل');
  const id = uid('qr_'); const number = nextNumber('quote', 'FA-RFQ');
  q.run(`INSERT INTO quote_requests(id,number,client_id,carrier_id,loading_point_id,delivery_city,site_id,product,quantity_ml,requested_date,window_start,window_end,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, number, ctx.companyId, c.id, b.loading_point_id, site.city, site.id, b.product, ML(b.quantity_liters), b.date, b.window_start || null, b.window_end || null, ctx.userId);
  audit(ctx, 'quote.request', 'quote_request', id, { carrier: c.id });
  notify(c.id, 'dispatcher', `طلب عرض سعر ${number}`, `${b.quantity_liters} لتر · ${site.city}`, '/quotes', `rfq:${id}`);
  return { id, number };
}

export function listQuotes(ctx) {
  const col = ctx.companyType === 'carrier' ? 'r.carrier_id' : 'r.client_id';
  return q.all(`SELECT r.*, cl.name_ar client_name, ca.name_ar carrier_name, lp.name loading_point_name FROM quote_requests r JOIN companies cl ON cl.id = r.client_id
      JOIN companies ca ON ca.id = r.carrier_id JOIN loading_points lp ON lp.id = r.loading_point_id WHERE ${col} = ? ORDER BY r.created_at DESC LIMIT 200`, ctx.companyId)
    .map((r) => ({ ...r, status: r.status === 'quoted' && r.valid_until && r.valid_until < now() ? 'expired' : r.status }));
}

export function respondQuote(ctx, id, b) {
  return tx(() => {
    const r = q.get("SELECT * FROM quote_requests WHERE id = ? AND carrier_id = ? AND status = 'pending'", id, ctx.companyId);
    if (!r) throw new HttpError(404, 'طلب عرض السعر غير موجود أو تم الرد عليه');
    if (b.decline) {
      if (!b.reason) throw new HttpError(400, 'اذكر سبب الاعتذار');
      q.run("UPDATE quote_requests SET status='declined', carrier_note=?, responded_by=?, responded_at=? WHERE id = ?", b.reason, ctx.userId, now(), id);
    } else {
      if (!(Number(b.price_sar) > 0)) throw new HttpError(400, 'أدخل سعر النقل الإجمالي');
      const valid = new Date(Date.now() + (Number(b.valid_hours) || 48) * 3600e3).toISOString();
      q.run("UPDATE quote_requests SET status='quoted', price_halalas=?, valid_until=?, earliest_date=?, carrier_note=?, responded_by=?, responded_at=? WHERE id = ?",
        Math.round(b.price_sar * 100), valid, b.earliest_date || r.requested_date, b.note || null, ctx.userId, now(), id);
    }
    audit(ctx, b.decline ? 'quote.decline' : 'quote.respond', 'quote_request', id, { price_sar: b.price_sar });
    notify(r.client_id, 'procurement', b.decline ? `اعتذر ${ctx.companyName} عن عرض السعر ${r.number}` : `وصل عرض سعر ${r.number} من ${ctx.companyName}`, '', '/orders/new', `rfq-r:${id}`);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* المفضلون والشعار والتسجيل                                            */
/* ------------------------------------------------------------------ */
export function setFavorite(ctx, carrierId, on) {
  if (!q.get("SELECT 1 FROM companies WHERE id = ? AND type = 'carrier'", carrierId)) throw new HttpError(404, 'الناقل غير موجود');
  if (on) q.run('INSERT OR IGNORE INTO favorite_carriers(client_id,carrier_id) VALUES (?,?)', ctx.companyId, carrierId);
  else q.run('DELETE FROM favorite_carriers WHERE client_id = ? AND carrier_id = ?', ctx.companyId, carrierId);
  return { ok: true, favorite: !!on };
}
