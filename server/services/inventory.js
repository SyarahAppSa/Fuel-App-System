import { q, tx, uid, now, audit, notify, HttpError, L, ML } from '../db.js';

/** تكلفة دفعة: سعر الوقود (إن عُرف) + نصيب أجرة النقل بالتناسب */
function batchCosts(trip, stop, qtyMl) {
  const o = q.get('SELECT transport_halalas, fuel_price_halalas_per_l FROM orders WHERE id = ?', trip.order_id);
  const totalReq = q.get('SELECT SUM(requested_ml) s FROM trip_stops WHERE trip_id = ?', trip.id).s || qtyMl;
  const fuel = o.fuel_price_halalas_per_l == null ? null : Math.round((o.fuel_price_halalas_per_l * qtyMl) / 1000);
  const transport = o.transport_halalas == null ? null : Math.round((o.transport_halalas * stop.requested_ml) / totalReq);
  return { fuel, transport, total: fuel == null || transport == null ? null : fuel + transport };
}

/** وصول الصهريج لموقع بتزويد مباشر: دفعة مخصصة (لا تدخل خزان الموقع) */
export function createDirectBatchForStop(ctx, trip, stop) {
  const exists = q.get('SELECT id FROM fuel_batches WHERE trip_stop_id = ?', stop.id);
  if (exists) return exists.id;
  const deliveredBefore = q.get('SELECT COALESCE(SUM(delivered_ml),0) s FROM trip_stops WHERE trip_id = ?', trip.id).s;
  const qty = Math.min(stop.requested_ml, (trip.loaded_ml ?? stop.requested_ml) - deliveredBefore);
  const order = q.get('SELECT product FROM orders WHERE id = ?', trip.order_id);
  const c = batchCosts(trip, stop, qty);
  const id = uid('bat_');
  q.run(`INSERT INTO fuel_batches(id,company_id,trip_stop_id,site_id,mode,product,quantity_ml,fuel_cost_halalas,transport_cost_halalas)
      VALUES (?,?,?,?, 'direct', ?,?,?,?)`, id, trip.company_id, stop.id, stop.site_id, order.product, qty, c.fuel, c.transport);
  q.run(`INSERT INTO fuel_movements(id,company_id,kind,batch_id,quantity_ml,cost_halalas,ref_type,ref_id,note,created_by)
      VALUES (?,?,'direct_allocation',?,?,?,'trip_stop',?,?,?)`, uid('mov_'), trip.company_id, id, qty, c.total, stop.id, `رصيد مخصص للتزويد المباشر - ${trip.number}`, ctx?.userId ?? null);
  return id;
}

/** تأكيد الاستلام: خزان ← حركة استلام. تزويد مباشر ← ضبط الدفعة على الكمية المسلّمة */
export function createReceiptForStop(ctx, trip, stop, overrideMl) {
  const qty = overrideMl ?? stop.delivered_ml;
  const order = q.get('SELECT product FROM orders WHERE id = ?', trip.order_id);
  if (stop.mode === 'tank') {
    if (q.get('SELECT id FROM fuel_batches WHERE trip_stop_id = ?', stop.id)) return; // مرة واحدة فقط
    const c = batchCosts(trip, stop, qty);
    const bid = uid('bat_');
    q.run(`INSERT INTO fuel_batches(id,company_id,trip_stop_id,site_id,mode,product,quantity_ml,fuel_cost_halalas,transport_cost_halalas)
        VALUES (?,?,?,?, 'tank', ?,?,?,?)`, bid, trip.company_id, stop.id, stop.site_id, order.product, qty, c.fuel, c.transport);
    q.run(`INSERT INTO fuel_movements(id,company_id,kind,tank_id,quantity_ml,cost_halalas,ref_type,ref_id,note,created_by,approved_by)
        VALUES (?,?,'receipt',?,?,?,'trip_stop',?,?,?,?)`, uid('mov_'), trip.company_id, stop.tank_id, qty, c.total, stop.id,
      `استلام ${trip.number}`, ctx?.userId ?? null, ctx?.userId ?? null);
    const tank = q.get('SELECT * FROM tanks WHERE id = ?', stop.tank_id);
    const bal = tankBalance(tank.id);
    if (bal.book_ml > tank.capacity_ml) {
      notify(trip.company_id, 'fuel_supervisor', `رصيد الخزان ${tank.code} يتجاوز سعته`, 'راجع القراءة أو الاستلام', `/tanks/${tank.id}`, `over:${stop.id}`);
    }
  } else {
    const b = q.get('SELECT * FROM fuel_batches WHERE trip_stop_id = ?', stop.id);
    if (!b) return;
    const diff = qty - b.quantity_ml;
    if (diff !== 0) {
      // الفرق بين المخصص والمسلّم الفعلي (مرتجع للصهريج أو زيادة) بحركة موثقة
      q.run('UPDATE fuel_batches SET quantity_ml = ? WHERE id = ?', qty, b.id);
      q.run(`INSERT INTO fuel_movements(id,company_id,kind,batch_id,quantity_ml,cost_halalas,ref_type,ref_id,note,created_by)
          VALUES (?,?,?,?,?,?,'trip_stop',?,?,?)`, uid('mov_'), trip.company_id, diff < 0 ? 'return' : 'adjustment', b.id, diff,
        null, stop.id, 'مطابقة الدفعة المباشرة مع الكمية المسلّمة', ctx?.userId ?? null);
    }
  }
}

export function tankBalance(tankId) {
  const r = q.get(`SELECT
      COALESCE(SUM(CASE WHEN status='approved' THEN quantity_ml END),0) book_ml,
      COALESCE(SUM(CASE WHEN status='pending' THEN quantity_ml END),0) pending_ml,
      SUM(CASE WHEN status='approved' AND quantity_ml > 0 AND cost_halalas IS NULL THEN 1 ELSE 0 END) unknown_cost_in,
      COALESCE(SUM(CASE WHEN status='approved' THEN cost_halalas END),0) cost_halalas
    FROM fuel_movements WHERE tank_id = ?`, tankId);
  const draft = q.get("SELECT COALESCE(SUM(quantity_ml),0) s FROM fuelings WHERE tank_id = ? AND status='draft'", tankId).s;
  const avg = r.unknown_cost_in > 0 || r.book_ml <= 0 ? null : r.cost_halalas / r.book_ml; // هللة لكل ml
  return { book_ml: r.book_ml, pending_ml: r.pending_ml, draft_ml: draft, available_ml: r.book_ml - draft + Math.min(0, r.pending_ml), avg_cost_per_ml: avg, value_halalas: avg == null ? null : r.cost_halalas };
}

export function batchBalance(batchId) {
  const b = q.get('SELECT * FROM fuel_batches WHERE id = ?', batchId);
  const r = q.get(`SELECT COALESCE(SUM(quantity_ml),0) bal,
      COALESCE(-SUM(CASE WHEN kind='issue' OR (kind='reversal') THEN quantity_ml END),0) issued
      FROM fuel_movements WHERE batch_id = ? AND status='approved'`, batchId);
  const costIn = b.fuel_cost_halalas == null || b.transport_cost_halalas == null ? null : b.fuel_cost_halalas + b.transport_cost_halalas;
  return { quantity_ml: b.quantity_ml, issued_ml: r.issued, balance_ml: r.bal, avg_cost_per_ml: costIn == null ? null : costIn / b.quantity_ml };
}

/** مصادر الصرف المتاحة في موقع: خزانات + دفعات مباشرة لرحلات في الموقع */
export function sourcesForSite(ctx, siteId) {
  const tanks = q.all('SELECT t.*, s.name site_name FROM tanks t JOIN sites s ON s.id = t.site_id WHERE t.company_id = ?' + (siteId ? ' AND t.site_id = ?' : ''),
    ...[ctx.companyId, siteId].filter(Boolean)).map((t) => ({ type: 'tank', id: t.id, label: `${t.code} - ${t.name}`, site_id: t.site_id, site_name: t.site_name, product: t.product, balance_ml: tankBalance(t.id).available_ml }));
  const batches = q.all(`SELECT b.*, t.number trip_number, t.id trip_id, t.status trip_status, s.name site_name FROM fuel_batches b
      JOIN trip_stops ts ON ts.id = b.trip_stop_id JOIN trips t ON t.id = ts.trip_id JOIN sites s ON s.id = b.site_id
      WHERE b.company_id = ? AND b.mode = 'direct'` + (siteId ? ' AND b.site_id = ?' : ''), ...[ctx.companyId, siteId].filter(Boolean))
    .map((b) => ({ type: 'batch', id: b.id, label: `تزويد مباشر - ${b.trip_number}`, trip_id: b.trip_id, trip_number: b.trip_number, trip_status: b.trip_status, site_id: b.site_id, site_name: b.site_name, product: b.product, balance_ml: batchBalance(b.id).balance_ml }))
    .filter((b) => b.balance_ml > 0);
  return [...tanks, ...batches];
}

export function tankLedger(ctx, tankId) {
  const tank = q.get('SELECT t.*, s.name site_name, s.project_id FROM tanks t JOIN sites s ON s.id = t.site_id WHERE t.id = ? AND t.company_id = ?', tankId, ctx.companyId);
  if (!tank) throw new HttpError(404, 'الخزان غير موجود');
  let running = 0;
  const moves = q.all(`SELECT m.*, u.name by_name,
      (SELECT f.number FROM fuelings f WHERE f.movement_id = m.id) fueling_number,
      (SELECT a.code || ' - ' || a.name FROM fuelings f JOIN assets a ON a.id = f.asset_id WHERE f.movement_id = m.id) asset_label,
      (SELECT t.number FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id WHERE ts.id = m.ref_id AND m.ref_type='trip_stop') trip_number
    FROM fuel_movements m LEFT JOIN users u ON u.id = m.created_by WHERE m.tank_id = ? ORDER BY m.effective_at, m.created_at`, tankId)
    .map((m) => { if (m.status === 'approved') running += m.quantity_ml; return { ...m, running_ml: running }; });
  const counts = q.all('SELECT c.*, u.name by_name FROM stock_counts c LEFT JOIN users u ON u.id = c.counted_by WHERE tank_id = ? ORDER BY counted_at DESC', tankId);
  return { tank, balance: tankBalance(tankId), movements: moves.reverse(), counts };
}

export function openingBalance(ctx, tankId, { liters, cost_per_liter, note }) {
  return tx(() => {
    const tank = q.get('SELECT * FROM tanks WHERE id = ? AND company_id = ?', tankId, ctx.companyId);
    if (!tank) throw new HttpError(404, 'الخزان غير موجود');
    if (q.get("SELECT 1 FROM fuel_movements WHERE tank_id = ? AND kind='opening'", tankId)) throw new HttpError(409, 'سُجّل رصيد افتتاحي سابقًا، استخدم الجرد والتسوية');
    const ml = ML(liters);
    const cost = cost_per_liter != null && cost_per_liter !== '' ? Math.round(Number(cost_per_liter) * 100 * ml / 1000) : null;
    const id = uid('mov_');
    q.run(`INSERT INTO fuel_movements(id,company_id,kind,tank_id,quantity_ml,cost_halalas,note,created_by,approved_by) VALUES (?,?,'opening',?,?,?,?,?,?)`,
      id, ctx.companyId, tankId, ml, cost, note || 'رصيد افتتاحي', ctx.userId, ctx.userId);
    audit(ctx, 'tank.opening', 'tank', tankId, { ml, cost });
    return { ok: true, id };
  });
}

export function transfer(ctx, { from_tank_id, to_tank_id, liters, note }) {
  return tx(() => {
    const a = q.get('SELECT * FROM tanks WHERE id = ? AND company_id = ?', from_tank_id, ctx.companyId);
    const b = q.get('SELECT * FROM tanks WHERE id = ? AND company_id = ?', to_tank_id, ctx.companyId);
    if (!a || !b || a.id === b.id) throw new HttpError(400, 'اختر خزانين مختلفين');
    if (a.product !== b.product) throw new HttpError(409, 'المنتج مختلف بين الخزانين');
    const ml = ML(liters);
    const bal = tankBalance(a.id);
    if (ml <= 0 || ml > bal.available_ml) throw new HttpError(409, `الرصيد المتاح ${L(bal.available_ml)} لتر`);
    const cost = bal.avg_cost_per_ml == null ? null : Math.round(bal.avg_cost_per_ml * ml);
    const outId = uid('mov_'), inId = uid('mov_');
    q.run(`INSERT INTO fuel_movements(id,company_id,kind,tank_id,quantity_ml,cost_halalas,related_movement_id,note,created_by,approved_by) VALUES (?,?,'transfer_out',?,?,?,?,?,?,?)`,
      outId, ctx.companyId, a.id, -ml, cost == null ? null : -cost, inId, note || `تحويل إلى ${b.code}`, ctx.userId, ctx.userId);
    q.run(`INSERT INTO fuel_movements(id,company_id,kind,tank_id,quantity_ml,cost_halalas,related_movement_id,note,created_by,approved_by) VALUES (?,?,'transfer_in',?,?,?,?,?,?,?)`,
      inId, ctx.companyId, b.id, ml, cost, outId, note || `تحويل من ${a.code}`, ctx.userId, ctx.userId);
    audit(ctx, 'tank.transfer', 'tank', a.id, { to: b.id, ml });
    return { ok: true };
  });
}

/** الجرد: فرق بين الدفتري والقراءة الميدانية → استثناء يحتاج موافقة قبل التسوية */
export function stockCount(ctx, tankId, { measured_liters }) {
  return tx(() => {
    const tank = q.get('SELECT * FROM tanks WHERE id = ? AND company_id = ?', tankId, ctx.companyId);
    if (!tank) throw new HttpError(404, 'الخزان غير موجود');
    const book = tankBalance(tankId).book_ml;
    const measured = ML(measured_liters);
    const variance = measured - book;
    const id = uid('cnt_');
    q.run(`INSERT INTO stock_counts(id,tank_id,company_id,book_ml,measured_ml,variance_ml,counted_by,counted_at,status) VALUES (?,?,?,?,?,?,?,?,?)`,
      id, tankId, ctx.companyId, book, measured, variance, ctx.userId, now(), variance === 0 ? 'approved' : 'pending');
    if (variance !== 0) {
      const eid = uid('exc_');
      q.run('INSERT INTO exceptions(id,company_id,type,ref_type,ref_id,title,details_json) VALUES (?,?,?,?,?,?,?)',
        eid, ctx.companyId, 'stock_variance', 'stock_count', id, `فرق جرد ${L(variance)} لتر في ${tank.code}`, JSON.stringify({ book_ml: book, measured_ml: measured, variance_ml: variance, tank_id: tankId }));
    }
    audit(ctx, 'tank.count', 'tank', tankId, { book, measured });
    return { ok: true, id, variance_ml: variance };
  });
}

export function approveStockVariance(ctx, countId) {
  const c = q.get("SELECT * FROM stock_counts WHERE id = ? AND status='pending'", countId);
  if (!c) throw new HttpError(404, 'الجرد غير موجود');
  const bal = tankBalance(c.tank_id);
  const cost = bal.avg_cost_per_ml == null ? null : Math.round(bal.avg_cost_per_ml * c.variance_ml);
  const mid = uid('mov_');
  q.run(`INSERT INTO fuel_movements(id,company_id,kind,tank_id,quantity_ml,cost_halalas,ref_type,ref_id,note,created_by,approved_by) VALUES (?,?,'adjustment',?,?,?,'stock_count',?,?,?,?)`,
    mid, c.company_id, c.tank_id, c.variance_ml, cost, c.id, 'تسوية جرد معتمدة', c.counted_by, ctx.userId);
  q.run("UPDATE stock_counts SET status='approved', adjustment_movement_id=? WHERE id = ?", mid, c.id);
}
