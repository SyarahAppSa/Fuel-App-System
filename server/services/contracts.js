// العقود الشهرية/السنوية، باقات الرحلات، وحجز السعة — مربوطة بالطلب والرحلة نفسها
import { q, tx, uid, now, nextNumber, audit, notify, HttpError, L, ML } from '../db.js';

const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const riyadhDay = (iso) => new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 10);
const VAT = 0.15;

/* ------------------------------------------------------------------ */
/* العقود                                                               */
/* ------------------------------------------------------------------ */
export function createContract(ctx, b) {
  const { carrier_id, type, start_date, rates } = b;
  if (!['monthly', 'annual'].includes(type)) throw new HttpError(400, 'حدد نوع العقد: شهري أو سنوي');
  if (!start_date) throw new HttpError(400, 'حدد تاريخ البداية');
  if (!Array.isArray(rates) || !rates.length) throw new HttpError(400, 'أضف سعر مسار واحدًا على الأقل');
  const carrier = q.get("SELECT * FROM companies WHERE id = ? AND type = 'carrier' AND status = 'approved'", carrier_id);
  if (!carrier) throw new HttpError(400, 'الناقل غير معتمد');
  const end = b.end_date || (() => { const d = new Date(start_date + 'T00:00:00Z'); type === 'monthly' ? d.setUTCMonth(d.getUTCMonth() + 1) : d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
  if (end < start_date) throw new HttpError(400, 'تاريخ النهاية قبل البداية');
  return tx(() => {
    const id = uid('con_'); const number = nextNumber('contract', 'FA-CON');
    q.run(`INSERT INTO contracts(id,number,client_id,carrier_id,type,start_date,end_date,guaranteed_trips_per_month,sla_on_time_pct,delivery_window_hours,auto_renew,allow_backup_carrier,max_backup_price_diff_pct,notes,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, number, ctx.companyId, carrier_id, type, start_date, end, Number(b.guaranteed_trips_per_month) || 0,
      Number(b.sla_on_time_pct) || 95, Number(b.delivery_window_hours) || 8, b.auto_renew ? 1 : 0, b.allow_backup_carrier ? 1 : 0, b.max_backup_price_diff_pct ? Number(b.max_backup_price_diff_pct) : null, b.notes || null, ctx.userId);
    for (const r of rates) {
      if (!r.loading_point_id || !r.delivery_city || !(Number(r.price_sar) > 0)) throw new HttpError(400, 'أكمل بيانات كل سعر مسار');
      q.run(`INSERT INTO contract_rates(id,contract_id,loading_point_id,delivery_city,product,pricing_type,price_halalas,waiting_fee_halalas_per_hour,cancel_fee_halalas)
          VALUES (?,?,?,?,?,?,?,?,?)`, uid('cr_'), id, r.loading_point_id, r.delivery_city, r.product || 'diesel', r.pricing_type || 'fixed',
        Math.round(r.price_sar * 100), Math.round((r.waiting_fee_sar || 0) * 100), Math.round((r.cancel_fee_sar || 0) * 100));
    }
    audit(ctx, 'contract.create', 'contract', id, { carrier_id, type, start_date, end });
    notify(carrier_id, 'carrier_admin', `عقد ${type === 'monthly' ? 'شهري' : 'سنوي'} جديد ${number}`, ctx.companyName, '/contracts', `con:${id}`);
    return { id, number };
  });
}

function contractUsage(c) {
  const monthStart = today().slice(0, 7) + '-01';
  const trips = q.all(`SELECT t.id, t.status, t.created_at, t.window_end, t.delivered_at FROM trips t JOIN orders o ON o.id = t.order_id WHERE o.contract_id = ?`, c.id);
  const active = trips.filter((t) => !['cancelled', 'rejected'].includes(t.status));
  const thisMonth = active.filter((t) => riyadhDay(t.created_at) >= monthStart).length;
  const withWin = active.filter((t) => t.delivered_at && t.window_end);
  const onTime = withWin.filter((t) => t.delivered_at <= t.window_end).length;
  return {
    total_trips: active.length, this_month_trips: thisMonth,
    over_guarantee: c.guaranteed_trips_per_month > 0 && thisMonth > c.guaranteed_trips_per_month,
    on_time_pct: withWin.length ? Math.round((onTime / withWin.length) * 100) : null, on_time_sample: withWin.length,
    sla_breached: withWin.length >= 3 && Math.round((onTime / withWin.length) * 100) < c.sla_on_time_pct,
    spend_halalas: q.get(`SELECT COALESCE(SUM(transport_halalas),0) s FROM orders WHERE contract_id = ? AND status NOT IN ('cancelled','rejected')`, c.id).s,
  };
}
export function contractState(c) {
  if (c.status !== 'active') return c.status;
  if (c.end_date < today()) return 'expired';
  if (c.start_date > today()) return 'scheduled';
  return 'active';
}
export function listContracts(ctx) {
  const col = ctx.companyType === 'carrier' ? 'carrier_id' : 'client_id';
  return q.all(`SELECT c.*, cl.name_ar client_name, ca.name_ar carrier_name FROM contracts c JOIN companies cl ON cl.id = c.client_id JOIN companies ca ON ca.id = c.carrier_id
      WHERE c.${col} = ? ORDER BY c.created_at DESC`, ctx.companyId).map((c) => ({
    ...c, state: contractState(c), usage: contractUsage(c),
    rates: q.all('SELECT r.*, lp.name loading_point_name FROM contract_rates r JOIN loading_points lp ON lp.id = r.loading_point_id WHERE contract_id = ?', c.id),
  }));
}

/* ------------------------------------------------------------------ */
/* الباقات                                                              */
/* ------------------------------------------------------------------ */
export function createPackage(ctx, b) {
  const carrier = q.get("SELECT * FROM companies WHERE id = ? AND type='carrier' AND status='approved'", b.carrier_id);
  if (!carrier) throw new HttpError(400, 'الناقل غير معتمد');
  const trips = Number(b.total_trips);
  if (!(trips > 0) || !(Number(b.price_sar) > 0) || !b.loading_point_id || !b.delivery_city || !b.expiry_date) throw new HttpError(400, 'أكمل عدد الرحلات والسعر والمسار وتاريخ الانتهاء');
  const allocs = (b.allocations || []).filter((a) => a.project_id && Number(a.trips) > 0);
  if (allocs.reduce((s, a) => s + Number(a.trips), 0) > trips) throw new HttpError(400, 'مجموع التوزيع على المشاريع يتجاوز عدد رحلات الباقة');
  return tx(() => {
    const id = uid('pkg_'); const number = nextNumber('package', 'FA-PKG');
    q.run(`INSERT INTO trip_packages(id,number,client_id,carrier_id,contract_id,loading_point_id,delivery_city,product,max_liters_per_trip_ml,total_trips,price_halalas,start_date,expiry_date,late_cancel_consumes,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, number, ctx.companyId, b.carrier_id, b.contract_id || null, b.loading_point_id, b.delivery_city, b.product || 'diesel',
      ML(b.max_liters_per_trip || 36000), trips, Math.round(b.price_sar * 100), b.start_date || today(), b.expiry_date, b.late_cancel_consumes === false ? 0 : 1, ctx.userId);
    for (const a of allocs) {
      if (!q.get('SELECT 1 FROM projects WHERE id = ? AND company_id = ?', a.project_id, ctx.companyId)) throw new HttpError(400, 'مشروع غير صحيح');
      q.run('INSERT INTO package_allocations(id,package_id,project_id,trips) VALUES (?,?,?,?)', uid('pa_'), id, a.project_id, Number(a.trips));
    }
    audit(ctx, 'package.create', 'package', id, { trips, carrier: b.carrier_id });
    notify(b.carrier_id, 'carrier_admin', `باقة رحلات جديدة ${number}`, `${trips} رحلة`, '/contracts', `pkg:${id}`);
    return { id, number };
  });
}

/** أرصدة الباقة: إجمالي، محجوز (طلبات لم تُسلّم)، منفذ (مخصوم)، متوافر — وحسب المشروع */
export function packageBalance(pkgId) {
  const p = q.get('SELECT * FROM trip_packages WHERE id = ?', pkgId);
  const rows = q.all('SELECT trip_id, project_id, kind FROM package_ledger WHERE package_id = ?', pkgId);
  const byTrip = {};
  for (const r of rows) (byTrip[r.trip_id] ||= { project_id: r.project_id, kinds: new Set() }).kinds.add(r.kind);
  let reserved = 0, consumed = 0; const proj = {};
  for (const t of Object.values(byTrip)) {
    const pr = (proj[t.project_id || '-'] ||= { reserved: 0, consumed: 0 });
    if (t.kinds.has('consume')) { consumed++; pr.consumed++; }
    else if (t.kinds.has('reserve') && !t.kinds.has('release')) { reserved++; pr.reserved++; }
  }
  const allocations = q.all('SELECT a.*, pr.code project_code, pr.name project_name FROM package_allocations a JOIN projects pr ON pr.id = a.project_id WHERE package_id = ?', pkgId)
    .map((a) => ({ ...a, reserved: proj[a.project_id]?.reserved || 0, consumed: proj[a.project_id]?.consumed || 0, available: a.trips - (proj[a.project_id]?.reserved || 0) - (proj[a.project_id]?.consumed || 0) }));
  const allocated = allocations.reduce((s, a) => s + a.trips, 0);
  const allocUsed = allocations.reduce((s, a) => s + a.reserved + a.consumed, 0);
  const unallocatedUsed = reserved + consumed - allocUsed;
  return { total: p.total_trips, reserved, consumed, available: p.total_trips - reserved - consumed, allocations,
    unallocated: { trips: p.total_trips - allocated, used: unallocatedUsed, available: p.total_trips - allocated - unallocatedUsed },
    unit_price_halalas: Math.round(p.price_halalas / p.total_trips) };
}
export function packageState(p) {
  if (p.status !== 'active') return p.status;
  if (p.expiry_date < today()) return 'expired';
  if (packageBalance(p.id).available <= 0) return 'exhausted';
  return 'active';
}
export function listPackages(ctx) {
  const col = ctx.companyType === 'carrier' ? 'carrier_id' : 'client_id';
  return q.all(`SELECT p.*, cl.name_ar client_name, ca.name_ar carrier_name, lp.name loading_point_name FROM trip_packages p JOIN companies cl ON cl.id = p.client_id
      JOIN companies ca ON ca.id = p.carrier_id JOIN loading_points lp ON lp.id = p.loading_point_id WHERE p.${col} = ? ORDER BY p.created_at DESC`, ctx.companyId)
    .map((p) => ({ ...p, state: packageState(p), balance: packageBalance(p.id),
      ledger: q.all('SELECT l.*, t.number trip_number FROM package_ledger l JOIN trips t ON t.id = l.trip_id WHERE package_id = ? ORDER BY l.id DESC LIMIT 30', p.id) }));
}

/** المتاح لمشروع: من حصته إن وُزعت الباقة، وإلا من غير الموزّع */
function availableForProject(bal, projectId) {
  const a = bal.allocations.find((x) => x.project_id === projectId);
  if (a) return a.available + Math.max(0, bal.unallocated.available);
  return bal.unallocated.available;
}

/* ------------------------------------------------------------------ */
/* حجز السعة                                                            */
/* ------------------------------------------------------------------ */
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5) + 1; }

/** سعة الناقل في فترة: الصهاريج المؤهلة × الأيام، مطروحًا منها الحجوزات المؤكدة المتداخلة */
export function carrierCapacity(carrierId, product, start, end, excludeId) {
  const vehicles = q.all("SELECT * FROM vehicles WHERE company_id = ? AND status = 'active' AND (docs_valid_until IS NULL OR docs_valid_until >= ?)", carrierId, end)
    .filter((v) => v.products.split(',').includes(product)).length;
  const total = vehicles * daysBetween(start, end);
  const overlapping = q.all(`SELECT * FROM capacity_reservations WHERE carrier_id = ? AND status = 'confirmed' AND id <> ? AND period_start <= ? AND period_end >= ?`, carrierId, excludeId || '', end, start);
  // نصيب الحجز المتداخل بالتناسب مع الأيام المشتركة
  const reserved = overlapping.reduce((s, r) => {
    const os = r.period_start > start ? r.period_start : start, oe = r.period_end < end ? r.period_end : end;
    return s + Math.ceil(r.trips * daysBetween(os, oe) / daysBetween(r.period_start, r.period_end));
  }, 0);
  return { vehicles, days: daysBetween(start, end), total, reserved, free: total - reserved, overlapping: overlapping.map((r) => r.number) };
}

export function createReservation(ctx, b) {
  const { carrier_id, delivery_city, period_start, period_end } = b;
  const trips = Number(b.trips);
  if (!carrier_id || !delivery_city || !period_start || !period_end || !(trips > 0)) throw new HttpError(400, 'أكمل الناقل والمدينة والفترة وعدد الرحلات');
  if (period_end < period_start) throw new HttpError(400, 'نهاية الفترة قبل بدايتها');
  const allocs = (b.allocations || []).filter((a) => a.project_id && Number(a.trips) > 0);
  if (allocs.reduce((s, a) => s + Number(a.trips), 0) > trips) throw new HttpError(400, 'مجموع التوزيع على المشاريع يتجاوز الرحلات المحجوزة');
  const cap = carrierCapacity(carrier_id, b.product || 'diesel', period_start, period_end);
  return tx(() => {
    const id = uid('cap_'); const number = nextNumber('capacity', 'FA-CAP');
    q.run(`INSERT INTO capacity_reservations(id,number,client_id,carrier_id,contract_id,delivery_city,product,period_start,period_end,trips,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, number, ctx.companyId, carrier_id, b.contract_id || null, delivery_city, b.product || 'diesel', period_start, period_end, trips, ctx.userId);
    for (const a of allocs) q.run('INSERT INTO capacity_allocations(id,reservation_id,project_id,trips) VALUES (?,?,?,?)', uid('ca_'), id, a.project_id, Number(a.trips));
    audit(ctx, 'capacity.create', 'capacity', id, { trips, period_start, period_end });
    notify(carrier_id, 'carrier_admin', `طلب حجز سعة ${number}`, `${trips} رحلة · ${delivery_city}`, '/contracts', `cap:${id}`);
    return { id, number, capacity: cap, conflict: trips > cap.free };
  });
}

function reservationUsage(r) {
  const used = q.all(`SELECT o.project_id, COUNT(*) n FROM orders o JOIN trips t ON t.order_id = o.id WHERE o.reservation_id = ? AND t.status NOT IN ('cancelled','rejected') GROUP BY o.project_id`, r.id);
  const total = used.reduce((s, u) => s + u.n, 0);
  const allocations = q.all('SELECT a.*, p.code project_code, p.name project_name FROM capacity_allocations a JOIN projects p ON p.id = a.project_id WHERE reservation_id = ?', r.id)
    .map((a) => { const u = used.find((x) => x.project_id === a.project_id)?.n || 0; return { ...a, used: u, over: u > a.trips }; });
  return { used: total, remaining: r.trips - total, allocations, over: total > r.trips };
}
export function listReservations(ctx) {
  const col = ctx.companyType === 'carrier' ? 'carrier_id' : 'client_id';
  return q.all(`SELECT r.*, cl.name_ar client_name, ca.name_ar carrier_name FROM capacity_reservations r JOIN companies cl ON cl.id = r.client_id JOIN companies ca ON ca.id = r.carrier_id
      WHERE r.${col} = ? ORDER BY r.period_start DESC`, ctx.companyId).map((r) => ({ ...r, usage: reservationUsage(r),
    capacity: ['pending_carrier', 'confirmed'].includes(r.status) ? carrierCapacity(r.carrier_id, r.product, r.period_start, r.period_end, r.id) : null }));
}

/* ------------------------------------------------------------------ */
/* قرار الناقل على العقد/الباقة/الحجز                                     */
/* ------------------------------------------------------------------ */
const KINDS = { contract: ['contracts', 'active', 'accepted_by', 'accepted_at'], package: ['trip_packages', 'active', 'accepted_by', 'accepted_at'], capacity: ['capacity_reservations', 'confirmed', 'confirmed_by', 'confirmed_at'] };
export function carrierDecide(ctx, kind, id, { decision, reason }) {
  const k = KINDS[kind]; if (!k) throw new HttpError(400, 'نوع غير معروف');
  return tx(() => {
    const row = q.get(`SELECT * FROM ${k[0]} WHERE id = ? AND carrier_id = ?`, id, ctx.companyId);
    if (!row) throw new HttpError(404, 'غير موجود');
    if (row.status !== 'pending_carrier') throw new HttpError(409, 'تم اتخاذ قرار مسبقًا');
    if (decision === 'reject') {
      if (!reason) throw new HttpError(400, 'سبب الرفض مطلوب');
      q.run(`UPDATE ${k[0]} SET status='rejected', decision_reason=? WHERE id = ?`, reason, id);
    } else {
      if (kind === 'capacity') {
        const cap = carrierCapacity(ctx.companyId, row.product, row.period_start, row.period_end, row.id);
        if (row.trips > cap.free) throw new HttpError(409, `السعة غير كافية: المتاح ${cap.free} رحلة في الفترة (${cap.vehicles} صهريج × ${cap.days} يوم، محجوز ${cap.reserved})`, cap);
      }
      q.run(`UPDATE ${k[0]} SET status=?, ${k[2]}=?, ${k[3]}=? WHERE id = ?`, k[1], ctx.userId, now(), id);
    }
    audit(ctx, `${kind}.${decision}`, kind, id, { reason });
    notify(row.client_id, 'procurement', `${decision === 'reject' ? 'رفض' : 'قبل'} الناقل ${row.number}`, reason || '', '/contracts', `${kind}-dec:${id}`);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* الربط بالسوق والطلب والرحلة                                           */
/* ------------------------------------------------------------------ */
/** عروض العقد والباقة للعميل على المسار المطلوب */
export function contractOffers(ctx, { loading_point_id, city, product, quantity_ml, date, project_id }) {
  const rates = q.all(`SELECT r.*, c.id contract_id, c.number contract_number, c.carrier_id, c.type contract_type, c.start_date, c.end_date, c.status, ca.name_ar carrier_name
      FROM contract_rates r JOIN contracts c ON c.id = r.contract_id JOIN companies ca ON ca.id = c.carrier_id AND ca.status = 'approved'
      WHERE c.client_id = ? AND c.status = 'active' AND c.start_date <= ? AND c.end_date >= ? AND r.loading_point_id = ? AND r.delivery_city = ? AND r.product = ?`,
    ctx.companyId, date, date, loading_point_id, city, product);
  const pkgs = q.all(`SELECT p.*, ca.name_ar carrier_name FROM trip_packages p JOIN companies ca ON ca.id = p.carrier_id AND ca.status='approved'
      WHERE p.client_id = ? AND p.status = 'active' AND p.start_date <= ? AND p.expiry_date >= ? AND p.loading_point_id = ? AND p.delivery_city = ? AND p.product = ?`,
    ctx.companyId, date, date, loading_point_id, city, product)
    .map((p) => { const bal = packageBalance(p.id); return { ...p, balance: bal, project_available: project_id ? availableForProject(bal, project_id) : bal.available, fits: quantity_ml <= p.max_liters_per_trip_ml }; });
  return { rates, packages: pkgs };
}

export function packageQuote(p) {
  const unit = Math.round(p.price_halalas / p.total_trips);
  return { pricing_type: 'package', unit_price_halalas: unit, base_halalas: unit, platform_fee_halalas: 0, platform_commission_pct: 0, vat_halalas: 0, total_halalas: unit,
    prepaid: true, package_number: p.number, note: 'مدفوعة مسبقًا ضمن الباقة (الضريبة مفوترة مع الباقة)',
    terms: { waiting_fee_halalas_per_hour: 0, free_waiting_hours: 2, cancel_fee_halalas: 0, accept_within_minutes: 120, late_cancel_consumes: !!p.late_cancel_consumes } };
}

/** يُستدعى داخل معاملة إنشاء الطلب بعد إنشاء الرحلة */
export function onOrderCreated(ctx, { orderId, tripId, packageId, projectId, carrierId, city, product, date }) {
  if (packageId) {
    const p = q.get('SELECT * FROM trip_packages WHERE id = ?', packageId);
    const bal = packageBalance(p.id);
    if (availableForProject(bal, projectId) <= 0) throw new HttpError(409, 'لا يوجد رصيد متاح في الباقة لهذا المشروع');
    q.run("INSERT INTO package_ledger(package_id,trip_id,project_id,kind,note) VALUES (?,?,?,'reserve','حجز عند إنشاء الطلب')", p.id, tripId, projectId);
  }
  // ربط تلقائي بحجز سعة مؤكد يغطي الناقل والمدينة والتاريخ
  const r = q.get(`SELECT id FROM capacity_reservations WHERE client_id = ? AND carrier_id = ? AND status = 'confirmed' AND delivery_city = ? AND product = ? AND period_start <= ? AND period_end >= ? ORDER BY period_start LIMIT 1`,
    ctx.companyId, carrierId, city, product, date, date);
  if (r) q.run('UPDATE orders SET reservation_id = ? WHERE id = ?', r.id, orderId);
}
/** إلغاء/رفض: يعود الرصيد، إلا إذا كان الإلغاء بعد القبول والباقة تنص على خصمه */
export function onTripReleased(trip, { afterAcceptance }) {
  const o = q.get('SELECT package_id FROM orders WHERE id = ?', trip.order_id);
  if (!o?.package_id) return;
  const p = q.get('SELECT * FROM trip_packages WHERE id = ?', o.package_id);
  const kind = afterAcceptance && p.late_cancel_consumes ? 'consume' : 'release';
  q.run(`INSERT OR IGNORE INTO package_ledger(package_id,trip_id,project_id,kind,note) SELECT package_id, trip_id, project_id, ?, ? FROM package_ledger WHERE package_id = ? AND trip_id = ? AND kind = 'reserve'`,
    kind, kind === 'consume' ? 'إلغاء بعد قبول الناقل — يخصم حسب شروط الباقة' : 'إلغاء/رفض — يعود الرصيد', p.id, trip.id);
}
/** التسليم: يخصم الرحلة من الباقة مرة واحدة */
export function onTripDelivered(trip) {
  const o = q.get('SELECT package_id FROM orders WHERE id = ?', trip.order_id);
  if (!o?.package_id) return;
  q.run(`INSERT OR IGNORE INTO package_ledger(package_id,trip_id,project_id,kind,note) SELECT package_id, trip_id, project_id, 'consume', 'خصم عند التسليم' FROM package_ledger WHERE package_id = ? AND trip_id = ? AND kind = 'reserve'`, o.package_id, trip.id);
}
