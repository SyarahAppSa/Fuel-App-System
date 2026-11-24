// الفوترة ومستحقات الناقلين: فاتورة للعميل ومستحق للناقل لكل رحلة مسلّمة (مرة واحدة)
import { q, tx, uid, now, nextNumber, audit, HttpError } from '../db.js';

const addDays = (iso, d) => new Date(new Date(iso).getTime() + d * 864e5).toISOString();

export function onTripDelivered(trip, at = now()) {
  const o = q.get('SELECT * FROM orders WHERE id = ?', trip.order_id);
  if (!o || o.package_id) return; // الباقة مفوترة مسبقًا
  if (q.get('SELECT 1 FROM invoices WHERE trip_id = ?', trip.id)) return;
  const snap = JSON.parse(o.price_snapshot_json || '{}');
  const req = q.get('SELECT COALESCE(SUM(requested_ml),0) s FROM trip_stops WHERE trip_id = ?', trip.id).s;
  const share = o.quantity_ml ? req / o.quantity_ml : 1;
  const transport = Math.round((snap.base_halalas || 0) * share);
  const fee = Math.round((snap.platform_fee_halalas || 0) * share);
  const vat = Math.round((transport + fee) * 0.15);
  q.run(`INSERT INTO invoices(id,number,client_id,carrier_id,order_id,trip_id,transport_halalas,platform_fee_halalas,vat_halalas,total_halalas,issued_at,due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid('inv_'), nextNumber('invoice', 'FA-INV'), o.company_id, trip.carrier_id, o.id, trip.id, transport, fee, vat, transport + fee + vat, at, addDays(at, 30));
  q.run('INSERT INTO carrier_settlements(id,number,carrier_id,trip_id,amount_halalas,due_at) VALUES (?,?,?,?,?,?)',
    uid('set_'), nextNumber('settlement', 'FA-SET'), trip.carrier_id, trip.id, transport, addDays(at, 15));
}

export function payInvoice(ctx, id, amountSar) {
  return tx(() => {
    const inv = q.get('SELECT * FROM invoices WHERE id = ?', id);
    if (!inv) throw new HttpError(404, 'الفاتورة غير موجودة');
    if (inv.status === 'paid' || inv.status === 'void') throw new HttpError(409, 'الفاتورة مسددة أو ملغاة');
    const amount = amountSar != null && amountSar !== '' ? Math.round(Number(amountSar) * 100) : inv.total_halalas - inv.paid_halalas;
    if (!(amount > 0) || inv.paid_halalas + amount > inv.total_halalas) throw new HttpError(400, 'المبلغ غير صحيح');
    const paid = inv.paid_halalas + amount;
    q.run('UPDATE invoices SET paid_halalas = ?, status = ?, paid_at = ? WHERE id = ?', paid, paid === inv.total_halalas ? 'paid' : 'partially_paid', now(), id);
    audit(ctx, 'admin.invoice.payment', 'invoice', id, { amount_halalas: amount, number: inv.number });
    return { ok: true };
  });
}

export function paySettlement(ctx, id) {
  return tx(() => {
    const s = q.get("SELECT * FROM carrier_settlements WHERE id = ? AND status = 'due'", id);
    if (!s) throw new HttpError(404, 'المستحق غير موجود أو مسدد');
    q.run("UPDATE carrier_settlements SET status='paid', paid_at=?, paid_by=? WHERE id = ?", now(), ctx.userId, id);
    audit(ctx, 'admin.settlement.paid', 'settlement', id, { amount_halalas: s.amount_halalas, number: s.number });
    return { ok: true };
  });
}
