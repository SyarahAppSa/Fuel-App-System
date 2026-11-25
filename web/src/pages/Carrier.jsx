import React, { useState } from 'react';
import { Plus, Truck, UserRound, Tag, Route, Wallet, Clock } from 'lucide-react';
import { Logo } from './NewOrder.jsx';
import { api, useApi, navigate, liters, sar, dOnly, fail, toast, PRODUCTS, TRIP_TONE } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Kpi } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

export function CarrierOverview() {
  const me = useMe();
  const o = useApi('/carrier/overview');
  const req = useApi('/trips?status=awaiting_acceptance,awaiting_assignment');
  if (!o.data) return <Spinner />;
  const by = Object.fromEntries(o.data.by_status.map((s) => [s.status, s.n]));
  const active = ['assigned', 'to_loading', 'at_loading', 'loaded', 'to_delivery', 'at_site'].reduce((s, k) => s + (by[k] || 0), 0);
  return (
    <>
      <Title sub={me.company.name}>لوحة الناقل</Title>
      <div className="grid g4">
        <Kpi icon={Route} label="طلبات بانتظار القبول" value={by.awaiting_acceptance || 0} tone={by.awaiting_acceptance ? 'warn' : undefined} onClick={() => navigate('/trips')} />
        <Kpi icon={Truck} label="بانتظار الإسناد / قيد التنفيذ" value={`${by.awaiting_assignment || 0} / ${active}`} onClick={() => navigate('/trips')} />
        <Kpi icon={Wallet} label="إيرادات الرحلات المنفذة" value={sar(o.data.revenue_halalas)} unit="ر.س" />
        <Kpi icon={Clock} label="الالتزام بالموعد" value={o.data.performance.on_time_pct == null ? 'بيانات غير كافية' : o.data.performance.on_time_pct + '%'} foot={`${o.data.vehicles} صهريج · ${o.data.drivers} سائق`} />
      </div>
      <Card className="mt" title="طلبات تحتاج إجراء" flush>
        {!req.data?.length ? <Empty>لا توجد طلبات جديدة</Empty> : <table className="t"><tbody>{req.data.map((t) => (
          <tr key={t.id} className="click" onClick={() => navigate('/trips/' + t.id)}><td className="num"><b>{t.number}</b></td><td><Chip tone={TRIP_TONE[t.status]}>{t.status_ar}</Chip></td><td>{t.client_name}</td>
            <td className="small">{t.loading_point_name} ← {t.cities}</td><td className="num">{liters(t.quantity_ml)} لتر</td><td className="small">{dOnly(t.window_start)}</td><td className="num">{sar(t.transport_halalas)} ر.س</td><td><button className="btn sm primary">{t.status === 'awaiting_acceptance' ? 'مراجعة وقبول' : 'إسناد'}</button></td></tr>
        ))}</tbody></table>}
      </Card>
    </>
  );
}

export function Fleet() {
  const me = useMe();
  const r = useApi('/carrier/fleet');
  const lk = useApi('/lookups').data;
  const [modal, setModal] = useState(null);
  if (!r.data) return <Spinner />;
  const post = (path, map = (x) => x) => async (e) => { e.preventDefault(); try { await api(path, { method: 'POST', body: map(Object.fromEntries(new FormData(e.target))) }); toast('تم الحفظ'); setModal(null); r.reload(); } catch (err) { fail(err); } };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <Title sub="الصهاريج والسائقون ونقاط التحميل ومناطق التسليم والأسعار">الأسطول والأسعار</Title>
      <div className="grid g2">
        <Card title="الصهاريج" icon={<Truck size={16} />} actions={can(me, 'carrier.fleet') && <button className="btn sm" onClick={() => setModal('veh')}><Plus size={14} /> صهريج</button>} flush>
          <table className="t"><tbody>{r.data.vehicles.map((v) => <tr key={v.id}><td><b>{v.plate}</b></td><td className="num">{liters(v.capacity_ml)} لتر</td><td className="small">{v.products.split(',').map((p) => PRODUCTS[p]).join('، ')}</td>
            <td>{v.docs_valid_until < today ? <Chip tone="bad">وثائق منتهية {v.docs_valid_until}</Chip> : <Chip tone="good">سارية حتى {v.docs_valid_until}</Chip>}</td></tr>)}</tbody></table>
        </Card>
        <Card title="السائقون" icon={<UserRound size={16} />} actions={can(me, 'carrier.fleet') && <button className="btn sm" onClick={() => setModal('drv')}><Plus size={14} /> سائق</button>} flush>
          <table className="t"><tbody>{r.data.drivers.map((d) => <tr key={d.id}><td><b>{d.name}</b><div className="tiny muted">{d.phone}</div></td><td className="small">{d.license_no}</td>
            <td>{d.license_expiry < today ? <Chip tone="bad">رخصة منتهية</Chip> : <Chip tone="good">حتى {d.license_expiry}</Chip>}</td><td className="small muted">{d.email ? 'لديه حساب' : 'بدون حساب'}</td></tr>)}</tbody></table>
        </Card>
      </div>
      <div className="grid g2 mt">
        <Card title="شعار الشركة" icon={<Tag size={16} />}>
          <div className="row"><Logo name={me.company.name} url={r.data.logo_url} size={64} /><div className="grow small muted">يظهر للعملاء في بطاقة «اختر شركة النقل».</div>
            {can(me, 'carrier.fleet') && <label className="btn sm primary">رفع شعار<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('logo', f); try { await api('/carrier/logo', { method: 'POST', form: fd }); toast('حُدّث الشعار'); r.reload(); } catch (err) { fail(err); } }} /></label>}</div>
        </Card>
        <Card title="مناطق الخدمة" icon={<Route size={16} />} actions={can(me, 'carrier.prices') && <button className="btn sm" onClick={() => setModal('cov')}><Plus size={14} /> منطقة</button>}>
          <div className="small muted mb">تظهر شركتك للعملاء على كل مسار تغطي نقطة تحميله ومدينة تسليمه — بسعر منشور أو بطلب عرض سعر.</div>
          <div className="row">{r.data.coverage.map((c) => <Chip key={c.id} tone={c.kind === 'loading' ? 'info' : 'brand'}>{c.kind === 'loading' ? 'تحميل: ' + (lk?.loading_points.find((l) => l.id === c.ref)?.name || c.ref) : 'تسليم: ' + c.ref}
            {can(me, 'carrier.prices') && <button className="btn ghost sm" style={{ padding: '0 4px' }} onClick={() => api('/carrier/coverage/' + c.id, { method: 'DELETE' }).then(r.reload)}>×</button>}</Chip>)}</div>
        </Card>
      </div>
      <Card className="mt" title="أسعار المسارات" icon={<Tag size={16} />} actions={can(me, 'carrier.prices') && <button className="btn sm primary" onClick={() => setModal('price')}><Plus size={14} /> سعر مسار</button>} flush>
        <table className="t"><thead><tr><th>نقطة التحميل</th><th>مدينة التسليم</th><th>المنتج</th><th>التسعير</th><th>السعر</th><th>الانتظار</th><th>الإلغاء</th><th>الحالة</th></tr></thead>
          <tbody>{r.data.prices.map((p) => <tr key={p.id}><td>{p.loading_point_name}</td><td>{p.delivery_city}</td><td>{PRODUCTS[p.product]}</td><td>{p.pricing_type === 'fixed' ? 'ثابت للمسار' : 'لكل 1000 لتر'}</td>
            <td className="num"><b>{sar(p.price_halalas)}</b> ر.س</td><td className="num small">{sar(p.waiting_fee_halalas_per_hour)}/س</td><td className="num small">{sar(p.cancel_fee_halalas)}</td>
            <td><button className={'chip ' + (p.active ? 'good' : '')} onClick={() => api(`/carrier/prices/${p.id}/toggle`, { method: 'POST' }).then(r.reload)}>{p.active ? 'منشور' : 'موقوف'}</button></td></tr>)}</tbody></table>
        <div className="small muted" style={{ padding: 12 }}>تغطية التحميل: {r.data.coverage.filter((c) => c.kind === 'loading').map((c) => lk?.loading_points.find((l) => l.id === c.ref)?.name).join('، ')} · تغطية التسليم: {r.data.coverage.filter((c) => c.kind === 'delivery').map((c) => c.ref).join('، ')}</div>
      </Card>
      {modal === 'cov' && lk && <Modal title="إضافة منطقة خدمة" onClose={() => setModal(null)}><form className="stack" onSubmit={post('/carrier/coverage')}>
        <Field label="النوع"><select name="kind" className="input"><option value="loading">نقطة تحميل</option><option value="delivery">مدينة تسليم</option></select></Field>
        <Field label="نقطة التحميل أو المدينة" hint="لنقطة التحميل اختر من القائمة؛ للمدينة اكتب اسمها"><input name="ref" className="input" list="covlist" required /><datalist id="covlist">{lk.loading_points.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}{lk.cities.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <button className="btn primary">إضافة</button></form></Modal>}
      {modal === 'veh' && <Modal title="إضافة صهريج" onClose={() => setModal(null)}><form className="stack" onSubmit={post('/carrier/vehicles', (x) => ({ ...x, products: [x.products] }))}>
        <Field label="اللوحة"><input name="plate" className="input" required /></Field><Field label="السعة (لتر)"><input name="capacity_liters" type="number" className="input" required /></Field>
        <Field label="المنتج"><select name="products" className="input">{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="صلاحية الوثائق حتى"><input name="docs_valid_until" type="date" className="input" required /></Field><button className="btn primary">حفظ</button></form></Modal>}
      {modal === 'drv' && <Modal title="إضافة سائق" onClose={() => setModal(null)}><form className="stack" onSubmit={post('/carrier/drivers')}>
        <Field label="الاسم"><input name="name" className="input" required /></Field><Field label="الجوال"><input name="phone" className="input" /></Field>
        <Field label="رقم الرخصة"><input name="license_no" className="input" /></Field><Field label="انتهاء الرخصة"><input name="license_expiry" type="date" className="input" required /></Field><button className="btn primary">حفظ</button></form></Modal>}
      {modal === 'price' && lk && <Modal title="سعر مسار جديد" onClose={() => setModal(null)}><form className="stack" onSubmit={post('/carrier/prices')}>
        <Field label="نقطة التحميل"><select name="loading_point_id" className="input">{lk.loading_points.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="مدينة التسليم"><input name="delivery_city" className="input" list="cities" required /><datalist id="cities">{lk.cities.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="المنتج"><select name="product" className="input">{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="نوع التسعير"><select name="pricing_type" className="input"><option value="fixed">سعر ثابت للمسار</option><option value="per_1000l">لكل 1000 لتر</option></select></Field>
        <Field label="السعر (ر.س)"><input name="price_sar" type="number" step="0.01" className="input" required /></Field>
        <Field label="رسوم الانتظار/ساعة"><input name="waiting_fee_sar" type="number" className="input" defaultValue="75" /></Field><Field label="رسوم الإلغاء"><input name="cancel_fee_sar" type="number" className="input" defaultValue="350" /></Field>
        <button className="btn primary">نشر السعر</button></form></Modal>}
    </>
  );
}
