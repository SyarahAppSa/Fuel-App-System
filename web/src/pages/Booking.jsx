import React, { useState } from 'react';
import { Star, Columns3, Truck, MapPin, Clock, Gauge, Fuel, Phone, Navigation, Printer, ArrowUp, ArrowDown, X, Plus, ShieldCheck, Camera, CheckCircle2, AlertTriangle, Container, Pencil } from 'lucide-react';
import { api, useApi, navigate, liters, sar, n, dt, dOnly, fail, toast, query, PRODUCTS, TRIP_TONE } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Alert, Meter, Kpi } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';
import { Logo } from './NewOrder.jsx';

export const Stars = ({ v, count, size = 14 }) => (
  <span className="row" style={{ gap: 3, display: 'inline-flex' }} title={v == null ? 'لا توجد تقييمات' : `${v} من 5`}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} fill={v != null && v >= i - 0.25 ? '#e0a92a' : 'none'} color={v != null && v >= i - 0.25 ? '#c28a12' : 'var(--line-2)'} />)}
    <span className="small" style={{ fontWeight: 700 }}>{v == null ? '—' : v}</span>{count != null && <span className="tiny muted">({count} تقييم)</span>}
  </span>
);
const feeText = (f) => (!f ? 'غير معلنة' : `انتظار ${sar(f.waiting_min)}${f.waiting_max !== f.waiting_min ? '–' + sar(f.waiting_max) : ''} ر.س/س بعد ${f.free_hours} س · إلغاء ${sar(f.cancel_min)}${f.cancel_max !== f.cancel_min ? '–' + sar(f.cancel_max) : ''} ر.س`);

/* ------------------------------------------------------------------ */
/* دليل الناقلين                                                        */
/* ------------------------------------------------------------------ */
export function Carriers() {
  const lk = useApi('/lookups').data;
  const org = useApi('/org').data;
  const [f, setF] = useState({ q: '', loading_point_id: '', city: '', product: '', favorites: '', project_id: query().project || '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const r = useApi('/carriers?' + qs, [qs]);
  const [cmp, setCmp] = useState([]);
  const [show, setShow] = useState(false);
  const fav = async (c) => { try { await api('/favorites/' + c.id, { method: c.favorite ? 'DELETE' : 'POST' }); r.reload(); } catch (e) { fail(e); } };
  const toggle = (id) => setCmp(cmp.includes(id) ? cmp.filter((x) => x !== id) : cmp.length >= 3 ? (toast('المقارنة حتى ثلاثة ناقلين'), cmp) : [...cmp, id]);
  const sel = (r.data || []).filter((c) => cmp.includes(c.id));
  return (
    <>
      <Title sub="كل ناقل معتمد على فيول آب: مناطقه، وقوده، صهاريجه، أداؤه وتقييماته">دليل الناقلين</Title>
      <div className="filters">
        <input className="input" placeholder="ابحث باسم الناقل" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className="input" value={f.loading_point_id} onChange={(e) => setF({ ...f, loading_point_id: e.target.value })}><option value="">كل نقاط التحميل</option>{lk?.loading_points.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}><option value="">كل مدن التسليم</option>{lk?.cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="input" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}><option value="">كل أنواع الوقود</option>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })} title="رتّب حسب مفضلي المشروع"><option value="">ترتيب الشركة</option>{org?.projects.map((p) => <option key={p.id} value={p.id}>مفضلو {p.code}</option>)}</select>
        <button className={'btn ' + (f.favorites ? 'primary' : '')} onClick={() => setF({ ...f, favorites: f.favorites ? '' : '1' })}><Star size={15} /> المفضلون</button>
        <div className="grow" />
        <button className="btn primary" disabled={cmp.length < 2} onClick={() => setShow(true)}><Columns3 size={15} /> قارن ({cmp.length}/3)</button>
      </div>
      {!r.data ? <Spinner /> : !r.data.length ? <Empty>لا يوجد ناقل يطابق البحث</Empty> : (
        <div className="grid g2">{r.data.map((c) => (
          <div key={c.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderColor: cmp.includes(c.id) ? 'var(--brand)' : undefined }}>
            <div className="row" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => navigate('/carriers/' + c.id)}>
              <Logo name={c.name} url={c.logo_url} />
              <div className="grow"><b style={{ fontSize: 16 }}>{c.name}</b>{c.project_priority && <Chip tone="good">مفضل #{c.project_priority} للمشروع</Chip>}<div><Stars v={c.rating.overall} count={c.rating.count} /></div></div>
              <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); fav(c); }} aria-label="مفضل"><Star size={20} fill={c.favorite ? '#e0a92a' : 'none'} color={c.favorite ? '#c28a12' : 'var(--muted)'} /></button>
            </div>
            <div className="row" style={{ gap: 4 }}>{c.loading.map((l) => <Chip key={l.id} tone="info">تحميل: {l.label}</Chip>)}{c.delivery.map((x) => <Chip key={x} tone="brand">تسليم: {x}</Chip>)}</div>
            <div className="small"><Fuel size={13} /> {c.products.map((p) => p.label).join('، ') || '—'} · <Truck size={13} /> صهاريج {c.capacities_l.map((x) => n(x)).join(' / ') || '—'} لتر ({c.active_vehicles})</div>
            <div className="small"><Gauge size={13} /> {c.trips_done} رحلة منفذة عبر فيول آب · {c.on_time_pct == null ? 'لا توجد عينة التزام' : `${c.on_time_pct}% في الموعد (من ${c.sample})`}{c.avg_response_min != null && ` · يرد خلال ${c.avg_response_min} د`}</div>
            <div className="tiny muted">{feeText(c.fees)}</div>
            <div className="row"><label className="row small" style={{ cursor: 'pointer' }}><input type="checkbox" checked={cmp.includes(c.id)} onChange={() => toggle(c.id)} /> قارن</label><div className="grow" />
              <button className="btn sm" onClick={() => navigate('/carriers/' + c.id)}>الملف</button><button className="btn sm primary" onClick={() => navigate('/orders/new?carrier=' + c.id)}>اطلب نقلًا</button></div>
          </div>))}</div>)}
      {show && <Modal title="مقارنة الناقلين" wide onClose={() => setShow(false)}>
        <div className="tscroll"><table className="t"><thead><tr><th></th>{sel.map((c) => <th key={c.id}><div className="row"><Logo name={c.name} url={c.logo_url} size={30} />{c.name}</div></th>)}</tr></thead>
          <tbody>{[['التقييم', (c) => <Stars v={c.rating.overall} count={c.rating.count} />], ['الالتزام بالموعد', (c) => (c.on_time_pct == null ? 'لا توجد عينة' : `${c.on_time_pct}% (${c.sample} رحلة)`)], ['رحلات منفذة', (c) => c.trips_done],
            ['متوسط زمن الرد', (c) => (c.avg_response_min == null ? '—' : `${c.avg_response_min} دقيقة`)], ['رسوم الانتظار', (c) => (c.fees ? `${sar(c.fees.waiting_min)} ر.س/س بعد ${c.fees.free_hours} س مجانية` : '—')],
            ['سياسة الإلغاء', (c) => (c.fees ? `${sar(c.fees.cancel_min)} ر.س بعد قبول الناقل، مجاني قبله` : '—')], ['التحميل', (c) => c.loading.map((l) => l.label).join('، ')], ['التسليم', (c) => c.delivery.join('، ')],
            ['الوقود', (c) => c.products.map((p) => p.label).join('، ')], ['الصهاريج', (c) => `${c.capacities_l.map((x) => n(x)).join(' / ')} لتر`]].map(([l, fn]) => <tr key={l}><td className="muted small">{l}</td>{sel.map((c) => <td key={c.id}>{fn(c)}</td>)}</tr>)}</tbody></table></div>
        <div className="small muted mt">للسعر الإجمالي وأقرب موعد لطلب محدد: «اطلب نقلًا» ثم قارن في خطوة «اختر شركة النقل».</div>
      </Modal>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* ملف الناقل                                                           */
/* ------------------------------------------------------------------ */
export function CarrierProfile({ id }) {
  const me = useMe();
  const r = useApi('/carriers/' + id);
  const org = useApi('/org').data;
  const [pid, setPid] = useState('');
  const c = r.data;
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!c) return <Spinner />;
  const fav = async () => { try { await api('/favorites/' + c.id, { method: c.favorite ? 'DELETE' : 'POST' }); r.reload(); } catch (e) { fail(e); } };
  const addToProject = async () => {
    if (!pid) return; try { const p = await api('/projects/' + pid); const ids = p.preferred.map((x) => x.carrier_id).filter((x) => x !== c.id);
      await api(`/projects/${pid}/preferred-carriers`, { method: 'PUT', body: { carrier_ids: [...ids, c.id] } }); toast('أُضيف لمفضلي المشروع'); r.reload(); } catch (e) { fail(e); } };
  return (
    <>
      <Title sub={`${c.city} · س.ت ${c.cr_number || '—'}`}>{c.name}</Title>
      <div className="card mb" style={{ padding: 18 }}><div className="row" style={{ gap: 16 }}>
        <Logo name={c.name} url={c.logo_url} size={72} />
        <div className="grow"><h2 style={{ fontSize: 22 }}>{c.name}</h2><Stars v={c.rating.overall} count={c.rating.count} size={16} />
          <div className="row mt" style={{ gap: 4 }}>{c.documents.map((d) => <Chip key={d.doc_type} tone="good"><ShieldCheck size={12} /> {{ cr: 'سجل تجاري', transport_license: 'ترخيص نقل', insurance: 'تأمين', vat: 'ضريبة' }[d.doc_type] || d.doc_type} ساري</Chip>)}</div></div>
        <div className="stack" style={{ gap: 6 }}>
          <button className="btn primary" onClick={() => navigate('/orders/new?carrier=' + c.id)}><Truck size={16} /> اطلب نقلًا من {c.name.replace(/\s*\(.*\)/, '')}</button>
          <button className="btn" onClick={fav}><Star size={16} fill={c.favorite ? '#e0a92a' : 'none'} color={c.favorite ? '#c28a12' : undefined} /> {c.favorite ? 'من المفضلين' : 'أضف للمفضلين'}</button>
        </div></div></div>
      <div className="grid g4">
        <Kpi icon={Truck} label="رحلات منفذة عبر فيول آب" value={c.trips_done} />
        <Kpi icon={Clock} label="الالتزام بالموعد" value={c.on_time_pct == null ? 'بيانات غير كافية' : c.on_time_pct + '%'} foot={`من ${c.sample} رحلة ذات نافذة`} />
        <Kpi icon={Gauge} label="متوسط زمن الرد" value={c.avg_response_min == null ? '—' : c.avg_response_min} unit={c.avg_response_min == null ? '' : 'دقيقة'} foot={`من ${c.response_sample} رد`} />
        <Kpi icon={Container} label="الأسطول" value={c.active_vehicles} unit="صهريج" foot={`${c.drivers} سائق نشط`} />
      </div>
      <div className="grid g2 mt">
        <Card title="المناطق والوقود والصهاريج">
          <div className="small muted">نقاط التحميل</div><div className="row mb" style={{ gap: 4 }}>{c.loading.map((l) => <Chip key={l.id} tone="info">{l.label}</Chip>)}</div>
          <div className="small muted">مدن التسليم</div><div className="row mb" style={{ gap: 4 }}>{c.delivery.map((x) => <Chip key={x} tone="brand">{x}</Chip>)}</div>
          <div className="small muted">أنواع الوقود</div><div className="row mb" style={{ gap: 4 }}>{c.products.map((p) => <Chip key={p.key}>{p.label}</Chip>)}</div>
          <div className="small muted">سعات الصهاريج</div><div className="row" style={{ gap: 4 }}>{c.fleet.map((v, i) => <Chip key={i} tone={v.status === 'active' ? '' : 'warn'}>{n(v.capacity_l)} لتر{v.status !== 'active' ? ' · صيانة' : ''}</Chip>)}</div>
        </Card>
        <Card title="التقييمات بعد رحلات موثقة">
          {c.rating.count ? <>
            <div className="grid g3 mb">{[['الالتزام بالموعد', c.rating.on_time], ['التواصل', c.rating.communication], ['اكتمال التوثيق', c.rating.documentation]].map(([l, v]) => <div key={l}><div className="small muted">{l}</div><Stars v={v} /></div>)}</div>
            <div className="tiny muted mb">مبني على {c.rating.count} رحلة مقيّمة بعد التسليم وتأكيد المستلم</div>
            {c.reviews.filter((x) => x.comment).map((x, i) => <div key={i} className="small mb">«{x.comment}» <span className="tiny muted">— {dOnly(x.created_at)}</span></div>)}</>
            : <Empty>لا توجد تقييمات بعد</Empty>}
        </Card>
      </div>
      <Card className="mt" title="الأسعار المنشورة والشروط" flush>{c.routes.length ? <div className="tscroll"><table className="t">
        <thead><tr><th>المسار</th><th>الوقود</th><th>السعر</th><th>رسوم الانتظار</th><th>الإلغاء</th><th>مهلة الرد</th></tr></thead>
        <tbody>{c.routes.map((x) => <tr key={x.id}><td>{x.loading_point_name} ← {x.delivery_city}</td><td>{x.product_ar}</td><td className="num"><b>{sar(x.price_halalas)}</b> ر.س {x.pricing_type === 'per_1000l' ? '/ 1000 لتر' : '/ رحلة'}</td>
          <td className="small">{sar(x.waiting_fee_halalas_per_hour)} ر.س/س بعد {x.free_waiting_hours} س</td><td className="small">{sar(x.cancel_fee_halalas)} ر.س بعد القبول</td><td className="small">{x.accept_within_minutes} دقيقة</td></tr>)}</tbody></table></div>
        : <Empty>لا أسعار منشورة — اطلب عرض سعر عند الطلب</Empty>}</Card>
      {me.company.type === 'client' && <div className="grid g2 mt">
        <Card title="علاقتك مع الناقل">
          {c.contracts.map((x) => <div key={x.number} className="small mb"><Chip tone="info">عقد {x.type === 'monthly' ? 'شهري' : 'سنوي'}</Chip> {x.number} · {x.status} · حتى {x.end_date}</div>)}
          <div className="small muted">رحلاتك معه</div>{c.my_trips.length ? c.my_trips.map((t) => <div key={t.id} className="small"><a href={'/trips/' + t.id} onClick={(e) => { e.preventDefault(); navigate('/trips/' + t.id); }} style={{ color: 'var(--brand)' }}>{t.number}</a> · {t.status_ar}</div>) : <div className="small muted">لا رحلات بعد</div>}
        </Card>
        <Card title="المفضل لمشاريعك">
          <div className="row mb" style={{ gap: 4 }}>{c.preferred_in.map((p) => <Chip key={p.project_id} tone="good">{p.code} — ترتيب #{p.priority}</Chip>)}{!c.preferred_in.length && <span className="small muted">غير مضاف لأي مشروع</span>}</div>
          {can(me, 'order.create', 'org.manage') && <div className="row"><select className="input" style={{ maxWidth: 260 }} value={pid} onChange={(e) => setPid(e.target.value)}><option value="">اختر مشروعًا…</option>{org?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select><button className="btn sm" onClick={addToProject}><Plus size={14} /> أضف لمفضلي المشروع</button></div>}
        </Card>
      </div>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* صفحة المشروع                                                         */
/* ------------------------------------------------------------------ */
export function ProjectPage({ id }) {
  const me = useMe();
  const r = useApi('/projects/' + id);
  const all = useApi('/carriers');
  const [add, setAdd] = useState('');
  const d = r.data;
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!d) return <Spinner />;
  const p = d.project;
  const save = async (ids) => { try { await api(`/projects/${id}/preferred-carriers`, { method: 'PUT', body: { carrier_ids: ids } }); r.reload(); } catch (e) { fail(e); } };
  const ids = d.preferred.map((x) => x.carrier_id);
  const move = (i, dlt) => { const a = [...ids]; const [x] = a.splice(i, 1); a.splice(i + dlt, 0, x); save(a); };
  const budgetPct = p.budget_ml ? d.used.ml / p.budget_ml : null;
  return (
    <>
      <Title sub={`${p.code} · مركز التكلفة ${p.cost_center_code || '—'}`}>{p.name}</Title>
      <div className="row mb"><div className="grow" />{can(me, 'order.create') && <button className="btn primary" onClick={() => navigate('/orders/new?project=' + p.id)}><Truck size={16} /> طلب نقل لهذا المشروع</button>}</div>
      <div className="grid g3">
        <Kpi icon={Fuel} label="المصروف على المعدات" value={liters(d.used.ml)} unit="لتر" foot={p.budget_ml ? `${Math.round(budgetPct * 100)}% من ميزانية ${liters(p.budget_ml)} لتر` : 'بدون ميزانية لترية'} />
        <Kpi icon={MapPin} label="المواقع" value={d.sites.length} />
        <Kpi icon={Truck} label="الناقلون المفضلون" value={d.preferred.length} />
      </div>
      <div className="grid g2 mt">
        <Card title="المواقع" flush><table className="t"><tbody>{d.sites.map((s) => <tr key={s.id} className="click" onClick={() => navigate('/sites/' + s.id)}><td><b>{s.name}</b><div className="tiny muted">{s.city} · {s.receiving_hours ? `الاستلام ${s.receiving_hours}` : 'ساعات الاستلام غير محددة'}{!s.gate_lat && ' · لا يوجد دبوس بوابة'}</div></td>
          <td className="small">{s.tanks.map((t) => <div key={t.id}>{t.code}: <span className="num">{liters(t.book_ml)}</span> لتر</div>)}</td><td><Chip>صفحة الموقع</Chip></td></tr>)}</tbody></table></Card>
        <Card title="ناقلو المشروع المفضلون (بالترتيب)">
          <div className="small muted mb">يظهرون أولًا في «اختر شركة النقل» لطلبات هذا المشروع.</div>
          {d.preferred.map((x, i) => <div key={x.carrier_id} className="row mb"><b className="num">#{i + 1}</b><Logo name={x.name_ar} url={x.logo_url} size={30} /><span className="grow">{x.name_ar}</span>
            {can(me, 'order.create', 'org.manage') && <><button className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button><button className="btn sm ghost" disabled={i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button><button className="btn sm ghost" onClick={() => save(ids.filter((y) => y !== x.carrier_id))}><X size={14} /></button></>}</div>)}
          {can(me, 'order.create', 'org.manage') && <div className="row mt"><select className="input" style={{ maxWidth: 260 }} value={add} onChange={(e) => setAdd(e.target.value)}><option value="">أضف ناقلًا…</option>{(all.data || []).filter((c) => !ids.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="btn sm" disabled={!add} onClick={() => { save([...ids, add]); setAdd(''); }}><Plus size={14} /> إضافة</button></div>}
        </Card>
      </div>
      <Card className="mt" title="آخر طلبات المشروع" flush>{d.orders.length ? <table className="t"><tbody>{d.orders.map((o) => <tr key={o.id} className="click" onClick={() => o.trip_id && navigate('/trips/' + o.trip_id)}><td className="num"><b>{o.number}</b></td><td>{o.carrier_name}</td><td className="num">{liters(o.quantity_ml)} لتر</td><td className="small">{dt(o.created_at)}</td></tr>)}</tbody></table> : <Empty />}</Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* صفحة الموقع وتقريره                                                  */
/* ------------------------------------------------------------------ */
export function SitePage({ id }) {
  const me = useMe();
  const r = useApi('/sites/' + id);
  const [edit, setEdit] = useState(false);
  const d = r.data;
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!d) return <Spinner />;
  const s = d.site;
  const save = async (e) => { e.preventDefault(); try { await api(`/sites/${id}/access`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('حُدّثت بطاقة دخول الموقع — تظهر للسائق المسند'); setEdit(false); r.reload(); } catch (err) { fail(err); } };
  const pin = s.gate_lat ? `https://www.google.com/maps/search/?api=1&query=${s.gate_lat},${s.gate_lng}` : null;
  return (
    <>
      <Title sub={`${s.project_code} ${s.project_name} · ${s.city}`}>{s.name}</Title>
      <div className="row mb no-print"><button className="btn sm" onClick={() => navigate('/projects/' + s.project_id)}>المشروع</button><div className="grow" /><button className="btn sm" onClick={() => print()}><Printer size={14} /> طباعة تقرير الموقع / PDF</button></div>
      <div className="grid g-main">
        <Card title="بطاقة دخول الموقع" icon={<MapPin size={17} color="var(--brand)" />} actions={can(me, 'org.manage', 'inventory.manage', 'receipt.confirm') && <button className="btn sm no-print" onClick={() => setEdit(true)}><Pencil size={14} /> تعديل</button>}>
          <dl className="kv">
            <dt>دبوس البوابة</dt><dd>{pin ? <a href={pin} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}><Navigation size={13} /> {s.gate_lat.toFixed(5)}, {s.gate_lng.toFixed(5)}</a> : <Chip tone="warn">غير محدد</Chip>}</dd>
            <dt>ساعات الاستلام</dt><dd>{s.receiving_hours || <Chip tone="warn">غير محددة</Chip>} {s.receiving_days && <span className="muted small">· {s.receiving_days}</span>}</dd>
            <dt>المستلم</dt><dd>{s.receiver_name} {s.receiver_phone && <a href={'tel:' + s.receiver_phone} className="chip info"><Phone size={12} /> {s.receiver_phone}</a>}</dd>
            <dt>تعليمات الوصول</dt><dd>{s.access_notes || '—'}</dd>
            <dt>آخر تحديث</dt><dd className="small">{s.access_updated_at ? `${dt(s.access_updated_at)} · ${s.access_updated_by_name}` : '—'}</dd>
          </dl>
          <div className="tiny muted mt">تظهر هذه البطاقة للسائق المسند في مهمته مع وقت آخر تحديث.</div>
        </Card>
        <Card title="الخزانات">{d.tanks.length ? d.tanks.map((t) => (
          <div key={t.id} className="mb"><div className="row"><b>{t.code}</b><span className="small muted">{t.name}</span><div className="grow" /><b className="num">{liters(t.book_ml)}</b><span className="small muted">/ {liters(t.capacity_ml)} لتر</span></div>
            <Meter value={t.book_ml} max={t.capacity_ml} mark={t.reorder_ml} tone={t.book_ml <= t.reorder_ml ? 'warn' : ''} />
            <div className="tiny muted" style={{ marginTop: 4 }}>{t.days_left == null ? 'لا يوجد صرف في آخر 14 يومًا لتقدير النفاد' : `يكفي تقديريًا ${t.days_left} يوم بمعدل ${liters(t.daily_ml)} لتر/يوم (آخر ${t.basis_days} يومًا)`}</div></div>)) : <Empty>تزويد مباشر فقط</Empty>}</Card>
      </div>
      <div className="grid g4 mt">
        <Kpi icon={Truck} label="رحلات مسلّمة للموقع" value={d.totals.trips} foot={`${d.totals.confirmed} مؤكدة · ${d.totals.disputed} باعتراض`} />
        <Kpi icon={Fuel} label="المسلّم للموقع" value={liters(d.totals.delivered_ml)} unit="لتر" foot={`من ${liters(d.totals.requested_ml)} لتر مطلوبة`} />
        <Kpi icon={Camera} label="توثيق مكتمل (4 صور)" value={`${d.totals.full_photos}/${d.totals.trips}`} />
        <Kpi icon={Gauge} label="الصرف آخر 30 يومًا" value={liters(d.totals.issued_30d_ml)} unit="لتر" foot={`${d.totals.fuelings_30d} عملية NFC`} />
      </div>
      {d.upcoming.length > 0 && <Card className="mt" title="الرحلات القادمة للموقع" flush><table className="t"><tbody>{d.upcoming.map((t) => <tr key={t.id + t.stop_id} className="click" onClick={() => navigate('/trips/' + t.id)}>
        <td className="num"><b>{t.number}</b></td><td><Chip tone={TRIP_TONE[t.status]}>{t.status_ar}</Chip></td><td className="small">{dt(t.window_start)}</td><td>{t.carrier_name}</td><td className="small">{t.plate || '—'} {t.driver_name && `· ${t.driver_name}`}</td><td className="num">{liters(t.requested_ml)} لتر</td></tr>)}</tbody></table></Card>}
      <Card className="mt" title="تقرير استلام الموقع" flush>{d.delivered.length ? <div className="tscroll"><table className="t">
        <thead><tr><th>الرحلة</th><th>التسليم</th><th>الناقل والصهريج</th><th>المطلوبة</th><th>المسلّمة</th><th>الفرق</th><th>الصور</th><th>المستلم</th><th>التقييم</th></tr></thead>
        <tbody>{d.delivered.map((t) => { const v = t.delivered_ml != null ? t.requested_ml - t.delivered_ml : null; return (
          <tr key={t.id + t.stop_id} className="click" onClick={() => navigate('/trips/' + t.id)}><td className="num"><b>{t.number}</b><div className="tiny muted">{t.order_number}</div></td><td className="small">{dt(t.delivered_at)}<div className="tiny muted">{t.mode === 'tank' ? 'خزان ' + t.tank_code : 'تزويد مباشر'}</div></td>
            <td className="small">{t.carrier_name}<div className="tiny muted">{t.plate} · {t.driver_name}</div></td><td className="num">{liters(t.requested_ml)}</td><td className="num"><b>{liters(t.delivered_ml)}</b></td>
            <td className="num" style={{ color: v ? 'var(--warn)' : undefined }}>{v ? liters(v) : '—'}</td><td><Chip tone={t.photos >= 4 ? 'good' : 'warn'}><Camera size={12} /> {t.photos}/4</Chip></td>
            <td className="small">{t.receiver_ack ? <><Chip tone={t.receiver_ack === 'confirmed' ? 'good' : 'bad'}>{t.receiver_ack === 'confirmed' ? 'أكد' : 'اعترض'}</Chip><div className="tiny muted">{t.receiver_ack_by} · {dt(t.receiver_ack_at)}</div></> : <Chip tone="warn">بانتظار</Chip>}</td>
            <td>{t.rating ? <Stars v={t.rating} size={11} /> : '—'}</td></tr>); })}</tbody></table></div> : <Empty>لا توجد رحلات مسلّمة لهذا الموقع بعد</Empty>}</Card>
      {edit && <Modal title="بطاقة دخول الموقع" onClose={() => setEdit(false)}><form className="stack" onSubmit={save}>
        <div className="grid g2"><Field label="خط عرض البوابة"><input name="gate_lat" className="input" defaultValue={s.gate_lat ?? ''} placeholder="24.30121" /></Field><Field label="خط طول البوابة"><input name="gate_lng" className="input" defaultValue={s.gate_lng ?? ''} placeholder="47.18342" /></Field></div>
        <button type="button" className="btn sm" onClick={() => navigator.geolocation?.getCurrentPosition((p) => { document.querySelector('[name=gate_lat]').value = p.coords.latitude.toFixed(6); document.querySelector('[name=gate_lng]').value = p.coords.longitude.toFixed(6); }, () => fail('تعذر تحديد الموقع'))}><Navigation size={14} /> استخدم موقعي الحالي عند البوابة</button>
        <div className="grid g2"><Field label="ساعات الاستلام"><input name="receiving_hours" className="input" defaultValue={s.receiving_hours || ''} placeholder="06:00 – 18:00" /></Field><Field label="أيام الاستلام"><input name="receiving_days" className="input" defaultValue={s.receiving_days || ''} placeholder="الأحد – الخميس" /></Field></div>
        <div className="grid g2"><Field label="اسم المستلم"><input name="receiver_name" className="input" defaultValue={s.receiver_name || ''} /></Field><Field label="جوال المستلم"><input name="receiver_phone" className="input" defaultValue={s.receiver_phone || ''} /></Field></div>
        <Field label="تعليمات الوصول"><textarea name="access_notes" className="input" rows={3} defaultValue={s.access_notes || ''} /></Field>
        <button className="btn primary">حفظ</button></form></Modal>}
    </>
  );
}
