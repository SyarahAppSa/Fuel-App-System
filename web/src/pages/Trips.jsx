import React, { useState } from 'react';
import { Printer, Check, X, UserCheck, Link2, Ban, Camera, MapPin, Truck, AlertTriangle } from 'lucide-react';
import { api, useApi, navigate, liters, sar, dt, ago, fail, toast, query, auth, PRODUCTS, TRIP_TONE, EXC_TYPE } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Alert, Steps } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

const FLOW = [['assigned', 'مسندة'], ['to_loading', 'للتحميل'], ['at_loading', 'عند التحميل'], ['loaded', 'تم التحميل'], ['to_delivery', 'للتسليم'], ['at_site', 'في الموقع'], ['delivered', 'تم التسليم'], ['closed', 'مغلقة']];
const ORDER = ['awaiting_acceptance', 'awaiting_assignment', ...FLOW.map((f) => f[0])];
export const PHOTO = { before_loading: 'قبل التحميل', after_loading: 'بعد التحميل', before_unloading: 'قبل التفريغ', after_unloading: 'بعد التفريغ' };

export function TripList() {
  const me = useMe();
  const q0 = query();
  const [status, setStatus] = useState(q0.status || '');
  const isCarrier = me.company.type === 'carrier';
  const r = useApi('/trips' + (status ? '?status=' + status : ''), [status]);
  const groups = isCarrier
    ? [['', 'الكل'], ['awaiting_acceptance', 'طلبات جديدة'], ['awaiting_assignment', 'بانتظار الإسناد'], ['assigned,to_loading,at_loading,loaded,to_delivery,at_site,on_hold', 'قيد التنفيذ'], ['delivered,under_review,closed', 'منفذة']]
    : [['', 'الكل'], ['awaiting_acceptance,awaiting_assignment', 'بانتظار الناقل'], ['assigned,to_loading,at_loading,loaded,to_delivery,at_site,on_hold', 'قيد التنفيذ'], ['delivered', 'بانتظار تأكيد الاستلام'], ['under_review', 'بانتظار المراجعة'], ['closed', 'مغلقة'], ['cancelled,rejected', 'ملغاة/مرفوضة']];
  return (
    <>
      <Title sub={isCarrier ? 'اقبل الطلبات وأسند المركبة والسائق' : 'كل رحلات النقل وحالتها'}>{isCarrier ? 'الطلبات والرحلات' : me.role === 'site_receiver' ? 'رحلات موقعي' : 'الرحلات'}</Title>
      <div className="tabs">{groups.map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <Card flush>
        {r.loading ? <Spinner /> : !r.data?.length ? <Empty>لا توجد رحلات</Empty> : (
          <div className="tscroll"><table className="t">
            <thead><tr><th>الرحلة</th><th>الحالة</th><th>{isCarrier ? 'العميل' : 'الناقل'}</th><th>المسار</th><th>الكمية</th><th>الموعد</th><th>المركبة / السائق</th>{r.data[0].transport_halalas !== undefined && <th>الأجرة</th>}</tr></thead>
            <tbody>{r.data.map((t) => (
              <tr key={t.id} className="click" onClick={() => navigate('/trips/' + t.id)}>
                <td><b className="num">{t.number}</b><div className="tiny muted">{t.order_number}{t.project_name ? ' · ' + t.project_name : ''}</div></td>
                <td><Chip tone={TRIP_TONE[t.status]}>{t.status_ar}</Chip>{t.status === 'awaiting_acceptance' && t.accept_deadline && <div className="tiny muted">مهلة القبول {ago(t.accept_deadline).replace('قبل', 'منذ')}</div>}</td>
                <td>{isCarrier ? t.client_name : t.carrier_name}</td>
                <td className="small">{t.loading_point_name} ← {t.sites}<div className="tiny muted">{t.modes?.includes('direct') ? 'تزويد مباشر' : 'إلى خزان'}</div></td>
                <td><span className="num">{liters(t.quantity_ml)}</span> لتر<div className="tiny muted">{PRODUCTS[t.product]}</div></td>
                <td className="small">{dt(t.window_start)}</td>
                <td className="small">{t.plate ? <><span>{t.plate}</span><div className="tiny muted">{t.driver_name}</div></> : <span className="muted">—</span>}</td>
                {t.transport_halalas !== undefined && <td className="num">{sar(t.transport_halalas)}</td>}
              </tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </>
  );
}

function AssignModal({ trip, onClose, onDone }) {
  const c = useApi(`/carrier/trips/${trip.id}/candidates`);
  const [v, setV] = useState({ vehicle_id: trip.vehicle_id || '', driver_id: trip.driver_id || '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api(`/carrier/trips/${trip.id}/assign`, { method: 'POST', body: v }); toast('تم الإسناد'); onDone(); } catch (e) { fail(e); } finally { setBusy(false); } };
  return (
    <Modal title={`إسناد ${trip.number}`} onClose={onClose} wide footer={<><button className="btn primary" disabled={busy || !v.vehicle_id || !v.driver_id} onClick={save}>تأكيد الإسناد</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      {c.loading ? <Spinner /> : (
        <div className="grid g2">
          <div><h4 style={{ marginBottom: 8 }}>المركبة</h4><div className="stack" style={{ gap: 6 }}>{c.data.vehicles.map((x) => (
            <label key={x.id} className="acct" style={{ opacity: x.eligible ? 1 : 0.55 }}><input type="radio" disabled={!x.eligible} checked={v.vehicle_id === x.id} onChange={() => setV({ ...v, vehicle_id: x.id })} />
              <div><b>{x.plate}</b> <span className="small muted">{liters(x.capacity_ml)} لتر</span>{!x.eligible && <div className="tiny" style={{ color: 'var(--bad)' }}>{x.reasons.join('، ')}</div>}</div></label>))}</div></div>
          <div><h4 style={{ marginBottom: 8 }}>السائق</h4><div className="stack" style={{ gap: 6 }}>{c.data.drivers.map((x) => (
            <label key={x.id} className="acct" style={{ opacity: x.eligible ? 1 : 0.55 }}><input type="radio" disabled={!x.eligible} checked={v.driver_id === x.id} onChange={() => setV({ ...v, driver_id: x.id })} />
              <div><b>{x.name}</b> <span className="small muted">{x.phone}</span>{!x.eligible && <div className="tiny" style={{ color: 'var(--bad)' }}>{x.reasons.join('، ')}</div>}</div></label>))}</div></div>
        </div>
      )}
      <div className="small muted mt">يتحقق النظام من السعة والمنتج وصلاحية الوثائق والرخصة والتداخل مع رحلات أخرى لحظة التأكيد.</div>
    </Modal>
  );
}

function ConfirmModal({ trip, stop, onClose, onDone }) {
  const [ack, setAck] = useState('confirmed'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api(`/trips/${trip.id}/stops/${stop.id}/confirm`, { method: 'POST', body: { ack, note } }); toast(ack === 'confirmed' ? 'تم تأكيد الاستلام وتسجيله في المخزون' : 'سُجّل الاعتراض وأحيل للمراجعة'); onDone(); } catch (e) { fail(e); } finally { setBusy(false); } };
  return (
    <Modal title={`تأكيد استلام — ${stop.site_name}`} onClose={onClose} footer={<><button className={'btn ' + (ack === 'confirmed' ? 'primary' : 'danger')} disabled={busy} onClick={save}>{ack === 'confirmed' ? 'تأكيد الاستلام' : 'تسجيل الاعتراض'}</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <dl className="kv mb"><dt>المحملة في الرحلة</dt><dd className="num">{liters(trip.loaded_ml)} لتر</dd><dt>المسلّمة حسب السائق</dt><dd className="num">{liters(stop.delivered_ml)} لتر ({stop.measure_method})</dd>
        <dt>الوجهة</dt><dd>{stop.mode === 'tank' ? `خزان ${stop.tank_code}` : 'دفعة تزويد مباشر'}</dd></dl>
      <div className="row mb"><label className="row"><input type="radio" checked={ack === 'confirmed'} onChange={() => setAck('confirmed')} /> الكمية مطابقة</label><label className="row"><input type="radio" checked={ack === 'disputed'} onChange={() => setAck('disputed')} /> يوجد فرق / اعتراض</label></div>
      <Field label={ack === 'disputed' ? 'سبب الاعتراض والكمية المستلمة فعليًا (إلزامي)' : 'ملاحظة (اختياري)'}><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

export function TripDetail({ id }) {
  const me = useMe();
  const r = useApi('/trips/' + id);
  const [modal, setModal] = useState(null);
  const t = r.data;
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!t) return <Spinner />;
  const isCarrier = me.company.type === 'carrier';
  const isClient = me.company.type === 'client';
  const act = async (path, body, msg) => { try { await api(path, { method: 'POST', body }); toast(msg); r.reload(); } catch (e) { fail(e); } };
  const idx = t.status === 'under_review' ? ORDER.indexOf('delivered') + 0.5 : ORDER.indexOf(t.status);
  const done = FLOW.map((f) => f[0]).filter((k) => t.status === 'closed' || ORDER.indexOf(k) < idx);
  const loadPhotos = t.photos.filter((p) => !p.stop_id);
  const photoCard = (kind, stopId) => {
    const p = t.photos.find((x) => x.kind === kind && (stopId ? x.stop_id === stopId : !x.stop_id));
    return (
      <div className="photo" key={kind + (stopId || '')}>
        {p ? <a href={`/api/files/${p.file_id}?token=${auth.token}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p.file_id}?token=${auth.token}`} alt={PHOTO[kind]} loading="lazy" /></a> : <div className="ph"><Camera size={18} /><br />لم تُرفع</div>}
        <div className="cap"><b>{PHOTO[kind]}</b>{p && <div className="tiny muted">التقاط {dt(p.captured_at)} · خادم {dt(p.received_at)}{p.lat ? <><br /><MapPin size={10} /> {p.lat.toFixed(4)}, {p.lng.toFixed(4)}</> : null}</div>}</div>
      </div>
    );
  };
  return (
    <>
      <Title sub={`${t.order_number} · ${isCarrier ? t.client_name : t.carrier_name}`}>رحلة {t.number}</Title>
      <div className="row mb">
        <Chip tone={TRIP_TONE[t.status]}>{t.status_ar}</Chip>
        {t.status === 'awaiting_acceptance' && <span className="small muted">مهلة القبول حتى {dt(t.accept_deadline)}</span>}
        <div className="grow" />
        {isCarrier && t.status === 'awaiting_acceptance' && can(me, 'carrier.dispatch') && <>
          <button className="btn primary" onClick={() => act(`/carrier/trips/${t.id}/accept`, {}, 'تم قبول الرحلة')}><Check size={16} /> قبول</button>
          <button className="btn danger" onClick={() => { const reason = prompt('سبب الرفض'); if (reason) act(`/carrier/trips/${t.id}/reject`, { reason }, 'تم الرفض'); }}><X size={16} /> رفض</button></>}
        {isCarrier && ['awaiting_assignment', 'assigned'].includes(t.status) && <button className="btn primary" onClick={() => setModal({ type: 'assign' })}><UserCheck size={16} /> {t.vehicle_id ? 'إعادة الإسناد' : 'إسناد مركبة وسائق'}</button>}
        {isClient && can(me, 'order.create') && ['awaiting_acceptance', 'awaiting_assignment', 'assigned'].includes(t.status) &&
          <button className="btn danger" onClick={() => { const reason = prompt('سبب الإلغاء'); if (reason) act(`/trips/${t.id}/cancel`, { reason }, 'أُلغيت الرحلة وحُرر الحجز'); }}><Ban size={16} /> إلغاء</button>}
        <a className="btn" href={`/api/trips/${t.id}/report?token=${auth.token}`} target="_blank" rel="noreferrer"><Printer size={16} /> تقرير التوثيق (PDF)</a>
      </div>
      {!['cancelled', 'rejected'].includes(t.status) && <div className="card mb" style={{ padding: '16px 16px 10px' }}><Steps steps={FLOW.map(([key, label]) => ({ key, label }))} current={t.status} done={done} /></div>}
      {t.status === 'under_review' && <Alert tone="bad">الرحلة بانتظار المراجعة: {t.exceptions.filter((e) => e.status === 'open').map((e) => e.title).join('، ')} — <a href="/approvals" onClick={(e) => { e.preventDefault(); navigate('/approvals'); }} style={{ textDecoration: 'underline' }}>الموافقات</a></Alert>}
      {t.missing_proofs.length > 0 && ['delivered', 'under_review', 'closed'].includes(t.status) && <Alert tone="warn">إثباتات ناقصة: {t.missing_proofs.map((m) => PHOTO[m.kind] + (m.seq ? ` (نقطة ${m.seq})` : '')).join('، ')}</Alert>}

      <div className="grid g-main mt">
        <div className="stack">
          <Card title="الكميات والتنفيذ">
            <div className="grid g3">
              <dl className="kv"><dt>المنتج</dt><dd>{PRODUCTS[t.product]}</dd><dt>المطلوبة</dt><dd className="num">{liters(t.quantity_ml)} لتر</dd><dt>المحملة</dt><dd><span className="num">{liters(t.loaded_ml)}</span> {t.load_measure_method && <span className="tiny muted">({t.load_measure_method})</span>}</dd></dl>
              <dl className="kv"><dt>التحميل</dt><dd>{t.loading_point_name}</dd><dt>النافذة</dt><dd className="small">{dt(t.window_start)} – {dt(t.window_end, { day: undefined, month: undefined })}</dd><dt>المستند</dt><dd>{t.doc_number ? (t.doc_file_id ? <a href={`/api/files/${t.doc_file_id}?token=${auth.token}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand-2)' }} className="num">{t.doc_number}</a> : <span className="num">{t.doc_number}</span>) : <span className="muted small">يظهر بعد القبول</span>}</dd></dl>
              <dl className="kv"><dt>الناقل</dt><dd>{t.carrier_name}</dd><dt>المركبة</dt><dd>{t.plate || '—'}</dd><dt>السائق</dt><dd>{t.driver_name || '—'} <span className="tiny muted">{t.driver_phone}</span></dd></dl>
            </div>
          </Card>
          <Card title="صور التحميل" icon={<Camera size={17} />}><div className="photos" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>{photoCard('before_loading')}{photoCard('after_loading')}</div></Card>
          {t.stops.map((s) => (
            <Card key={s.id} title={`نقطة التسليم ${s.seq}: ${s.site_name}`} icon={<MapPin size={17} />}
              actions={<>
                <Chip tone={s.mode === 'direct' ? 'brand' : 'info'}>{s.mode === 'direct' ? 'تزويد مباشر' : `خزان ${s.tank_code || ''}`}</Chip>
                <Chip tone={{ confirmed: 'good', disputed: 'bad', delivered: 'warn' }[s.status]}>{{ pending: 'لم يصل', arrived: 'وصل', delivered: 'بانتظار التأكيد', confirmed: 'مؤكد', disputed: 'معترض' }[s.status]}</Chip>
              </>}>
              <div className="grid g2 mb">
                <dl className="kv"><dt>المطلوبة</dt><dd className="num">{liters(s.requested_ml)} لتر</dd><dt>المسلّمة</dt><dd><span className="num">{liters(s.delivered_ml)}</span> {s.measure_method && <span className="tiny muted">({s.measure_method})</span>}</dd>{s.returned_ml ? <><dt>المرتجعة</dt><dd className="num">{liters(s.returned_ml)}</dd></> : null}</dl>
                <dl className="kv"><dt>المستلم</dt><dd>{s.receiver_name || <span className="muted small">يظهر بعد القبول</span>} <span className="tiny muted">{s.receiver_phone}</span></dd>
                  {s.access_notes && <><dt>الدخول</dt><dd className="small">{s.access_notes}</dd></>}
                  {s.receiver_ack && <><dt>التأكيد</dt><dd className="small">{s.receiver_ack === 'confirmed' ? 'مؤكد' : 'معترض'} — {s.receiver_ack_by} · {dt(s.receiver_ack_at)}{s.receiver_note && <div className="muted">{s.receiver_note}</div>}</dd></>}</dl>
              </div>
              <div className="photos" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>{photoCard('before_unloading', s.id)}{photoCard('after_unloading', s.id)}</div>
              {isClient && s.status === 'delivered' && can(me, 'receipt.confirm') && <div className="row mt"><button className="btn primary" onClick={() => setModal({ type: 'confirm', stop: s })}><Check size={16} /> تأكيد الاستلام أو تسجيل فرق</button></div>}
              {isClient && s.receipt_token && ['pending', 'arrived', 'delivered'].includes(s.status) && can(me, 'order.create') && (
                <div className="row mt small"><Link2 size={14} /> رابط محدود لمستلم الموقع:
                  <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(location.origin + '/r/' + s.receipt_token); toast('نُسخ الرابط'); }}>نسخ</button>
                  <a className="btn sm ghost" href={'/r/' + s.receipt_token} target="_blank" rel="noreferrer">فتح</a></div>)}
            </Card>
          ))}
        </div>
        <div className="stack">
          {t.price && (
            <Card title="السعر المتفق عليه">
              <dl className="kv"><dt>أجرة النقل</dt><dd className="num">{sar(t.price.base_halalas)} ر.س</dd><dt>رسوم خدمة فيول آب</dt><dd className="num">{sar(t.price.platform_fee_halalas)}</dd>
                <dt>ض.ق.م</dt><dd className="num">{sar(t.price.vat_halalas)}</dd><dt>الإجمالي</dt><dd className="num" style={{ fontSize: 17 }}>{sar(t.price.total_halalas)} ر.س</dd>
                <dt>الإلغاء</dt><dd className="small">{sar(t.price.terms.cancel_fee_halalas)} ر.س بعد القبول</dd><dt>الانتظار</dt><dd className="small">{sar(t.price.terms.waiting_fee_halalas_per_hour)}/ساعة بعد {t.price.terms.free_waiting_hours} س</dd>
                {t.fuel_price_halalas_per_l != null && <><dt>سعر لتر الوقود</dt><dd className="num">{sar(t.fuel_price_halalas_per_l)}</dd></>}</dl>
              <div className="tiny muted mt">نسخة محفوظة في {dt(t.price.snapshot_at)}</div>
            </Card>
          )}
          {t.exceptions.length > 0 && <Card title="الاستثناءات" icon={<AlertTriangle size={16} color="var(--warn)" />}>{t.exceptions.map((e) => <div key={e.id} className="small" style={{ marginBottom: 8 }}><Chip tone={e.status === 'open' ? 'bad' : e.status === 'approved' ? 'good' : ''}>{EXC_TYPE[e.type]}</Chip> {e.title}{e.decision_reason && <div className="muted">القرار: {e.decision_reason}</div>}</div>)}</Card>}
          <Card title="السجل الزمني">
            <ul className="tl">{t.events.map((e) => (
              <li key={e.id} className="done"><div className="small" style={{ fontWeight: 600 }}>{e.to_status ? ({ awaiting_acceptance: 'إنشاء الطلب', awaiting_assignment: 'قبول الناقل' }[e.to_status] || FLOW.find((f) => f[0] === e.to_status)?.[1] || { under_review: 'بانتظار المراجعة', cancelled: 'إلغاء', rejected: 'رفض', on_hold: 'توقف' }[e.to_status] || e.to_status) : { photo: 'صورة: ' + (PHOTO[e.note] || ''), stop_delivered: 'تسليم ' + (e.note || ''), receiver_confirmed: 'تأكيد المستلم', receiver_disputed: 'اعتراض المستلم' }[e.type] || e.type}</div>
                <div className="tiny muted">{dt(e.captured_at)} · {e.actor_name || (e.actor_role === 'site_receiver_link' ? 'رابط المستلم' : 'النظام')}{e.type !== 'photo' && e.note ? ' · ' + e.note : ''}</div></li>
            ))}</ul>
          </Card>
          <Card title="سجل الإسناد">{t.history.map((h) => <div key={h.id} className="small" style={{ marginBottom: 6 }}><Truck size={13} /> {{ offered: 'عُرض على', accepted: 'قبل', rejected: 'رفض', assigned: 'أُسند', reassigned: 'أعيد الإسناد', released: 'حُرر الحجز' }[h.action]} {h.carrier_name} {h.plate && `· ${h.plate} · ${h.driver_name}`}{h.reason && ` — ${h.reason}`}<div className="tiny muted">{dt(h.at)} {h.by_name && '· ' + h.by_name}</div></div>)}</Card>
        </div>
      </div>
      {modal?.type === 'assign' && <AssignModal trip={t} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
      {modal?.type === 'confirm' && <ConfirmModal trip={t} stop={modal.stop} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
    </>
  );
}
