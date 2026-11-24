import { q, HttpError, L, now } from '../db.js';
import { tankBalance, batchBalance } from './inventory.js';
import { tripView, TRIP_STATUS_AR, documentQuantities } from './trips.js';
import { PRODUCTS } from './documents.js';

const SAR = (h) => (h == null ? 'غير متوفرة' : (h / 100).toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س');
const LIT = (ml) => (ml == null ? '—' : (ml / 1000).toLocaleString('ar-SA', { maximumFractionDigits: 3 }) + ' لتر');
const RT = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }) : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function range(from, to) {
  return { from: from ? new Date(from + 'T00:00:00+03:00').toISOString() : '0000', to: to ? new Date(to + 'T23:59:59.999+03:00').toISOString() : '9999' };
}

/* ------------------------------------------------------------------ */
/* سجل عمليات التزويد بكامل سلسلة المصدر                                 */
/* ------------------------------------------------------------------ */
export function fuelingRows(ctx, f = {}) {
  const { from, to } = range(f.from, f.to);
  const where = ['f.company_id = ?', 'f.created_at BETWEEN ? AND ?'];
  const p = [ctx.companyId, from, to];
  if (ctx.scopeProjectId) { where.push('f.project_id = ?'); p.push(ctx.scopeProjectId); }
  for (const [k, col] of [['asset_id', 'f.asset_id'], ['project_id', 'f.project_id'], ['site_id', 'f.site_id'], ['tank_id', 'f.tank_id'], ['trip_id', 'f.trip_id'], ['status', 'f.status'], ['verification', 'f.verification'], ['product', 'f.product']]) {
    if (f[k]) { where.push(`${col} = ?`); p.push(f[k]); }
  }
  const showCost = ctx.can('price.view') || ctx.can('finance.view') || ctx.role === 'client_admin';
  return q.all(`SELECT f.*, a.code asset_code, a.name asset_name, a.category, a.plate_or_serial, u.name operator_name,
      p.name project_name, p.code project_code, s.name site_name, cc.code cost_center_code, cc.name cost_center_name,
      tg.display_no tag_display_no, tk.code tank_code, tk.name tank_name, t.number trip_number, t.id trip_ref_id, o.number order_number, o.id order_ref_id, ad.doc_number,
      (SELECT number FROM fuelings x WHERE x.id = f.corrects_fueling_id) corrects_number
    FROM fuelings f JOIN assets a ON a.id = f.asset_id JOIN users u ON u.id = f.operator_user_id
    LEFT JOIN projects p ON p.id = f.project_id LEFT JOIN sites s ON s.id = f.site_id LEFT JOIN cost_centers cc ON cc.id = f.cost_center_id
    LEFT JOIN nfc_tags tg ON tg.id = f.tag_id LEFT JOIN tanks tk ON tk.id = f.tank_id
    LEFT JOIN trips t ON t.id = COALESCE(f.trip_id, (SELECT ts.trip_id FROM fuel_movements m JOIN fuel_batches b ON b.id = m.batch_id JOIN trip_stops ts ON ts.id = b.trip_stop_id WHERE m.id = f.movement_id))
    LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN aramco_documents ad ON ad.id = o.aramco_document_id
    WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC LIMIT ${Math.min(Number(f.limit) || 500, 5000)}`, ...p)
    .map((r) => {
      // للصرف من خزان: مرجع آخر رحلة استلام دخلت الخزان قبل العملية (المصدر بالمتوسط المرجح)
      if (r.source_type === 'tank' && r.tank_id) {
        const c = tankReceiptsBefore(r.tank_id, r.created_at).find((x) => x.trip_id);
        if (c) Object.assign(r, { trip_number: c.trip_number, trip_ref_id: c.trip_id, order_number: c.order_number, order_ref_id: c.order_id, doc_number: c.doc_number, source_via_tank: 1 });
      }
      return showCost ? r : { ...r, cost_halalas: undefined };
    });
}

/** مصدر لترات عملية صرف من خزان: آخر استلامات الخزان (تتبع على مستوى المتوسط المرجح) */
function tankReceiptsBefore(tankId, at) {
  return q.all(`SELECT m.quantity_ml, m.effective_at, m.kind, t.id trip_id, t.number trip_number, o.id order_id, o.number order_number, o.created_at order_created_at,
      (SELECT name FROM users WHERE id = o.created_by) order_created_by, ad.doc_number, ca.name_ar carrier_name
      FROM fuel_movements m LEFT JOIN trip_stops ts ON ts.id = m.ref_id AND m.ref_type='trip_stop' LEFT JOIN trips t ON t.id = ts.trip_id
      LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN aramco_documents ad ON ad.id = o.aramco_document_id LEFT JOIN companies ca ON ca.id = t.carrier_id
      WHERE m.tank_id = ? AND m.status='approved' AND m.quantity_ml > 0 AND m.kind IN ('receipt','opening','transfer_in') AND m.effective_at <= ?
      ORDER BY m.effective_at DESC LIMIT 3`, tankId, at);
}

/** سلسلة مصدر عملية تزويد: الخزان ← رحلات الاستلام ← الطلب الأصلي ← المستند، أو الدفعة المباشرة ← الرحلة ← الطلب */
export function sourceChain(r) {
  if (r.source_type === 'batch') return [{ kind: 'direct', trip_id: r.trip_ref_id, trip_number: r.trip_number, order_id: r.order_ref_id, order_number: r.order_number, doc_number: r.doc_number }];
  return tankReceiptsBefore(r.tank_id, r.created_at);
}

/* ------------------------------------------------------------------ */
/* تقرير المعدة: معيار عرض فيول آب                                          */
/* ------------------------------------------------------------------ */
export function assetReport(ctx, assetId, f = {}) {
  const a = q.get(`SELECT a.*, p.name project_name, p.code project_code, s.name site_name, cc.code cost_center_code, cc.name cost_center_name,
      tg.display_no tag_display_no, tg.status tag_status
    FROM assets a LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
    LEFT JOIN nfc_tags tg ON tg.asset_id = a.id AND tg.status = 'active' WHERE a.id = ? AND a.company_id = ?`, assetId, ctx.companyId);
  if (!a) throw new HttpError(404, 'الأصل غير موجود');
  if (ctx.scopeProjectId && a.project_id !== ctx.scopeProjectId) throw new HttpError(404, 'الأصل غير موجود');
  const rows = fuelingRows(ctx, { ...f, asset_id: assetId, limit: 5000 });
  const ok = rows.filter((r) => r.status === 'approved');
  const liters = ok.reduce((s, r) => s + r.quantity_ml, 0);
  const costKnown = ok.every((r) => r.cost_halalas != null);
  const cost = ok.reduce((s, r) => s + (r.cost_halalas || 0), 0);
  // معدل الاستهلاك: يتطلب قراءتين صالحتين ضمن الفترة (تجاهل القراءات المتراجعة)
  const readings = ok.filter((r) => r.meter_value != null && r.quantity_ml > 0).sort((x, y) => x.created_at.localeCompare(y.created_at));
  const valid = []; for (const r of readings) if (!valid.length || r.meter_value > valid[valid.length - 1].meter_value) valid.push(r);
  let rate = null;
  if (valid.length >= 2) {
    const dist = valid[valid.length - 1].meter_value - valid[0].meter_value;
    const fuelBetween = valid.slice(1).reduce((s, r) => s + r.quantity_ml, 0) / 1000;
    rate = a.meter_type === 'km' ? { value: +(fuelBetween / dist * 100).toFixed(2), unit: 'لتر/100 كم', readings: valid.length, span: dist }
         : { value: +(fuelBetween / dist).toFixed(2), unit: 'لتر/ساعة', readings: valid.length, span: dist };
  }
  const enriched = rows.map((r) => ({ ...r, source_chain: sourceChain(r) }));
  const moves = q.all(`SELECT aa.*, p.name project_name, u.name by_name FROM asset_assignments aa LEFT JOIN projects p ON p.id = aa.project_id
      LEFT JOIN users u ON u.id = aa.created_by WHERE asset_id = ? ORDER BY effective_from`, assetId);
  const tagHistory = q.all(`SELECT e.*, t.display_no, u.name by_name FROM nfc_tag_events e LEFT JOIN nfc_tags t ON t.id = e.tag_id
      LEFT JOIN users u ON u.id = e.by_user WHERE e.asset_id = ? AND e.action <> 'read' ORDER BY e.at DESC LIMIT 50`, assetId);
  return {
    asset: a, rows: enriched, assignments: moves, tag_history: tagHistory,
    totals: { liters_ml: liters, cost_halalas: costKnown ? cost : null, cost_partial_halalas: cost, count: ok.length,
      last_fueling_at: ok[0]?.created_at ?? null, last_meter: readings.length ? readings[readings.length - 1].meter_value : null, rate },
    generated_at: now(),
  };
}

/* ------------------------------------------------------------------ */
/* لوحة النظرة العامة: كل مؤشر قابل للتتبع إلى عملياته                    */
/* ------------------------------------------------------------------ */
export function dashboard(ctx, f = {}) {
  const { from, to } = range(f.from, f.to);
  const c = ctx.companyId;
  const projectFilter = ctx.scopeProjectId || f.project_id || null;
  const received = q.get(`SELECT COALESCE(SUM(m.quantity_ml),0) s, COUNT(*) n FROM fuel_movements m JOIN fuel_batches b ON b.trip_stop_id = m.ref_id
      JOIN sites st ON st.id = b.site_id
      WHERE m.company_id = ? AND m.kind IN ('receipt','direct_allocation') AND m.status='approved' AND m.created_at BETWEEN ? AND ?` + (projectFilter ? ' AND st.project_id = ?' : ''),
    ...[c, from, to, projectFilter].filter((x) => x !== null));
  const issued = q.get(`SELECT COALESCE(SUM(quantity_ml),0) s, COUNT(*) n, SUM(CASE WHEN cost_halalas IS NULL THEN 1 ELSE 0 END) unknown, COALESCE(SUM(cost_halalas),0) cost
      FROM fuelings WHERE company_id = ? AND status='approved' AND created_at BETWEEN ? AND ?` + (projectFilter ? ' AND project_id = ?' : ''),
    ...[c, from, to, projectFilter].filter((x) => x !== null));
  const tanks = q.all('SELECT t.*, s.name site_name, s.project_id FROM tanks t JOIN sites s ON s.id = t.site_id WHERE t.company_id = ?' + (projectFilter ? ' AND s.project_id = ?' : ''), ...[c, projectFilter].filter(Boolean))
    .map((t) => ({ id: t.id, code: t.code, name: t.name, site_name: t.site_name, product: t.product, capacity_ml: t.capacity_ml, reorder_ml: t.reorder_ml, ...tankBalance(t.id) }));
  const directBatches = q.all("SELECT id FROM fuel_batches WHERE company_id = ? AND mode='direct'", c).map((b) => batchBalance(b.id).balance_ml).reduce((a, b) => a + b, 0);
  const spend = q.get(`SELECT COALESCE(SUM(o.transport_halalas),0) transport, COUNT(*) n FROM orders o WHERE o.company_id = ? AND o.status NOT IN ('cancelled','rejected') AND o.created_at BETWEEN ? AND ?` + (projectFilter ? ' AND o.project_id = ?' : ''),
    ...[c, from, to, projectFilter].filter((x) => x !== null));
  const fuelSpend = q.get(`SELECT COALESCE(SUM(b.fuel_cost_halalas),0) s, SUM(CASE WHEN b.fuel_cost_halalas IS NULL THEN 1 ELSE 0 END) unknown FROM fuel_batches b JOIN sites st ON st.id=b.site_id WHERE b.company_id = ? AND b.created_at BETWEEN ? AND ?` + (projectFilter ? ' AND st.project_id = ?' : ''),
    ...[c, from, to, projectFilter].filter((x) => x !== null));
  // نسبة التسليم في الموعد = المسلّمة ضمن النافذة ÷ المسلّمة ذات النافذة المسجلة
  const deliveredTrips = q.all(`SELECT t.id, t.number, t.window_end, t.delivered_at FROM trips t JOIN orders o ON o.id = t.order_id WHERE t.company_id = ? AND t.delivered_at IS NOT NULL AND t.delivered_at BETWEEN ? AND ?` + (projectFilter ? ' AND o.project_id = ?' : ''),
    ...[c, from, to, projectFilter].filter((x) => x !== null));
  const withWindow = deliveredTrips.filter((t) => t.window_end);
  const onTime = withWindow.filter((t) => t.delivered_at <= t.window_end).length;
  const tripsByStatus = q.all(`SELECT t.status, COUNT(*) n FROM trips t JOIN orders o ON o.id = t.order_id WHERE t.company_id = ?` + (projectFilter ? ' AND o.project_id = ?' : '') + ' GROUP BY t.status', ...[c, projectFilter].filter(Boolean));
  const openEx = q.all("SELECT type, COUNT(*) n FROM exceptions WHERE company_id = ? AND status='open' GROUP BY type", c);
  const awaitingConfirm = q.get("SELECT COUNT(*) n FROM trip_stops s JOIN trips t ON t.id = s.trip_id WHERE t.company_id = ? AND s.status='delivered'", c).n;
  const lowTanks = tanks.filter((t) => t.book_ml <= t.reorder_ml);
  const daily = q.all(`SELECT substr(datetime(created_at,'+3 hours'),1,10) d, SUM(quantity_ml) ml FROM fuelings WHERE company_id = ? AND status='approved' AND created_at >= ?` + (projectFilter ? ' AND project_id = ?' : '') + ' GROUP BY d ORDER BY d',
    ...[c, new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10), projectFilter].filter(Boolean));
  const byProject = q.all(`SELECT p.id, p.name, p.code, p.budget_ml, p.budget_halalas, COALESCE(SUM(f.quantity_ml),0) ml, COALESCE(SUM(f.cost_halalas),0) cost, SUM(CASE WHEN f.cost_halalas IS NULL AND f.id IS NOT NULL THEN 1 ELSE 0 END) unknown
      FROM projects p LEFT JOIN fuelings f ON f.project_id = p.id AND f.status='approved' AND f.created_at BETWEEN ? AND ? WHERE p.company_id = ?` + (projectFilter ? ' AND p.id = ?' : '') + ' GROUP BY p.id ORDER BY ml DESC',
    ...[from, to, c, projectFilter].filter((x) => x !== null));
  const topAssets = q.all(`SELECT a.id, a.code, a.name, a.category, SUM(f.quantity_ml) ml, COUNT(*) n FROM fuelings f JOIN assets a ON a.id = f.asset_id
      WHERE f.company_id = ? AND f.status='approved' AND f.created_at BETWEEN ? AND ?` + (projectFilter ? ' AND f.project_id = ?' : '') + ' GROUP BY a.id ORDER BY ml DESC LIMIT 6',
    ...[c, from, to, projectFilter].filter((x) => x !== null));
  const showMoney = ctx.can('price.view') || ctx.can('finance.view');
  const one = (sql, ...a) => q.get(sql, ...a).n;
  const counts = {
    projects: one('SELECT COUNT(*) n FROM projects WHERE company_id = ?' + (projectFilter ? ' AND id = ?' : ''), ...[c, projectFilter].filter(Boolean)),
    sites: one('SELECT COUNT(*) n FROM sites WHERE company_id = ?' + (projectFilter ? ' AND project_id = ?' : ''), ...[c, projectFilter].filter(Boolean)),
    assets: one("SELECT COUNT(*) n FROM assets WHERE company_id = ? AND status = 'active'" + (projectFilter ? ' AND project_id = ?' : ''), ...[c, projectFilter].filter(Boolean)),
    active_tags: one("SELECT COUNT(*) n FROM nfc_tags t JOIN assets a ON a.id = t.asset_id WHERE t.company_id = ? AND t.status = 'active'" + (projectFilter ? ' AND a.project_id = ?' : ''), ...[c, projectFilter].filter(Boolean)),
    users: one('SELECT COUNT(DISTINCT user_id) n FROM memberships WHERE company_id = ? AND active = 1', c),
    active_trips: one(`SELECT COUNT(*) n FROM trips t JOIN orders o ON o.id = t.order_id WHERE t.company_id = ? AND t.status IN ('awaiting_acceptance','awaiting_assignment','assigned','to_loading','at_loading','loaded','to_delivery','at_site','on_hold')` + (projectFilter ? ' AND o.project_id = ?' : ''), ...[c, projectFilter].filter(Boolean)),
  };
  const month = q.get(`SELECT COALESCE(SUM(quantity_ml),0) s FROM fuelings WHERE company_id = ? AND status='approved' AND created_at >= ?` + (projectFilter ? ' AND project_id = ?' : ''),
    ...[c, new Date(Date.now() - 30 * 864e5).toISOString(), projectFilter].filter(Boolean)).s;
  const recent = [
    ...q.all(`SELECT 'fueling' kind, f.id, f.number ref, f.created_at at, f.quantity_ml, a.code subject, u.name actor FROM fuelings f JOIN assets a ON a.id = f.asset_id JOIN users u ON u.id = f.operator_user_id
        WHERE f.company_id = ? AND f.status = 'approved'` + (projectFilter ? ' AND f.project_id = ?' : '') + ' ORDER BY f.created_at DESC LIMIT 6', ...[c, projectFilter].filter(Boolean)),
    ...q.all(`SELECT 'trip' kind, t.id, t.number ref, e.received_at at, e.to_status status, NULL quantity_ml, ca.name_ar subject, u.name actor FROM trip_events e JOIN trips t ON t.id = e.trip_id
        JOIN companies ca ON ca.id = t.carrier_id LEFT JOIN users u ON u.id = e.actor_user_id WHERE t.company_id = ? AND e.to_status IS NOT NULL ORDER BY e.received_at DESC LIMIT 6`, c),
  ].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 8).map((r) => ({ ...r, status_ar: r.status ? TRIP_STATUS_AR[r.status] : undefined }));
  return {
    generated_at: now(), counts, month_issued_ml: month, recent,
    received_ml: received.s, received_count: received.n,
    issued_ml: issued.s, issued_count: issued.n,
    stock_ml: tanks.reduce((s, t) => s + t.book_ml, 0), direct_balance_ml: directBatches,
    spend: showMoney ? { transport_halalas: spend.transport, fuel_halalas: fuelSpend.unknown ? null : fuelSpend.s, fuel_partial_halalas: fuelSpend.s, fuel_unknown_batches: fuelSpend.unknown, issued_cost_halalas: issued.unknown ? null : issued.cost, issued_unknown: issued.unknown } : null,
    on_time: { pct: withWindow.length ? Math.round((onTime / withWindow.length) * 100) : null, on_time: onTime, counted: withWindow.length, delivered: deliveredTrips.length },
    trips_by_status: tripsByStatus.map((r) => ({ ...r, label: TRIP_STATUS_AR[r.status] })),
    open_exceptions: openEx, awaiting_receipt_confirmation: awaitingConfirm,
    tanks, low_tanks: lowTanks.map((t) => t.id), daily, by_project: byProject.map((p) => showMoney ? p : { ...p, cost: undefined, budget_halalas: undefined }), top_assets: topAssets,
  };
}

/* ------------------------------------------------------------------ */
/* مطابقة دورة الوقود لكل رحلة                                           */
/* ------------------------------------------------------------------ */
export function cycleReport(ctx) {
  return q.all(`SELECT t.id, t.number, t.status, t.loaded_ml, o.number order_number, o.quantity_ml requested_ml, ad.doc_number, ad.id doc_id
      FROM trips t JOIN orders o ON o.id = t.order_id LEFT JOIN aramco_documents ad ON ad.id = o.aramco_document_id
      WHERE t.company_id = ? ORDER BY t.created_at DESC LIMIT 200`, ctx.companyId).map((t) => {
    const stops = q.all('SELECT id, mode, delivered_ml, returned_ml FROM trip_stops WHERE trip_id = ?', t.id);
    const delivered = stops.reduce((s, x) => s + (x.delivered_ml || 0), 0);
    const stored = q.get("SELECT COALESCE(SUM(quantity_ml),0) s FROM fuel_movements WHERE kind='receipt' AND ref_type='trip_stop' AND ref_id IN (SELECT id FROM trip_stops WHERE trip_id = ?)", t.id).s;
    const direct = q.all("SELECT b.id FROM fuel_batches b JOIN trip_stops s ON s.id = b.trip_stop_id WHERE s.trip_id = ? AND b.mode='direct'", t.id).map((b) => batchBalance(b.id));
    const issuedDirect = direct.reduce((s, b) => s + b.issued_ml, 0);
    return { ...t, reserved_ml: t.loaded_ml == null && !['cancelled', 'rejected'].includes(t.status) ? t.requested_ml : 0, delivered_ml: delivered,
      returned_ml: stops.reduce((s, x) => s + (x.returned_ml || 0), 0), stored_ml: stored, issued_direct_ml: issuedDirect,
      remaining_direct_ml: direct.reduce((s, b) => s + b.balance_ml, 0), status_ar: TRIP_STATUS_AR[t.status] };
  });
}

export function tagControlReport(ctx) {
  const tags = q.all(`SELECT t.*, a.code asset_code, a.name asset_name FROM nfc_tags t LEFT JOIN assets a ON a.id = t.asset_id WHERE t.company_id = ? ORDER BY t.display_no`, ctx.companyId);
  const rejected = q.all(`SELECT e.*, t.display_no, a.code asset_code, u.name by_name FROM nfc_tag_events e LEFT JOIN nfc_tags t ON t.id = e.tag_id
      LEFT JOIN assets a ON a.id = e.asset_id LEFT JOIN users u ON u.id = e.by_user WHERE e.company_id = ? AND e.action = 'rejected' ORDER BY e.at DESC LIMIT 100`, ctx.companyId);
  const alt = q.all(`SELECT f.number, f.verification, f.created_at, a.code asset_code, u.name operator_name FROM fuelings f JOIN assets a ON a.id = f.asset_id
      JOIN users u ON u.id = f.operator_user_id WHERE f.company_id = ? AND f.verification <> 'nfc' ORDER BY f.created_at DESC LIMIT 100`, ctx.companyId);
  const counts = {}; for (const t of tags) counts[t.status] = (counts[t.status] || 0) + 1;
  return { tags, counts, rejected, alt_verifications: alt };
}

/* ------------------------------------------------------------------ */
/* تقرير توثيق التعبئة والتسليم - صفحة عربية قابلة للطباعة/PDF            */
/* ------------------------------------------------------------------ */
export function tripReportHtml(ctx, tripId, token) {
  const t = tripView(ctx, tripId);
  const photoKinds = { before_loading: 'قبل التحميل', after_loading: 'بعد التحميل', before_unloading: 'قبل التفريغ', after_unloading: 'بعد التفريغ' };
  const img = (p) => `<figure><img src="/api/files/${p.file_id}?token=${token}" alt=""><figcaption>${photoKinds[p.kind]}<br><small>التقاط: ${RT(p.captured_at)}<br>استلام الخادم: ${RT(p.received_at)}${p.lat ? `<br>${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : ''}</small></figcaption></figure>`;
  const loadPhotos = t.photos.filter((p) => !p.stop_id);
  const deliveredTotal = t.stops.reduce((s, x) => s + (x.delivered_ml || 0), 0);
  const returned = t.stops.reduce((s, x) => s + (x.returned_ml || 0), 0);
  const variance = t.loaded_ml == null ? null : t.loaded_ml - deliveredTotal - returned;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير توثيق ${esc(t.number)}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:14mm}
body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#1c1917;margin:0;padding:24px;font-size:12.5px;background:#fff}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #000098;box-shadow:0 3px 0 #c00000;padding-bottom:12px;margin-bottom:16px}
.brand{font-size:26px;font-weight:700;color:#000098}.brand small{display:block;font-size:12px;color:#57534e;font-weight:400}
.demo{background:#fef3c7;color:#92400e;padding:4px 10px;border-radius:6px;font-weight:600;display:inline-block}
h2{font-size:15px;margin:18px 0 8px;color:#000098;border-right:4px solid #000098;padding-right:8px}
table{width:100%;border-collapse:collapse;margin-bottom:6px}td,th{border:1px solid #e7e5e4;padding:6px 8px;text-align:right;vertical-align:top}
th{background:#fafaf9;width:22%;font-weight:600;color:#44403c}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}figure{margin:0;border:1px solid #e7e5e4;border-radius:6px;padding:6px;text-align:center;break-inside:avoid}
figure img{width:100%;height:120px;object-fit:cover;border-radius:4px;background:#f5f5f4}figcaption{font-weight:600;margin-top:4px}small{color:#78716c;font-weight:400}
.warn{color:#b91c1c;font-weight:600}.ok{color:#15803d;font-weight:600}.missing{height:120px;display:flex;align-items:center;justify-content:center;background:#fef2f2;color:#b91c1c;border-radius:4px}
footer{margin-top:20px;border-top:1px solid #e7e5e4;padding-top:8px;color:#78716c;font-size:11px;display:flex;justify-content:space-between}
.print{position:fixed;left:16px;top:16px;background:#000098;color:#fff;border:0;padding:8px 16px;border-radius:6px;font-family:inherit;cursor:pointer}
@media print{.print{display:none}}
</style></head><body>
<button class="print" onclick="print()">طباعة / حفظ PDF</button>
<header><div class="brand" style="display:flex;gap:12px;align-items:center"><img src="/brand/logo-mark.png" style="height:58px"><div>فيول آب<small>تقرير توثيق التعبئة والتسليم</small></div></div>
<div style="text-align:left"><div style="font-size:18px;font-weight:700">${esc(t.number)}</div><div>${esc(t.status_ar)}</div><span class="demo">بيانات تجريبية</span></div></header>
<h2>الطلب والمستند</h2><table>
<tr><th>رقم الطلب</th><td>${esc(t.order_number)}</td><th>رقم الرحلة</th><td>${esc(t.number)}</td></tr>
<tr><th>مرجع مستند أرامكو</th><td>${esc(t.doc_number || '—')}</td><th>المنتج</th><td>${esc(PRODUCTS[t.product])}</td></tr>
<tr><th>العميل</th><td>${esc(t.client_name)}</td><th>المشروع</th><td>${esc(t.project_name || '—')}</td></tr></table>
<h2>الناقل والتنفيذ</h2><table>
<tr><th>الناقل</th><td>${esc(t.carrier_name)}</td><th>السائق</th><td>${esc(t.driver_name || '—')}</td></tr>
<tr><th>رقم اللوحة</th><td>${esc(t.plate || '—')}</td><th>نقطة التحميل</th><td>${esc(t.loading_point_name)} (${esc(t.loading_city)})</td></tr>
<tr><th>نافذة التسليم</th><td>${RT(t.window_start)} ← ${RT(t.window_end)}</td><th>وقت التحميل / التسليم</th><td>${RT(t.loaded_at)} / ${RT(t.delivered_at)}</td></tr></table>
<h2>الكميات</h2><table>
<tr><th>المطلوبة</th><td>${LIT(t.quantity_ml)}</td><th>المحملة</th><td>${LIT(t.loaded_ml)} <small>(${esc(t.load_measure_method || '—')})</small></td></tr>
<tr><th>المسلّمة</th><td>${LIT(deliveredTotal)}</td><th>المرتجعة</th><td>${LIT(returned)}</td></tr>
<tr><th>الفرق</th><td colspan="3" class="${variance ? 'warn' : 'ok'}">${variance == null ? '—' : LIT(variance)}${variance ? ' — ' + esc(t.exceptions.map((e) => e.title + ' (' + (e.status === 'open' ? 'مفتوح' : e.status === 'approved' ? 'معتمد' : 'مرفوض') + (e.decision_reason ? ': ' + e.decision_reason : '') + ')').join('، ') || 'بانتظار المراجعة') : ''}</td></tr></table>
<h2>صور التحميل</h2><div class="grid">${['before_loading', 'after_loading'].map((k) => { const p = loadPhotos.find((x) => x.kind === k); return p ? img(p) : `<figure><div class="missing">لا توجد صورة</div><figcaption>${photoKinds[k]}</figcaption></figure>`; }).join('')}</div>
${t.stops.map((s) => `<h2>نقطة التسليم ${s.seq}: ${esc(s.site_name)} — ${s.mode === 'tank' ? 'إلى خزان ' + esc(s.tank_code || '') : 'تزويد مباشر للمعدات'}</h2>
<table><tr><th>المطلوبة</th><td>${LIT(s.requested_ml)}</td><th>المسلّمة</th><td>${LIT(s.delivered_ml)} <small>(${esc(s.measure_method || '—')})</small></td></tr>
<tr><th>المستلم</th><td>${esc(s.receiver_name || '—')}</td><th>التأكيد</th><td class="${s.receiver_ack === 'confirmed' ? 'ok' : s.receiver_ack ? 'warn' : ''}">${s.receiver_ack === 'confirmed' ? 'مؤكد' : s.receiver_ack === 'disputed' ? 'معترض' : 'بانتظار'} ${esc(s.receiver_ack_by || '')} ${RT(s.receiver_ack_at)} ${s.receiver_note ? '— ' + esc(s.receiver_note) : ''}</td></tr></table>
<div class="grid">${['before_unloading', 'after_unloading'].map((k) => { const p = t.photos.find((x) => x.kind === k && x.stop_id === s.id); return p ? img(p) : `<figure><div class="missing">لا توجد صورة</div><figcaption>${photoKinds[k]}</figcaption></figure>`; }).join('')}</div>`).join('')}
<h2>السجل الزمني</h2><table><tr><th>الوقت</th><th>الحدث</th><th>المنفذ</th><th>ملاحظة</th></tr>
${t.events.map((e) => `<tr><td>${RT(e.captured_at)}</td><td>${esc(e.to_status ? TRIP_STATUS_AR[e.to_status] : e.type)}</td><td>${esc(e.actor_name || '—')}</td><td>${esc(e.note || '')}</td></tr>`).join('')}</table>
<footer><span>أُنشئ في ${RT(now())} بتوقيت الرياض</span><span>فيول آب — منصة نقل وإدارة الوقود</span></footer>
</body></html>`;
}

export function toCsv(rows, cols) {
  const e = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map((c) => e(c[1])).join(','), ...rows.map((r) => cols.map((c) => e(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\r\n');
}

export const FUELING_CSV_COLS = [
  ['number', 'رقم العملية'], [(r) => RT(r.created_at), 'الوقت (الرياض)'], ['site_name', 'الموقع'], ['project_name', 'المشروع'], ['asset_code', 'رقم الأصل'],
  ['asset_name', 'الأصل'], ['tag_display_no', 'الشريحة'], [(r) => ({ nfc: 'NFC', qr: 'QR بديل', manual: 'يدوي' }[r.verification]), 'طريقة التحقق'], [(r) => PRODUCTS[r.product], 'نوع الوقود'],
  [(r) => L(r.quantity_ml), 'اللترات'], [(r) => (r.cost_halalas == null ? 'غير متوفرة' : r.cost_halalas / 100), 'التكلفة (ر.س)'],
  ['meter_value', 'قراءة العداد'], ['meter_unit', 'وحدة العداد'], [(r) => ({ manual: 'يدوي', pump_meter: 'عداد المضخة', tank_dip: 'قياس الخزان', correction: 'تصحيح' }[r.measure_source] || r.measure_source), 'مصدر القياس'], ['operator_name', 'المشغّل'],
  [(r) => (r.source_type === 'tank' ? 'خزان ' + (r.tank_code || '') : 'تزويد مباشر'), 'المصدر'], ['trip_number', 'رحلة المصدر'], ['order_number', 'طلب النقل'],
  ['doc_number', 'مستند أرامكو'], ['cost_center_code', 'مركز التكلفة'], [(r) => ({ approved: 'معتمدة', rejected: 'مرفوضة', draft: 'مسودة' }[r.status] || r.status), 'الحالة'], ['exception_flag', 'استثناء'], ['corrects_number', 'يصحح العملية'],
];

export { documentQuantities };
