import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api, useApi, liters, fail } from '../lib.js';
import { Card, Chip, Spinner, Empty, Field } from '../ui.jsx';

/** صفحة مستلم الموقع عبر رابط محدود الصلاحية (بدون حساب) */
export default function Receipt({ token }) {
  const r = useApi('/public/receipt/' + token);
  const [v, setV] = useState({ ack: 'confirmed', note: '', name: '' });
  const [done, setDone] = useState(false);
  if (r.error) return <div className="field-app" style={{ padding: 16 }}><Empty>{r.error.message}</Empty></div>;
  if (!r.data) return <Spinner />;
  const s = r.data;
  const submit = async () => { try { await api('/public/receipt/' + token, { method: 'POST', body: v }); setDone(true); r.reload(); } catch (e) { fail(e); } };
  return (
    <div className="field-app" style={{ padding: 16 }}>
      <div className="row mb"><img src="/brand/logo-mark.png" height="44" alt="" /><b style={{ fontSize: 20, color: "var(--brand-2)" }}>فيول آب</b><span className="grow" /><span className="demo-badge">بيانات تجريبية</span></div>
      <Card title={`تأكيد استلام — ${s.trip_number}`}>
        <dl className="kv"><dt>الموقع</dt><dd>{s.site_name}</dd><dt>الناقل</dt><dd>{s.carrier_name}</dd><dt>الصهريج / السائق</dt><dd>{s.plate} · {s.driver_name}</dd>
          <dt>المنتج</dt><dd>{s.product}</dd><dt>المطلوبة</dt><dd className="num">{liters(s.requested_ml)} لتر</dd><dt>المسلّمة حسب السائق</dt><dd className="num">{liters(s.delivered_ml)} لتر</dd><dt>حالة الرحلة</dt><dd>{s.trip_status_ar}</dd></dl>
        <div className="sep" />
        {done || s.receiver_ack ? <div style={{ textAlign: 'center' }}><CheckCircle2 size={42} color="var(--good)" /><div><b>{s.receiver_ack === 'disputed' ? 'سُجّل الاعتراض وسيتواصل معكم المسؤول' : 'تم تأكيد الاستلام'}</b></div></div>
          : s.status !== 'delivered' ? <Chip tone="info">يمكن التأكيد بعد تسجيل السائق للتسليم</Chip> : (
            <div className="stack">
              <div className="row"><label className="row"><input type="radio" checked={v.ack === 'confirmed'} onChange={() => setV({ ...v, ack: 'confirmed' })} /> الكمية مطابقة</label><label className="row"><input type="radio" checked={v.ack === 'disputed'} onChange={() => setV({ ...v, ack: 'disputed' })} /> يوجد فرق</label></div>
              <Field label="اسم المستلم"><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
              <Field label={v.ack === 'disputed' ? 'الكمية المستلمة وسبب الاعتراض' : 'ملاحظة'}><textarea className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
              <button className="btn primary lg block" onClick={submit}>إرسال</button>
            </div>)}
      </Card>
    </div>
  );
}
