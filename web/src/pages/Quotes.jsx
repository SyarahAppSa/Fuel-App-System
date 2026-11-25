import React, { useState } from 'react';
import { MessageSquareQuote, Check, X, Truck } from 'lucide-react';
import { api, useApi, liters, sar, dt, dOnly, fail, toast, PRODUCTS } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Alert, PalettePicker } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

const ST = { pending: ['بانتظار ردك', 'warn'], quoted: ['أُرسل العرض', 'good'], declined: ['اعتذرت', 'bad'], used: ['تحول إلى طلب', 'info'], expired: ['انتهت الصلاحية', ''] };

/** طلبات عروض الأسعار الواردة للناقل */
export function Quotes() {
  const me = useMe();
  const r = useApi('/quote-requests');
  const [sel, setSel] = useState(null);
  const [v, setV] = useState({ price_sar: '', valid_hours: 48, earliest_date: '', note: '' });
  if (!r.data) return <Spinner />;
  const respond = async (decline) => {
    try {
      if (decline) { const reason = prompt('سبب الاعتذار'); if (!reason) return; await api(`/carrier/quote-requests/${sel.id}/respond`, { method: 'POST', body: { decline: true, reason } }); }
      else await api(`/carrier/quote-requests/${sel.id}/respond`, { method: 'POST', body: v });
      toast(decline ? 'تم الاعتذار' : 'أُرسل عرض السعر للعميل'); setSel(null); r.reload();
    } catch (e) { fail(e); }
  };
  return (
    <>
      <Title sub="عملاء طلبوا تسعير مسار تخدمه دون سعر منشور">طلبات عروض الأسعار</Title>
      <Card flush>{!r.data.length ? <Empty>لا توجد طلبات عروض أسعار</Empty> : <table className="t">
        <thead><tr><th>الطلب</th><th>العميل</th><th>المسار</th><th>الكمية</th><th>الموعد</th><th>الحالة</th><th>عرضك</th><th></th></tr></thead>
        <tbody>{r.data.map((x) => <tr key={x.id}><td className="num"><b>{x.number}</b><div className="tiny muted">{dt(x.created_at)}</div></td><td>{x.client_name}</td>
          <td className="small">{x.loading_point_name} ← {x.delivery_city}<div className="tiny muted">{PRODUCTS[x.product]}</div></td><td className="num">{liters(x.quantity_ml)} لتر</td>
          <td className="small">{dOnly(x.requested_date + 'T12:00:00Z')} {x.window_start && `${x.window_start}–${x.window_end}`}</td><td><Chip tone={ST[x.status]?.[1]}>{ST[x.status]?.[0]}</Chip></td>
          <td className="num small">{x.price_halalas ? `${sar(x.price_halalas)} ر.س` : '—'}{x.valid_until && <div className="tiny muted">صالح حتى {dt(x.valid_until)}</div>}</td>
          <td>{x.status === 'pending' && can(me, 'carrier.dispatch') && <button className="btn sm primary" onClick={() => { setSel(x); setV({ price_sar: '', valid_hours: 48, earliest_date: x.requested_date, note: '' }); }}><MessageSquareQuote size={14} /> الرد</button>}</td></tr>)}</tbody></table>}</Card>
      {sel && <Modal title={`عرض سعر ${sel.number} — ${sel.client_name}`} onClose={() => setSel(null)} footer={<><button className="btn primary" onClick={() => respond(false)}><Check size={15} /> إرسال العرض</button><button className="btn danger" onClick={() => respond(true)}><X size={15} /> اعتذار</button></>}>
        <Alert tone="info">{sel.loading_point_name} ← {sel.delivery_city} · {liters(sel.quantity_ml)} لتر {PRODUCTS[sel.product]} · {dOnly(sel.requested_date + 'T12:00:00Z')}</Alert>
        <div className="form-grid mt">
          <Field label="أجرة النقل الإجمالية (ر.س)" hint="قبل رسوم خدمة المنصة والضريبة"><input type="number" className="input" value={v.price_sar} onChange={(e) => setV({ ...v, price_sar: e.target.value })} /></Field>
          <Field label="صلاحية العرض (ساعة)"><input type="number" className="input" value={v.valid_hours} onChange={(e) => setV({ ...v, valid_hours: e.target.value })} /></Field>
          <Field label="أقرب موعد تستطيع التنفيذ فيه"><input type="date" className="input" value={v.earliest_date} onChange={(e) => setV({ ...v, earliest_date: e.target.value })} /></Field>
          <Field label="ملاحظة"><input className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        </div>
      </Modal>}
    </>
  );
}

/** تسجيل شركة نقل جديدة — تبقى بانتظار اعتماد إدارة فيول آب */
export function Register() {
  const [v, setV] = useState({ company_name: '', cr_number: '', city: 'الرياض', admin_name: '', phone: '', email: '', password: '' });
  const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async (e) => { e.preventDefault(); setBusy(true); try { await api('/public/register', { method: 'POST', body: v }); setDone(true); } catch (err) { fail(err); } finally { setBusy(false); } };
  return (
    <div style={{ maxWidth: 620, margin: '40px auto', padding: 16 }}>
      <div className="row mb"><img src="/brand/logo-mark.png" height="48" alt="" /><b style={{ fontSize: 22 }}>فيول آب</b><div className="grow" /><div style={{ minWidth: 240 }}><PalettePicker down /></div></div>
      <Card title="تسجيل شركة نقل" icon={<Truck size={18} color="var(--brand)" />}>
        {done ? <div className="stack"><Alert tone="good">استلمنا طلب تسجيل <b>{v.company_name}</b>. تراجع إدارة فيول آب الوثائق وتعتمد الشركة، وبعدها تظهر للعملاء في «اختر شركة النقل» على المسارات التي تغطيها.</Alert>
          <div className="small muted">يمكنك الدخول الآن ببريدك لإضافة الصهاريج والسائقين ومناطق الخدمة والأسعار والشعار.</div><a className="btn primary" href="/">الذهاب لتسجيل الدخول</a></div> : (
          <form onSubmit={submit} className="stack">
            <div className="form-grid">
              <Field label="اسم الشركة"><input className="input" value={v.company_name} onChange={set('company_name')} required /></Field>
              <Field label="السجل التجاري"><input className="input" value={v.cr_number} onChange={set('cr_number')} /></Field>
              <Field label="المدينة"><input className="input" value={v.city} onChange={set('city')} /></Field>
              <Field label="اسم المسؤول"><input className="input" value={v.admin_name} onChange={set('admin_name')} required /></Field>
              <Field label="الجوال"><input className="input" value={v.phone} onChange={set('phone')} /></Field>
              <Field label="البريد"><input type="email" className="input" style={{ direction: 'ltr' }} value={v.email} onChange={set('email')} required /></Field>
              <Field label="كلمة المرور" hint="8 أحرف على الأقل"><input type="password" className="input" value={v.password} onChange={set('password')} required minLength={8} /></Field>
            </div>
            <button className="btn primary lg" disabled={busy}>إرسال طلب التسجيل</button>
          </form>)}
      </Card>
    </div>
  );
}
