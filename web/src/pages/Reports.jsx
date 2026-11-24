import React, { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useApi, navigate, liters, dt, query, auth, TRIP_TONE, TAG_TONE } from '../lib.js';
import { Card, Chip, Spinner, Empty } from '../ui.jsx';
import { Title } from '../ctx.jsx';

export default function Reports() {
  const [tab, setTab] = useState(query().tab || 'cycle');
  return (
    <>
      <Title sub="كل رقم قابل للتتبع إلى سجلاته">التقارير</Title>
      <div className="tabs">{[['cycle', 'مطابقة دورة الوقود'], ['fuel', 'سجل التزويد وNFC'], ['tags', 'رقابة الشرائح'], ['docs', 'مستندات أرامكو']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'cycle' && <Cycle />}
      {tab === 'fuel' && <Card title="سجل التزويد" actions={<><a className="btn sm" href={`/api/reports/fuelings.csv?token=${auth.token}`}><Download size={14} /> Excel/CSV</a><button className="btn sm" onClick={() => navigate('/fuel/log')}>عرض تفاعلي</button></>}>
        <div className="small muted">يشمل: رقم العملية والوقت والموقع والمشروع، الأصل ورقمه، الشريحة وطريقة التحقق، نوع الوقود واللترات والتكلفة، قراءة العداد ومصدرها، المشغل ومصدر الوقود والرحلة أو الخزان، حالة الاعتماد والاستثناء. التكلفة تُستبعد تلقائيًا لمن لا يملك صلاحية الأسعار.</div></Card>}
      {tab === 'tags' && <Tags />}
      {tab === 'docs' && <Docs />}
    </>
  );
}

function Cycle() {
  const r = useApi('/reports/cycle');
  if (!r.data) return <Spinner />;
  return (
    <Card title="مطابقة دورة الوقود لكل رحلة" actions={<button className="btn sm" onClick={() => print()}><Printer size={14} /> طباعة</button>} flush>
      <div className="tscroll"><table className="t">
        <thead><tr><th>الرحلة</th><th>المستند</th><th>الحالة</th><th>المطلوبة</th><th>المحجوزة</th><th>المحملة</th><th>المسلّمة</th><th>المخزنة</th><th>المصروفة مباشرة</th><th>المتبقية مباشرة</th><th>المرتجعة</th></tr></thead>
        <tbody>{r.data.map((t) => (
          <tr key={t.id} className="click" onClick={() => navigate('/trips/' + t.id)}>
            <td className="num"><b>{t.number}</b><div className="tiny muted">{t.order_number}</div></td><td className="num small">{t.doc_number}</td><td><Chip tone={TRIP_TONE[t.status]}>{t.status_ar}</Chip></td>
            {['requested_ml', 'reserved_ml', 'loaded_ml', 'delivered_ml', 'stored_ml', 'issued_direct_ml', 'remaining_direct_ml', 'returned_ml'].map((k) => <td key={k} className="num">{t[k] ? liters(t[k]) : '—'}</td>)}
          </tr>))}</tbody></table></div>
    </Card>
  );
}
function Tags() {
  const r = useApi('/nfc-tags');
  if (!r.data) return <Spinner />;
  const st = { in_custody: 'في العهدة', pending_activation: 'بانتظار التفعيل', active: 'نشطة', suspended: 'موقوفة', lost: 'مفقودة', damaged: 'تالفة', replaced: 'مستبدلة' };
  return (
    <div className="grid g2">
      <Card title="حالة الشرائح"><div className="row">{Object.entries(r.data.counts).map(([k, v]) => <Chip key={k} tone={TAG_TONE[k]}>{st[k]} <b className="num">{v}</b></Chip>)}</div></Card>
      <Card title="المحاولات المرفوضة والعمليات البديلة"><div className="small">مرفوضة: <b>{r.data.rejected.length}</b> · تحقق بديل: <b>{r.data.alt_verifications.length}</b></div>
        <button className="btn sm mt" onClick={() => navigate('/nfc')}>التفاصيل</button></Card>
    </div>
  );
}
function Docs() {
  const r = useApi('/documents');
  if (!r.data) return <Spinner />;
  return <Card flush>{!r.data.length ? <Empty /> : <table className="t"><thead><tr><th>الرقم</th><th>المصرح</th><th>المحجوز</th><th>المحمل</th><th>المسلّم</th><th>الملغى</th><th>المتاح</th></tr></thead>
    <tbody>{r.data.filter((d) => d.quantities).map((d) => <tr key={d.id}><td className="num">{d.doc_number}</td>{['authorized_ml', 'reserved_ml', 'loaded_ml', 'delivered_ml', 'cancelled_ml', 'available_ml'].map((k) => <td key={k} className="num">{liters(d.quantities[k])}</td>)}</tr>)}</tbody></table>}</Card>;
}
