import React, { useState } from 'react';
import { Camera, Navigation, CheckCircle2, PauseCircle, PlayCircle, Phone, MapPin, ChevronLeft, ImageUp } from 'lucide-react';
import { api, useApi, navigate, liters, dt, ago, fail, toast, opId, getPosition, PRODUCTS, TRIP_TONE } from '../lib.js';
import { Card, Chip, Spinner, Empty, Field, Alert } from '../ui.jsx';
import { Title, useMe } from '../ctx.jsx';
import * as outbox from '../outbox.js';
import { SyncBar } from './Fueling.jsx';
import { PHOTO, SiteAccess } from './Trips.jsx';
const EV_AR = { awaiting_acceptance: 'إنشاء الطلب', awaiting_assignment: 'قبول الناقل', assigned: 'إسناد المهمة', delivered: 'تم التسليم', closed: 'إغلاق', under_review: 'بانتظار المراجعة', stop_delivered: 'تسليم', receiver_confirmed: 'تأكيد المستلم', receiver_disputed: 'اعتراض المستلم' };

export function DriverHome() {
  const r = useApi('/trips');
  const active = (r.data || []).filter((t) => !['closed', 'cancelled', 'rejected', 'delivered', 'under_review'].includes(t.status));
  const done = (r.data || []).filter((t) => ['closed', 'delivered', 'under_review'].includes(t.status));
  return (
    <div className="field-app">
      <Title>رحلاتي</Title>
      <div className="stack">
        <SyncBar scope="driver" />
        {r.loading ? <Spinner /> : !active.length ? <Empty>لا توجد رحلات مسندة حاليًا</Empty> : active.map((t) => (
          <div key={t.id} className="bigstep" style={{ cursor: 'pointer' }} onClick={() => navigate('/trips/' + t.id)}>
            <div className="row"><b className="num" style={{ fontSize: 18 }}>{t.number}</b><span className="grow" /><Chip tone={TRIP_TONE[t.status]}>{t.status_ar}</Chip></div>
            <div style={{ margin: '10px 0 4px', fontSize: 15 }}>{t.loading_point_name} ← {t.sites}</div>
            <div className="small" style={{ color: '#b5c5d3' }}>{liters(t.quantity_ml)} لتر {PRODUCTS[t.product]} · {t.plate} · {dt(t.window_start)}</div>
            <div className="row" style={{ marginTop: 10, color: 'var(--brand)' }}>فتح المهمة <ChevronLeft size={16} /></div>
          </div>))}
        {done.length > 0 && <Card title="منفذة مؤخرًا" flush><table className="t"><tbody>{done.slice(0, 8).map((t) => <tr key={t.id} className="click" onClick={() => navigate('/trips/' + t.id)}><td className="num">{t.number}</td><td className="small">{t.sites}</td><td><Chip tone={TRIP_TONE[t.status]}>{t.status_ar}</Chip></td></tr>)}</tbody></table></Card>}
      </div>
    </div>
  );
}

const NEXT = {
  assigned: { to: 'to_loading', label: 'بدء التوجه لنقطة التحميل' },
  to_loading: { to: 'at_loading', label: 'وصلت نقطة التحميل' },
  loaded: { to: 'to_delivery', label: 'انطلقت للتسليم' },
  to_delivery: { to: 'at_site', label: 'وصلت موقع التسليم' },
};
const NEXT_STATUS_AR = { to_loading: 'في الطريق للتحميل', at_loading: 'وصل لنقطة التحميل', loaded: 'تم التحميل', to_delivery: 'في الطريق للتسليم', at_site: 'وصل للموقع', on_hold: 'متوقفة' };

export function DriverTrip({ id }) {
  const me = useMe();
  const r = useApi('/trips/' + id);
  const [local, setLocal] = useState(null); // حالة متفائلة عند العمل دون اتصال
  const [localPhotos, setLocalPhotos] = useState([]);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!r.data) return <Spinner />;
  const t = r.data;
  const status = local || t.status;
  const stop = t.stops.find((s) => s.status === 'arrived') || (status === 'at_site' ? t.stops.find((s) => s.status === 'pending') : null);
  const nextStop = t.stops.find((s) => s.status === 'pending');
  const hasPhoto = (kind, stopId) => t.photos.some((p) => p.kind === kind && (stopId ? p.stop_id === stopId : !p.stop_id)) || localPhotos.some((p) => p.kind === kind && (p.stop_id || null) === (stopId || null));

  async function send(url, json, label, optimistic) {
    setBusy(true);
    const pos = await getPosition();
    const id = opId();
    await outbox.enqueue({ id, scope: 'driver', label: `${t.number}: ${label}`, url, json: { ...json, ...pos, client_op_id: id, captured_at: new Date().toISOString() } });
    const it = outbox.items().find((x) => x.id === id);
    if (it?.status === 'sent') { toast('تم: ' + label); setLocal(null); r.reload(); }
    else if (it?.status === 'failed') { fail(it.error); outbox.discard(id); }
    else { toast('محفوظ محليًا وسيُرفع عند عودة الاتصال'); if (optimistic) setLocal(optimistic); }
    setBusy(false);
  }
  async function photo(kind, stopId, file) {
    if (!file) return;
    const pos = await getPosition(); const id = opId();
    await outbox.enqueue({ id, scope: 'driver', label: `${t.number}: صورة ${PHOTO[kind]}`, url: `/driver/trips/${t.id}/photos`, fields: { kind, stop_id: stopId, client_op_id: id, captured_at: new Date().toISOString(), lat: pos.lat, lng: pos.lng }, file: { field: 'photo', blob: file, name: file.name || kind + '.jpg' } });
    setLocalPhotos((p) => [...p, { kind, stop_id: stopId || null }]);
    const it = outbox.items().find((x) => x.id === id);
    if (it?.status === 'sent') { toast('رُفعت الصورة'); r.reload(); } else if (it?.status === 'failed') fail(it.error); else toast('الصورة محفوظة محليًا بانتظار الرفع');
  }
  const PhotoBtn = ({ kind, stopId }) => (
    <label className={'btn ' + (hasPhoto(kind, stopId) ? '' : 'primary')} style={{ flex: 1 }}>
      {hasPhoto(kind, stopId) ? <CheckCircle2 size={16} color="var(--good)" /> : <Camera size={16} />} {PHOTO[kind]}
      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => photo(kind, stopId, e.target.files[0])} />
    </label>
  );
  const step = NEXT[status];
  return (
    <div className="field-app">
      <Title sub={`آخر تحديث ${ago(new Date().toISOString())}`}>مهمة {t.number}</Title>
      <div className="stack">
        <SyncBar scope="driver" />
        <div className="bigstep">
          <div className="row"><Chip tone={TRIP_TONE[status]}>{NEXT_STATUS_AR[status] || t.status_ar}</Chip>{local && <Chip tone="warn">غير مرفوع بعد</Chip>}<span className="grow" /><span className="small">{t.plate}</span></div>
          <div style={{ fontSize: 20, fontWeight: 700, margin: '10px 0 4px' }}><span className="num">{liters(t.quantity_ml)}</span> لتر {PRODUCTS[t.product]}</div>
          <div className="small" style={{ color: '#b5c5d3' }}>النافذة {dt(t.window_start)} – {dt(t.window_end, { day: undefined, month: undefined })} · مستند {t.doc_number}</div>
        </div>

        {['assigned', 'to_loading', 'at_loading'].includes(status) && (
          <Card title={`التحميل: ${t.loading_point_name}`} actions={<a className="btn sm" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.loading_point_name + ' ' + t.loading_city)}`}><Navigation size={14} /> ملاحة</a>}>
            {status === 'at_loading' ? (
              <div className="stack">
                <div className="row"><PhotoBtn kind="before_loading" /></div>
                <Field label="الكمية المحملة فعليًا (لتر) — من عداد محطة التحميل"><input type="number" inputMode="decimal" className="input" style={{ fontSize: 22 }} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
                {!hasPhoto('before_loading') && <Alert tone="warn">التقط صورة «قبل التحميل» أولًا — الصور الناقصة تظهر للعميل كاستثناء.</Alert>}
                <button className="btn primary lg block" disabled={busy || !qty} onClick={() => send(`/driver/trips/${t.id}/advance`, { to: 'loaded', loaded_liters: qty, measure_method: 'عداد محطة التحميل' }, 'تم التحميل', 'loaded').then(() => setQty(''))}><CheckCircle2 size={20} /> تم التحميل</button>
              </div>
            ) : <div className="small muted">اتجه لنقطة التحميل وقدّم المستند المرفق بالمهمة.</div>}
          </Card>
        )}
        {status === 'loaded' && <Card title="بعد التحميل"><div className="row"><PhotoBtn kind="after_loading" /></div></Card>}

        {t.stops.map((s) => (
          <Card key={s.id} title={`التسليم ${s.seq}: ${s.site_name}`} icon={<MapPin size={16} />} actions={s.lat && <a className="btn sm" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}><Navigation size={14} /> ملاحة</a>}>
            <SiteAccess s={s} />
            <dl className="kv"><dt>الكمية</dt><dd className="num">{liters(s.requested_ml)} لتر · {s.mode === 'direct' ? 'تزويد مباشر للمعدات' : 'تفريغ في خزان'}</dd>
              <dt>المستلم</dt><dd>{s.receiver_name} {s.receiver_phone && <a href={'tel:' + s.receiver_phone} className="chip info"><Phone size={12} /> اتصال</a>}</dd>
              <dt>الحالة</dt><dd><Chip tone={{ delivered: 'brand', confirmed: 'good', disputed: 'bad' }[s.status]}>{{ pending: 'لم يصل', arrived: 'في الموقع', delivered: 'سُلّم — بانتظار المستلم', confirmed: 'أكد المستلم', disputed: 'اعتراض' }[s.status]}</Chip></dd></dl>
            {(s.status !== 'pending' || (status === 'at_site' && stop?.id === s.id)) && (
              <div className="stack mt">
                <div className="row"><PhotoBtn kind="before_unloading" stopId={s.id} /><PhotoBtn kind="after_unloading" stopId={s.id} /></div>
                {(s.status === 'arrived' || (local === 'at_site' && stop?.id === s.id)) && (<>
                  {s.mode === 'direct' && <Alert tone="info">التزويد المباشر: مشرف الموقع يسجل كل تعبئة بشريحة المعدة. أدخل هنا إجمالي ما صُرف للموقع من عداد الصهريج.</Alert>}
                  <Field label="الكمية المسلّمة (لتر) — عداد الصهريج"><input type="number" inputMode="decimal" className="input" style={{ fontSize: 22 }} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
                  <button className="btn primary lg block" disabled={busy || !qty} onClick={() => send(`/driver/trips/${t.id}/stops/${s.id}/deliver`, { delivered_liters: qty, measure_method: 'عداد الصهريج' }, 'تم التسليم', nextStop && nextStop.id !== s.id ? 'to_delivery' : 'delivered').then(() => setQty(''))}><CheckCircle2 size={20} /> تم التسليم</button>
                </>)}
              </div>
            )}
          </Card>
        ))}

        {step && <button className="btn primary lg block" disabled={busy} onClick={() => send(`/driver/trips/${t.id}/advance`, { to: step.to }, step.label, step.to)}><Navigation size={20} /> {step.label}</button>}
        {['assigned', 'to_loading', 'at_loading', 'loaded', 'to_delivery', 'at_site'].includes(status) && <button className="btn block" onClick={() => { const note = prompt('سبب التوقف'); if (note) send(`/driver/trips/${t.id}/advance`, { to: 'on_hold', note }, 'توقف', 'on_hold'); }}><PauseCircle size={16} /> إيقاف مؤقت / تأجيل</button>}
        {status === 'on_hold' && <button className="btn primary lg block" onClick={() => send(`/driver/trips/${t.id}/advance`, { to: 'resume' }, 'استئناف')}><PlayCircle size={18} /> استئناف الرحلة</button>}
        {['delivered', 'under_review', 'closed'].includes(status) && <Alert tone="good">اكتملت المهمة. {t.missing_proofs.length ? `ينقص ${t.missing_proofs.length} صورة — أضفها من بطاقات التسليم.` : 'الإثباتات مكتملة.'}</Alert>}
        <Card title="آخر الأحداث"><ul className="tl">{t.events.slice(-6).reverse().map((e) => <li key={e.id} className="done"><div className="small">{e.to_status ? (NEXT_STATUS_AR[e.to_status] || EV_AR[e.to_status] || e.to_status) : e.type === 'photo' ? 'صورة ' + (PHOTO[e.note] || '') : (EV_AR[e.type] || e.type)}</div><div className="tiny muted">{dt(e.captured_at)} · استلام الخادم {dt(e.received_at)}</div></li>)}</ul></Card>
      </div>
    </div>
  );
}
