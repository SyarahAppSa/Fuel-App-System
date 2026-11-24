import React, { useState } from 'react';
import { ArrowLeftRight, ClipboardList, PlusCircle } from 'lucide-react';
import { api, useApi, navigate, liters, sar, dt, fail, toast, PRODUCTS } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, TankGauge, Alert } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

const KIND = { opening: 'رصيد افتتاحي', receipt: 'استلام رحلة', issue: 'صرف لمعدة', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', return: 'مرتجع', adjustment: 'تسوية', reversal: 'تصحيح', direct_allocation: 'تخصيص مباشر' };

export function Tanks() {
  const me = useMe();
  const org = useApi('/org');
  const [modal, setModal] = useState(false);
  if (!org.data) return <Spinner />;
  const tanks = org.data.tanks;
  const transfer = async (e) => { e.preventDefault(); try { await api('/tanks/transfer', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('سُجّل التحويل بحركتين مترابطتين'); setModal(false); org.reload(); } catch (err) { fail(err); } };
  return (
    <>
      <Title sub="أرصدة دفترية من الحركات المعتمدة">الخزانات والمخزون</Title>
      <div className="filters"><div className="grow" />{can(me, 'inventory.manage') && <button className="btn" onClick={() => setModal(true)}><ArrowLeftRight size={15} /> تحويل بين خزانات</button>}</div>
      <div className="grid g3">{tanks.map((t) => (
        <div key={t.id} className="card" style={{ padding: 16, cursor: 'pointer' }} onClick={() => navigate('/tanks/' + t.id)}>
          <TankGauge t={t} />
          <div className="sep" />
          <div className="row small"><span className="muted">متاح للتخصيص</span><b className="num">{liters(t.available_ml)}</b><span className="grow" /><span className="muted">القيمة</span><b className="num">{t.value_halalas == null ? 'غير متوفرة' : sar(t.value_halalas)}</b></div>
        </div>))}
      </div>
      {modal && (
        <Modal title="تحويل بين خزانات" onClose={() => setModal(false)}>
          <form onSubmit={transfer} className="stack">
            <Field label="من"><select name="from_tank_id" className="input">{tanks.map((t) => <option key={t.id} value={t.id}>{t.code} — {liters(t.available_ml)} لتر</option>)}</select></Field>
            <Field label="إلى"><select name="to_tank_id" className="input" defaultValue={tanks[1]?.id}>{tanks.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</select></Field>
            <Field label="الكمية (لتر)"><input name="liters" type="number" className="input" required /></Field>
            <button className="btn primary">تسجيل التحويل</button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function TankDetail({ id }) {
  const me = useMe();
  const r = useApi('/tanks/' + id);
  const [modal, setModal] = useState(null);
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!r.data) return <Spinner />;
  const { tank, balance, movements, counts } = r.data;
  const submit = (path, msg) => async (e) => { e.preventDefault(); try { const x = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast(x.variance_ml ? `سُجّل الجرد بفرق ${liters(x.variance_ml, 1)} لتر — أُحيل للموافقة` : msg); setModal(null); r.reload(); } catch (err) { fail(err); } };
  const sums = {}; for (const m of movements.filter((m) => m.status === 'approved')) sums[m.kind] = (sums[m.kind] || 0) + m.quantity_ml;
  return (
    <>
      <Title sub={`${tank.site_name} · ${PRODUCTS[tank.product]}`}>{tank.code} — {tank.name}</Title>
      <div className="grid g-main">
        <Card title="ملخص المخزون">
          <div className="grid g4" style={{ gap: 10 }}>
            {[['opening', 'افتتاحي'], ['receipt', 'استلام'], ['issue', 'صرف'], ['transfer_in', 'تحويل وارد'], ['transfer_out', 'تحويل صادر'], ['adjustment', 'تسويات'], ['reversal', 'تصحيحات']].map(([k, l]) => (
              <div key={k}><div className="tiny muted">{l}</div><b className="num">{liters(sums[k] || 0)}</b></div>))}
            <div><div className="tiny muted">الرصيد الدفتري</div><b className="num" style={{ fontSize: 18, color: 'var(--data)' }}>{liters(balance.book_ml)}</b></div>
          </div>
          <div className="tiny muted mt">قيمة المخزون: {balance.value_halalas == null ? 'غير متوفرة (يوجد استلام بلا تكلفة)' : sar(balance.value_halalas) + ' ر.س بالمتوسط المرجّح'} · مسودات معلقة {liters(balance.draft_ml)} لتر</div>
        </Card>
        <div className="card stack" style={{ padding: 16 }}>
          <TankGauge t={{ ...tank, ...balance }} />
          {can(me, 'inventory.manage') && <div className="row"><button className="btn sm" onClick={() => setModal('count')}><ClipboardList size={14} /> تسجيل جرد</button>{!movements.some((m) => m.kind === 'opening') && <button className="btn sm" onClick={() => setModal('opening')}><PlusCircle size={14} /> رصيد افتتاحي</button>}</div>}
        </div>
      </div>
      <Card className="mt" title="دفتر الحركات" flush><div className="tscroll"><table className="t">
        <thead><tr><th>الوقت</th><th>الحركة</th><th>المرجع</th><th>الكمية</th><th>الرصيد</th><th>التكلفة</th><th>بواسطة</th><th>الحالة</th></tr></thead>
        <tbody>{movements.map((m) => (
          <tr key={m.id}><td className="small">{dt(m.effective_at)}</td><td>{KIND[m.kind]}</td>
            <td className="small">{m.fueling_number ? <a href={'/fuelings/' + m.ref_id} onClick={(e) => { e.preventDefault(); navigate('/fuelings/' + m.ref_id); }} style={{ color: 'var(--brand-2)' }}>{m.fueling_number} · {m.asset_label}</a> : m.trip_number ? `رحلة ${m.trip_number}` : m.note}</td>
            <td className="num" style={{ color: m.quantity_ml < 0 ? 'var(--bad)' : 'var(--good)', fontWeight: 600 }}>{m.quantity_ml > 0 ? '+' : ''}{liters(m.quantity_ml, 1)}</td>
            <td className="num">{liters(m.running_ml)}</td><td className="num small">{m.cost_halalas == null ? '—' : sar(m.cost_halalas)}</td><td className="small">{m.by_name}</td>
            <td><Chip tone={m.status === 'approved' ? 'good' : 'warn'}>{m.status === 'approved' ? 'معتمدة' : 'معلقة'}</Chip></td></tr>))}</tbody></table></div></Card>
      {counts.length > 0 && <Card className="mt" title="نتائج الجرد" flush><table className="t"><thead><tr><th>الوقت</th><th>الدفتري</th><th>الفعلي</th><th>الفرق</th><th>الحالة</th><th>بواسطة</th></tr></thead>
        <tbody>{counts.map((c) => <tr key={c.id}><td className="small">{dt(c.counted_at)}</td><td className="num">{liters(c.book_ml)}</td><td className="num">{liters(c.measured_ml)}</td><td className="num" style={{ color: c.variance_ml ? 'var(--bad)' : undefined }}>{liters(c.variance_ml, 1)}</td>
          <td><Chip tone={{ approved: 'good', pending: 'warn', rejected: 'bad' }[c.status]}>{{ approved: 'مسوّى', pending: 'بانتظار الموافقة', rejected: 'مرفوض' }[c.status]}</Chip></td><td className="small">{c.by_name}</td></tr>)}</tbody></table></Card>}
      {modal === 'count' && <Modal title="تسجيل قراءة جرد" onClose={() => setModal(null)}><form onSubmit={submit(`/tanks/${id}/count`, 'الجرد مطابق')} className="stack">
        <Alert tone="info">الرصيد الدفتري الحالي {liters(balance.book_ml, 1)} لتر. أي فرق يحتاج موافقة قبل التسوية.</Alert>
        <Field label="القراءة الميدانية (لتر)"><input name="measured_liters" type="number" step="0.1" className="input" required /></Field><button className="btn primary">تسجيل</button></form></Modal>}
      {modal === 'opening' && <Modal title="رصيد افتتاحي" onClose={() => setModal(null)}><form onSubmit={submit(`/tanks/${id}/opening`, 'سُجّل الرصيد الافتتاحي')} className="stack">
        <Field label="الكمية (لتر)"><input name="liters" type="number" className="input" required /></Field><Field label="تكلفة اللتر (ر.س)" hint="اختياري"><input name="cost_per_liter" type="number" step="0.01" className="input" /></Field>
        <Field label="ملاحظة"><input name="note" className="input" /></Field><button className="btn primary">تسجيل</button></form></Modal>}
    </>
  );
}
