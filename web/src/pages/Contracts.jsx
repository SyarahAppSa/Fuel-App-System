import React, { useState } from 'react';
import { FileSignature, Package, CalendarRange, Plus, Trash2, Check, X, AlertTriangle } from 'lucide-react';
import { api, useApi, liters, sar, dOnly, dt, today, fail, toast, PRODUCTS } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Meter, Alert } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

const STATE = { pending_carrier: ['بانتظار موافقة الناقل', 'warn'], active: ['ساري', 'good'], scheduled: ['يبدأ لاحقًا', 'info'], expired: ['منتهٍ', ''], rejected: ['مرفوض', 'bad'], terminated: ['منهى', ''],
  exhausted: ['مستنفد', ''], cancelled: ['ملغى', ''], confirmed: ['مؤكد', 'good'] };
const St = ({ s }) => <Chip tone={STATE[s]?.[1]}>{STATE[s]?.[0] || s}</Chip>;

export default function Contracts() {
  const me = useMe();
  const isCarrier = me.company.type === 'carrier';
  const r = useApi('/contracts');
  const lk = useApi('/lookups').data;
  const org = useApi(isCarrier ? null : '/org').data;
  const [tab, setTab] = useState('contracts');
  const [modal, setModal] = useState(null);
  if (!r.data) return <Spinner />;
  const { contracts, packages, reservations, carriers } = r.data;
  const decide = async (kind, id, decision) => {
    const reason = decision === 'reject' ? prompt('سبب الرفض') : null; if (decision === 'reject' && !reason) return;
    try { await api(`/carrier/${kind}/${id}/${decision}`, { method: 'POST', body: { reason } }); toast(decision === 'accept' ? 'تمت الموافقة' : 'تم الرفض'); r.reload(); } catch (e) { fail(e); }
  };
  const Decide = ({ kind, row }) => isCarrier && row.status === 'pending_carrier' && can(me, 'carrier.dispatch') ? (
    <div className="row" style={{ gap: 6 }}><button className="btn sm primary" onClick={() => decide(kind, row.id, 'accept')}><Check size={14} /> {kind === 'capacity' ? 'تأكيد السعة' : 'موافقة'}</button>
      <button className="btn sm danger" onClick={() => decide(kind, row.id, 'reject')}><X size={14} /> رفض</button></div>) : null;
  const party = (x) => (isCarrier ? x.client_name : x.carrier_name);
  const pend = (list) => list.filter((x) => x.status === 'pending_carrier').length;
  return (
    <>
      <Title sub={isCarrier ? 'عقود العملاء وباقاتهم وطلبات حجز السعة' : 'عقود شهرية وسنوية، باقات رحلات مدفوعة مسبقًا، وحجز سعة للمشاريع'}>العقود والباقات</Title>
      <div className="tabs">
        {[['contracts', 'العقود', contracts], ['packages', 'باقات الرحلات', packages], ['capacity', 'حجز السعة', reservations]].map(([k, l, list]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} {pend(list) > 0 && <Chip tone="warn">{pend(list)}</Chip>}</button>))}
        <div className="grow" />
        {!isCarrier && can(me, 'order.create') && <button className="btn primary sm" style={{ margin: '6px 0' }} onClick={() => setModal(tab)}><Plus size={15} /> {{ contracts: 'عقد جديد', packages: 'باقة جديدة', capacity: 'حجز سعة' }[tab]}</button>}
      </div>

      {tab === 'contracts' && (contracts.length ? <div className="stack">{contracts.map((c) => (
        <Card key={c.id} icon={<FileSignature size={18} color="var(--brand)" />} title={<>{c.number} — {party(c)}</>} actions={<><Chip tone="info">{c.type === 'monthly' ? 'شهري' : 'سنوي'}</Chip><St s={c.state} /><Decide kind="contract" row={c} /></>}>
          <div className="grid g4">
            <dl className="kv"><dt>المدة</dt><dd>{dOnly(c.start_date)} ← {dOnly(c.end_date)}</dd><dt>التجديد</dt><dd>{c.auto_renew ? 'تلقائي' : 'يدوي'}</dd></dl>
            <dl className="kv"><dt>السعة المضمونة</dt><dd>{c.guaranteed_trips_per_month || '—'} رحلة/شهر</dd><dt>مستوى الخدمة</dt><dd>{c.sla_on_time_pct}% في الموعد · نافذة {c.delivery_window_hours} س</dd></dl>
            <dl className="kv"><dt>رحلات هذا الشهر</dt><dd>{c.usage.this_month_trips} {c.usage.over_guarantee && <Chip tone="warn"><AlertTriangle size={12} /> تجاوز المضمون</Chip>}</dd>
              <dt>الالتزام الفعلي</dt><dd>{c.usage.on_time_pct == null ? 'بيانات غير كافية' : `${c.usage.on_time_pct}% (${c.usage.on_time_sample} رحلة)`} {c.usage.sla_breached && <Chip tone="bad">دون مستوى الخدمة</Chip>}</dd></dl>
            <dl className="kv"><dt>إجمالي الرحلات</dt><dd>{c.usage.total_trips}</dd><dt>الإنفاق</dt><dd className="num">{sar(c.usage.spend_halalas)} ر.س</dd>
              <dt>ناقل بديل</dt><dd>{c.allow_backup_carrier ? `مسموح حتى +${c.max_backup_price_diff_pct ?? 0}%` : 'غير مسموح'}</dd></dl>
          </div>
          <table className="t mt"><thead><tr><th>المسار</th><th>المنتج</th><th>التسعير</th><th>السعر</th><th>الإلغاء</th></tr></thead>
            <tbody>{c.rates.map((x) => <tr key={x.id}><td>{x.loading_point_name} ← {x.delivery_city}</td><td>{PRODUCTS[x.product]}</td><td>{x.pricing_type === 'fixed' ? 'ثابت للرحلة' : 'لكل 1000 لتر'}</td>
              <td className="num"><b>{sar(x.price_halalas)}</b> ر.س</td><td className="num">{sar(x.cancel_fee_halalas)}</td></tr>)}</tbody></table>
          {c.decision_reason && <div className="small muted mt">سبب الرفض: {c.decision_reason}</div>}
        </Card>))}</div> : <Empty>لا توجد عقود. العقد يمنحك أسعارًا ثابتة لكل مسار تظهر تلقائيًا عند طلب النقل.</Empty>)}

      {tab === 'packages' && (packages.length ? <div className="grid g2">{packages.map((p) => (
        <Card key={p.id} icon={<Package size={18} color="var(--brand)" />} title={<>{p.number} — {party(p)}</>} actions={<><St s={p.state} /><Decide kind="package" row={p} /></>}>
          <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
            <div><div className="small muted">المتوافر</div><div style={{ fontSize: 30, fontWeight: 800 }} className="num">{p.balance.available}<small className="muted" style={{ fontSize: 14 }}> / {p.balance.total}</small></div></div>
            <div className="grow"><Meter value={p.balance.consumed + p.balance.reserved} max={p.balance.total} />
              <div className="row small" style={{ marginTop: 6 }}><Chip>منفذ {p.balance.consumed}</Chip><Chip tone="warn">محجوز {p.balance.reserved}</Chip><Chip tone="good">متوافر {p.balance.available}</Chip></div></div>
          </div>
          <dl className="kv mt"><dt>المسار</dt><dd>{p.loading_point_name} ← {p.delivery_city} · {PRODUCTS[p.product]} · حتى {liters(p.max_liters_per_trip_ml)} لتر/رحلة</dd>
            <dt>السعر</dt><dd><span className="num">{sar(p.price_halalas)}</span> ر.س ({sar(p.balance.unit_price_halalas)} للرحلة)</dd>
            <dt>الصلاحية</dt><dd>{dOnly(p.start_date)} ← {dOnly(p.expiry_date)}</dd>
            <dt>الإلغاء بعد القبول</dt><dd>{p.late_cancel_consumes ? 'يخصم الرحلة' : 'يعيد الرصيد'}</dd></dl>
          {p.balance.allocations.length > 0 && <table className="t mt"><thead><tr><th>المشروع</th><th>الحصة</th><th>منفذ</th><th>محجوز</th><th>متوافر</th></tr></thead>
            <tbody>{p.balance.allocations.map((a) => <tr key={a.id}><td>{a.project_code}</td><td>{a.trips}</td><td>{a.consumed}</td><td>{a.reserved}</td><td><b>{a.available}</b></td></tr>)}</tbody></table>}
          {p.ledger.length > 0 && <details className="mt"><summary className="small" style={{ cursor: 'pointer' }}>سجل حركة الرصيد ({p.ledger.length})</summary>
            {p.ledger.map((l) => <div key={l.id} className="small" style={{ marginTop: 4 }}><Chip tone={{ reserve: 'warn', consume: '', release: 'good' }[l.kind]}>{{ reserve: 'حجز', consume: 'خصم', release: 'إعادة' }[l.kind]}</Chip> {l.trip_number} · {l.note} · <span className="muted">{dt(l.at)}</span></div>)}</details>}
        </Card>))}</div> : <Empty>لا توجد باقات. الباقة رصيد رحلات مدفوع مسبقًا يُحجز عند الطلب ويُخصم عند التسليم.</Empty>)}

      {tab === 'capacity' && (reservations.length ? <div className="stack">{reservations.map((x) => (
        <Card key={x.id} icon={<CalendarRange size={18} color="var(--brand)" />} title={<>{x.number} — {party(x)}</>} actions={<><St s={x.status} /><Decide kind="capacity" row={x} /></>}>
          <div className="grid g3">
            <dl className="kv"><dt>الفترة</dt><dd>{dOnly(x.period_start)} ← {dOnly(x.period_end)}</dd><dt>المنطقة</dt><dd>{x.delivery_city} · {PRODUCTS[x.product]}</dd></dl>
            <div><div className="small muted">الاستخدام</div><b className="num" style={{ fontSize: 22 }}>{x.usage.used} / {x.trips}</b> <span className="small muted">رحلة</span><Meter value={x.usage.used} max={x.trips} tone={x.usage.over ? 'bad' : ''} /></div>
            {x.capacity && <div><div className="small muted">سعة الناقل في الفترة</div><div className="small">{x.capacity.vehicles} صهريج × {x.capacity.days} يوم = {x.capacity.total} رحلة · محجوز لآخرين {x.capacity.reserved} · متاح <b>{x.capacity.free}</b></div>
              {x.status === 'pending_carrier' && x.trips > x.capacity.free && <Alert tone="bad">تعارض: المطلوب {x.trips} والمتاح {x.capacity.free}</Alert>}</div>}
          </div>
          {x.usage.allocations.length > 0 && <table className="t mt"><thead><tr><th>المشروع</th><th>المخصص</th><th>المستخدم</th><th></th></tr></thead>
            <tbody>{x.usage.allocations.map((a) => <tr key={a.id}><td>{a.project_code} {a.project_name}</td><td>{a.trips}</td><td>{a.used}</td><td>{a.over && <Chip tone="bad">تجاوز حصة المشروع</Chip>}</td></tr>)}</tbody></table>}
        </Card>))}</div> : <Empty>لا توجد حجوزات سعة. احجز عدد رحلات لمنطقة وفترة، ويُربط أي طلب ضمنها تلقائيًا.</Empty>)}

      {modal === 'contracts' && <ContractModal carriers={carriers} lk={lk} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
      {modal === 'packages' && <PackageModal carriers={carriers} lk={lk} org={org} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
      {modal === 'capacity' && <CapacityModal carriers={carriers} lk={lk} org={org} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
    </>
  );
}

const cityList = (lk) => <datalist id="ccities">{(lk?.cities || []).map((c) => <option key={c} value={c} />)}</datalist>;

function ContractModal({ carriers, lk, onClose, onDone }) {
  const [v, setV] = useState({ carrier_id: carriers[0]?.id, type: 'monthly', start_date: today(), guaranteed_trips_per_month: 8, sla_on_time_pct: 95, delivery_window_hours: 8, auto_renew: true, allow_backup_carrier: false, max_backup_price_diff_pct: 10 });
  const [rates, setRates] = useState([{ loading_point_id: 'lp_ryd', delivery_city: 'الرياض', product: 'diesel', pricing_type: 'fixed', price_sar: '', cancel_fee_sar: 250, waiting_fee_sar: 60 }]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => { try { const r = await api('/contracts', { method: 'POST', body: { ...v, rates } }); toast(`أُرسل العقد ${r.number} للناقل`); onDone(); } catch (e) { fail(e); } };
  return (
    <Modal title="عقد نقل جديد" onClose={onClose} wide footer={<button className="btn primary" onClick={save}>إرسال للناقل</button>}>
      <div className="form-grid">
        <Field label="الناقل"><select className="input" value={v.carrier_id} onChange={set('carrier_id')}>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</select></Field>
        <Field label="النوع"><select className="input" value={v.type} onChange={set('type')}><option value="monthly">شهري</option><option value="annual">سنوي</option></select></Field>
        <Field label="البداية" hint="النهاية تُحسب تلقائيًا"><input type="date" className="input" value={v.start_date} onChange={set('start_date')} /></Field>
        <Field label="رحلات مضمونة/شهر"><input type="number" className="input" value={v.guaranteed_trips_per_month} onChange={set('guaranteed_trips_per_month')} /></Field>
        <Field label="الالتزام بالموعد %"><input type="number" className="input" value={v.sla_on_time_pct} onChange={set('sla_on_time_pct')} /></Field>
        <Field label="نافذة التنفيذ (ساعة)"><input type="number" className="input" value={v.delivery_window_hours} onChange={set('delivery_window_hours')} /></Field>
      </div>
      <div className="row mt"><label className="row small"><input type="checkbox" checked={v.auto_renew} onChange={set('auto_renew')} /> تجديد تلقائي</label>
        <label className="row small"><input type="checkbox" checked={v.allow_backup_carrier} onChange={set('allow_backup_carrier')} /> السماح بناقل بديل</label>
        {v.allow_backup_carrier && <label className="row small">بفارق سعر حتى <input type="number" className="input" style={{ width: 70 }} value={v.max_backup_price_diff_pct} onChange={set('max_backup_price_diff_pct')} />%</label>}</div>
      <h4 className="mt" style={{ marginBottom: 8 }}>أسعار المسارات</h4>
      {cityList(lk)}
      {rates.map((r, i) => {
        const u = (k) => (e) => setRates(rates.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
        return (<div key={i} className="form-grid mb" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', alignItems: 'end' }}>
          <Field label="التحميل"><select className="input" value={r.loading_point_id} onChange={u('loading_point_id')}>{lk?.loading_points.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="مدينة التسليم"><input className="input" list="ccities" value={r.delivery_city} onChange={u('delivery_city')} /></Field>
          <Field label="المنتج"><select className="input" value={r.product} onChange={u('product')}>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="التسعير"><select className="input" value={r.pricing_type} onChange={u('pricing_type')}><option value="fixed">ثابت للرحلة</option><option value="per_1000l">لكل 1000 لتر</option></select></Field>
          <Field label="السعر (ر.س)"><input type="number" className="input" value={r.price_sar} onChange={u('price_sar')} /></Field>
          <Field label="الإلغاء (ر.س)"><input type="number" className="input" value={r.cancel_fee_sar} onChange={u('cancel_fee_sar')} /></Field>
          {rates.length > 1 && <button className="btn sm danger" onClick={() => setRates(rates.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
        </div>);
      })}
      <button className="btn sm" onClick={() => setRates([...rates, { ...rates[rates.length - 1], price_sar: '' }])}><Plus size={14} /> مسار آخر</button>
    </Modal>
  );
}

function Allocations({ org, value, onChange, total, unit = 'رحلة' }) {
  const sum = value.reduce((s, a) => s + Number(a.trips || 0), 0);
  return (<div className="mt"><h4 style={{ marginBottom: 8 }}>التوزيع على المشاريع <span className="small muted">(اختياري — {sum} من {total || 0} {unit})</span></h4>
    {(org?.projects || []).map((p) => { const a = value.find((x) => x.project_id === p.id); return (
      <div key={p.id} className="row mb"><span className="grow small">{p.code} — {p.name}</span><input type="number" min="0" className="input" style={{ width: 90 }} value={a?.trips || ''}
        onChange={(e) => onChange([...value.filter((x) => x.project_id !== p.id), { project_id: p.id, trips: e.target.value }])} /></div>); })}
    {sum > Number(total || 0) && <Alert tone="bad">التوزيع يتجاوز الإجمالي</Alert>}</div>);
}

function PackageModal({ carriers, lk, org, onClose, onDone }) {
  const [v, setV] = useState({ carrier_id: carriers[0]?.id, loading_point_id: 'lp_ryd', delivery_city: 'الرياض', product: 'diesel', total_trips: 10, price_sar: 13000, max_liters_per_trip: 32000, start_date: today(), expiry_date: today(90), late_cancel_consumes: true });
  const [alloc, setAlloc] = useState([]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => { try { const r = await api('/packages', { method: 'POST', body: { ...v, allocations: alloc } }); toast(`أُرسلت الباقة ${r.number} للناقل`); onDone(); } catch (e) { fail(e); } };
  return (
    <Modal title="باقة رحلات جديدة" onClose={onClose} wide footer={<button className="btn primary" onClick={save}>إرسال للناقل</button>}>
      {cityList(lk)}
      <div className="form-grid">
        <Field label="الناقل"><select className="input" value={v.carrier_id} onChange={set('carrier_id')}>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</select></Field>
        <Field label="نقطة التحميل"><select className="input" value={v.loading_point_id} onChange={set('loading_point_id')}>{lk?.loading_points.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="مدينة التسليم"><input className="input" list="ccities" value={v.delivery_city} onChange={set('delivery_city')} /></Field>
        <Field label="المنتج"><select className="input" value={v.product} onChange={set('product')}>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="عدد الرحلات"><input type="number" className="input" value={v.total_trips} onChange={set('total_trips')} /></Field>
        <Field label="سعر الباقة (ر.س)" hint={v.total_trips ? `${(v.price_sar / v.total_trips).toFixed(2)} ر.س للرحلة` : ''}><input type="number" className="input" value={v.price_sar} onChange={set('price_sar')} /></Field>
        <Field label="حد الرحلة (لتر)"><input type="number" className="input" value={v.max_liters_per_trip} onChange={set('max_liters_per_trip')} /></Field>
        <Field label="تبدأ"><input type="date" className="input" value={v.start_date} onChange={set('start_date')} /></Field>
        <Field label="تنتهي"><input type="date" className="input" value={v.expiry_date} onChange={set('expiry_date')} /></Field>
      </div>
      <label className="row small mt"><input type="checkbox" checked={v.late_cancel_consumes} onChange={set('late_cancel_consumes')} /> الإلغاء بعد قبول الناقل يخصم الرحلة من الباقة</label>
      <Alert tone="info">يُحجز رصيد رحلة عند إنشاء الطلب، ويُخصم عند التسليم، ويعود عند الإلغاء قبل القبول أو رفض الناقل.</Alert>
      <Allocations org={org} value={alloc} onChange={setAlloc} total={v.total_trips} />
    </Modal>
  );
}

function CapacityModal({ carriers, lk, org, onClose, onDone }) {
  const [v, setV] = useState({ carrier_id: carriers[0]?.id, delivery_city: 'الرياض', product: 'diesel', period_start: today(7), period_end: today(13), trips: 6 });
  const [alloc, setAlloc] = useState([]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const cap = useApi(v.carrier_id && v.period_start && v.period_end ? `/capacity/check?carrier_id=${v.carrier_id}&product=${v.product}&period_start=${v.period_start}&period_end=${v.period_end}` : null, [v.carrier_id, v.product, v.period_start, v.period_end]);
  const save = async () => { try { const r = await api('/capacity', { method: 'POST', body: { ...v, allocations: alloc } }); toast(r.conflict ? `أُرسل ${r.number} — تنبيه: يتجاوز السعة المتاحة` : `أُرسل الحجز ${r.number} للناقل`); onDone(); } catch (e) { fail(e); } };
  return (
    <Modal title="حجز سعة نقل" onClose={onClose} wide footer={<button className="btn primary" onClick={save}>إرسال للناقل</button>}>
      {cityList(lk)}
      <div className="form-grid">
        <Field label="الناقل"><select className="input" value={v.carrier_id} onChange={set('carrier_id')}>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name_ar}</option>)}</select></Field>
        <Field label="المنطقة / المدينة"><input className="input" list="ccities" value={v.delivery_city} onChange={set('delivery_city')} /></Field>
        <Field label="المنتج"><select className="input" value={v.product} onChange={set('product')}>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="من"><input type="date" className="input" value={v.period_start} onChange={set('period_start')} /></Field>
        <Field label="إلى"><input type="date" className="input" value={v.period_end} onChange={set('period_end')} /></Field>
        <Field label="عدد الرحلات"><input type="number" className="input" value={v.trips} onChange={set('trips')} /></Field>
      </div>
      {cap.data && <div className="mt"><Alert tone={Number(v.trips) > cap.data.free ? 'bad' : 'good'}>سعة الناقل: {cap.data.vehicles} صهريج × {cap.data.days} يوم = {cap.data.total} رحلة · محجوز لآخرين {cap.data.reserved} · متاح <b>{cap.data.free}</b>
        {Number(v.trips) > cap.data.free && ' — الطلب يتجاوز المتاح وسيرفضه النظام عند تأكيد الناقل'}</Alert></div>}
      <Allocations org={org} value={alloc} onChange={setAlloc} total={v.trips} />
    </Modal>
  );
}
