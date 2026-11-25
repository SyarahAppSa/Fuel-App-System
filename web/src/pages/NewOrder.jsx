import React, { useEffect, useMemo, useState } from 'react';
import { Upload, Plus, Trash2, Star, Truck, CheckCircle2, Search, Send, MessageSquareQuote, Columns3, CalendarClock, Gauge, MapPin, AlertTriangle, ArrowRight, Package } from 'lucide-react';
import { api, useApi, navigate, liters, sar, n, today, dOnly, dt, fail, toast, auth, opId, query, PRODUCTS } from '../lib.js';
import { Card, Field, Chip, Steps, Spinner, Alert, Empty, Modal, Meter } from '../ui.jsx';
import { Title } from '../ctx.jsx';
import { DocumentReview } from './Orders.jsx';
import { Stars } from './Booking.jsx';

const STEPS = [{ key: 'details', label: 'تفاصيل الطلب' }, { key: 'carrier', label: 'اختر شركة النقل' }, { key: 'summary', label: 'الملخص ومستند أرامكو' }];
const QR_AR = { pending: 'بانتظار عرض السعر', quoted: 'وصل عرض السعر', declined: 'اعتذر عن التسعير', expired: 'انتهت صلاحية العرض', used: 'استُخدم' };

export function Logo({ name, url, size = 52 }) {
  const ini = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((w) => !['شركة', 'مؤسسة', 'ناقلات'].includes(w))[0]?.replace(/^ال/, '')[0] || name[0];
  return url ? <img src={url} alt={name} style={{ width: size, height: size, borderRadius: 14, objectFit: 'cover', border: '1px solid var(--line)', background: '#fff' }} />
    : <div style={{ width: size, height: size, borderRadius: 14, background: 'linear-gradient(135deg, var(--brand), var(--g3))', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: size / 2.4, flexShrink: 0 }}>{ini}</div>;
}

function CarrierCard({ c, onPick, onQuote, onFav, compare, onCompare, date }) {
  const p = c.price;
  const blocked = !c.earliest_date;
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderColor: compare ? 'var(--brand)' : undefined, boxShadow: compare ? '0 0 0 3px var(--brand-soft)' : undefined }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Logo name={c.name} url={c.logo_url} />
        <div className="grow"><b style={{ fontSize: 16, cursor: 'pointer' }} onClick={() => navigate('/carriers/' + c.carrier_id)}>{c.name}</b> {c.project_priority && <Chip tone="good">مفضل #{c.project_priority} للمشروع</Chip>}
          <div className="tiny muted">{c.city} · <Stars v={c.rating?.overall} count={c.rating?.count} size={11} /></div>
          <div className="row" style={{ gap: 4, marginTop: 6 }}>{c.loading.map((l) => <Chip key={l} tone="info">تحميل: {l}</Chip>)}{c.delivery.slice(0, 3).map((l) => <Chip key={l} tone="brand">تسليم: {l}</Chip>)}{c.delivery.length > 3 && <Chip>+{c.delivery.length - 3}</Chip>}</div></div>
        <button className="btn ghost sm" onClick={onFav} aria-label={c.favorite ? 'إزالة من المفضلين' : 'إضافة للمفضلين'} title={c.favorite ? 'من المفضلين' : 'أضف للمفضلين'}>
          <Star size={20} fill={c.favorite ? 'var(--gold, #e0a92a)' : 'none'} color={c.favorite ? '#c28a12' : 'var(--muted)'} /></button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr 1fr', gap: 10 }}>
        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 10 }}>
          <div className="tiny muted">سعر النقل الإجمالي</div>
          {p ? <><div style={{ fontSize: 21, fontWeight: 800 }}><span className="num">{sar(p.quote.total_halalas)}</span> <small className="muted" style={{ fontSize: 12 }}>ر.س</small></div>
            <div className="tiny muted">{p.label}{p.quote.trips > 1 ? ` · ${p.quote.trips} رحلات` : ''} · شامل الخدمة والضريبة</div></>
            : c.quote_request?.status === 'pending' ? <div className="small" style={{ marginTop: 4 }}><Chip tone="warn">بانتظار عرض السعر</Chip><div className="tiny muted">{c.quote_request.number}</div></div>
              : <button className="btn sm primary" style={{ marginTop: 6 }} onClick={onQuote}><MessageSquareQuote size={14} /> اطلب عرض سعر</button>}
          {!p && c.quote_request && c.quote_request.status !== 'pending' && <div className="tiny" style={{ color: 'var(--bad)', marginTop: 4 }}>{QR_AR[c.quote_request.status]}{c.quote_request.note ? ` — ${c.quote_request.note}` : ''}</div>}
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 10 }}>
          <div className="tiny muted"><CalendarClock size={12} /> أقرب موعد متاح</div>
          {blocked ? <div className="small" style={{ color: 'var(--bad)', fontWeight: 600 }}>{c.reason}</div> : <>
            <div style={{ fontWeight: 700, color: c.available ? 'var(--good)' : 'var(--warn)' }}>{c.available ? 'متاح في موعدك' : dOnly(c.earliest_date + 'T12:00:00Z')}</div>
            <div className="tiny muted">صهريج {n(c.suitable_capacity_l)} لتر{c.trips_needed > 1 ? ` · ${c.trips_needed} رحلات × ${n(c.per_trip_l)}` : ''}</div></>}
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 10 }}>
          <div className="tiny muted"><Gauge size={12} /> الأداء عبر فيول آب</div>
          <div style={{ fontWeight: 700 }}>{c.on_time_pct == null ? 'لا توجد عينة بعد' : `${c.on_time_pct}% في الموعد`}</div>
          <div className="tiny muted">{c.trips_done} رحلة منفذة{c.sample ? ` · المؤشر من ${c.sample} رحلة` : ''}</div>
        </div>
      </div>
      {p?.quote.terms && <div className="tiny muted">انتظار {sar(p.quote.terms.waiting_fee_halalas_per_hour)} ر.س/س بعد {p.quote.terms.free_waiting_hours} س مجانية · إلغاء {p.quote.terms.cancel_fee_halalas ? sar(p.quote.terms.cancel_fee_halalas) + ' ر.س بعد القبول' : 'بدون رسوم'} · يرد خلال {p.quote.terms.accept_within_minutes} د</div>}
      {c.package && <div className="small"><Package size={14} /> متاح من باقتك {c.package.number}: <b>{c.package.available}</b> رحلة مدفوعة مسبقًا</div>}
      <div className="row">
        <label className="row small" style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!compare} onChange={onCompare} /> قارن</label>
        <div className="grow" />
        {c.package && c.available && <button className="btn sm" onClick={() => onPick({ package: true })}>من الباقة</button>}
        <button className="btn primary" disabled={!p || blocked} onClick={() => onPick({ date: c.available ? date : c.earliest_date })}>
          {c.available || blocked ? 'اختيار' : `اختيار بموعد ${dOnly(c.earliest_date + 'T12:00:00Z')}`}</button>
      </div>
    </div>
  );
}

export function NewOrder() {
  const qp = query();
  const reofferId = qp.reoffer || null;
  const lookups = useApi('/lookups').data;
  const org = useApi('/org').data;
  const docs = useApi('/documents');
  const ctxo = useApi(reofferId ? `/orders/${reofferId}/context` : null);
  const [step, setStep] = useState('details');
  const [d, setD] = useState({ loading_point_id: 'lp_ryd', product: 'diesel', date: today(1), window_start: '07:00', window_end: '15:00', fuel_price_per_liter: '1.66', stops: [{ site_id: '', mode: 'tank', tank_id: '', quantity_liters: '' }] });
  const [sort, setSort] = useState('price');
  const [favOnly, setFavOnly] = useState(false);
  const [cmp, setCmp] = useState(qp.carrier ? [qp.carrier] : []);
  const [showCmp, setShowCmp] = useState(false);
  const [pick, setPick] = useState(null);
  const [doc, setDoc] = useState(null);
  const [pendingDoc, setPendingDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const idem = useMemo(() => opId(), []);

  useEffect(() => { // طلب لمشروع محدد: اختر أول موقع فيه وخزانه
    if (!org || !qp.project || d.stops[0].site_id) return;
    const s = org.sites.find((x) => x.project_id === qp.project); if (!s) return;
    const t = org.tanks.find((x) => x.site_id === s.id && x.product === d.product);
    setD((x) => ({ ...x, stops: [{ ...x.stops[0], site_id: s.id, tank_id: t?.id || '', mode: t ? 'tank' : 'direct' }] }));
  }, [org]);
  useEffect(() => { // «اختر ناقلًا آخر»: نفس بيانات الطلب
    if (!ctxo.data) return; const o = ctxo.data;
    setD((x) => ({ ...x, loading_point_id: o.loading_point_id, product: o.product, date: o.date, window_start: o.window_start, window_end: o.window_end, stops: o.stops }));
    setStep('carrier');
  }, [ctxo.data]);

  const site0 = org?.sites.find((s) => s.id === d.stops[0].site_id);
  const total = d.stops.reduce((s, x) => s + Number(x.quantity_liters || 0), 0);
  const qs = new URLSearchParams({ loading_point_id: d.loading_point_id, site_id: d.stops[0].site_id, product: d.product, quantity_liters: total, date: d.date, window_start: d.window_start, window_end: d.window_end, sort, ...(reofferId ? { order_id: reofferId } : {}) }).toString();
  const market = useApi(step === 'carrier' ? '/market/carriers?' + qs : null, [qs, step]);
  const cards = (market.data?.cards || []).filter((c) => !favOnly || c.favorite);
  const setStop = (i, patch) => setD({ ...d, stops: d.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const matchingDocs = (docs.data || []).filter((x) => x.status === 'approved' && x.loading_point_id === d.loading_point_id && x.product === d.product && x.quantities?.available_ml >= total * 1000);

  const toCarrier = () => {
    if (!d.stops.every((s) => s.site_id && Number(s.quantity_liters) > 0 && (s.mode === 'direct' || s.tank_id))) return fail('أكمل موقع التسليم والخزان والكمية');
    if (!d.date || d.date < today()) return fail('اختر موعدًا من اليوم فصاعدًا'); setStep('carrier');
  };
  const quote = async (c) => {
    try { const r = await api('/quote-requests', { method: 'POST', body: { carrier_id: c.carrier_id, loading_point_id: d.loading_point_id, site_id: d.stops[0].site_id, product: d.product, quantity_liters: total, date: d.date, window_start: d.window_start, window_end: d.window_end } });
      toast(`أُرسل طلب عرض السعر ${r.number} إلى ${c.name}`); market.reload(); } catch (e) { fail(e); }
  };
  const fav = async (c) => { try { await api('/favorites/' + c.carrier_id, { method: c.favorite ? 'DELETE' : 'POST' }); market.reload(); } catch (e) { fail(e); } };
  const choose = (c, o) => { if (o.date && o.date !== d.date) { setD({ ...d, date: o.date }); toast(`عُدّل الموعد إلى ${o.date} حسب توفر ${c.name}`); } setPick({ ...c, usePackage: !!o.package }); setStep('summary'); };
  const upload = async (file) => { const fd = new FormData(); fd.append('file', file); setBusy(true); try { setPendingDoc(await api('/documents', { method: 'POST', form: fd })); docs.reload(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const priceBody = (c) => (c.usePackage ? { package_id: c.package.package_id } : c.price.contract_rate_id ? { contract_rate_id: c.price.contract_rate_id } : c.price.quote_request_id ? { quote_request_id: c.price.quote_request_id } : { route_price_id: c.price.route_price_id });
  const send = async () => {
    setBusy(true);
    try {
      if (reofferId) { const r = await api(`/orders/${reofferId}/reoffer`, { method: 'POST', body: priceBody(pick) }); toast(`أُرسل الطلب إلى ${pick.name}`); navigate('/trips/' + r.trip_id); return; }
      const r = await api('/orders', { method: 'POST', body: { ...priceBody(pick), aramco_document_id: doc.id, project_id: site0?.project_id, ...d, idempotency_key: idem } });
      toast(`أُرسل الطلب ${r.order_number} إلى ${pick.name} وحده`); navigate('/trips/' + r.trip_id);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const done = STEPS.slice(0, STEPS.findIndex((s) => s.key === step)).map((s) => s.key);
  const finalQuote = pick && (pick.usePackage ? pick.package.quote : pick.price?.quote);
  const lp = lookups?.loading_points.find((l) => l.id === d.loading_point_id);

  return (
    <>
      <Title sub={reofferId ? `إعادة طرح الطلب ${ctxo.data?.number || ''} على ناقل آخر — بنفس البيانات والمستند` : 'حدد الطلب، اختر شركة النقل، ثم أرسل'}>{reofferId ? 'اختر ناقلًا آخر' : 'طلب نقل جديد'}</Title>
      <div className="card mb" style={{ padding: '16px 16px 10px' }}><Steps steps={STEPS} current={step} done={done} /></div>

      {step === 'details' && (
        <Card title="تفاصيل الطلب">
          <div className="form-grid">
            <Field label="نقطة التحميل"><select className="input" value={d.loading_point_id} onChange={(e) => setD({ ...d, loading_point_id: e.target.value })}>{lookups?.loading_points.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</select></Field>
            <Field label="نوع الوقود"><select className="input" value={d.product} onChange={(e) => setD({ ...d, product: e.target.value })}>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="تاريخ التسليم"><input type="date" className="input" value={d.date} min={today()} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
            <Field label="بداية النافذة"><input type="time" className="input" value={d.window_start} onChange={(e) => setD({ ...d, window_start: e.target.value })} /></Field>
            <Field label="نهاية النافذة"><input type="time" className="input" value={d.window_end} onChange={(e) => setD({ ...d, window_end: e.target.value })} /></Field>
            <Field label="سعر لتر الوقود (ر.س)" hint="لاحتساب تكلفة الصرف؛ اتركه فارغًا إن لم يكن معلومًا"><input type="number" step="0.01" className="input" value={d.fuel_price_per_liter} onChange={(e) => setD({ ...d, fuel_price_per_liter: e.target.value })} /></Field>
          </div>
          <h4 className="mt" style={{ marginBottom: 10 }}><MapPin size={15} /> موقع التسليم والكمية</h4>
          {d.stops.map((s, i) => { const tanks = (org?.tanks || []).filter((t) => t.site_id === s.site_id && t.product === d.product); return (
            <div key={i} className="card mb" style={{ padding: 14, background: 'var(--surface-2)' }}><div className="form-grid">
              <Field label={`الموقع ${i + 1}`}><select className="input" value={s.site_id} onChange={(e) => setStop(i, { site_id: e.target.value, tank_id: '' })}><option value="">اختر…</option>{(org?.sites || []).map((x) => <option key={x.id} value={x.id}>{x.name} — {x.city}</option>)}</select></Field>
              <Field label="طريقة التسليم"><select className="input" value={s.mode} onChange={(e) => setStop(i, { mode: e.target.value })}><option value="tank">إلى خزان الموقع</option><option value="direct">تزويد مباشر للمعدات</option></select></Field>
              {s.mode === 'tank' && <Field label="الخزان"><select className="input" value={s.tank_id} onChange={(e) => setStop(i, { tank_id: e.target.value })}><option value="">اختر…</option>{tanks.map((t) => <option key={t.id} value={t.id}>{t.code} — فراغ {liters(t.capacity_ml - t.book_ml)} لتر</option>)}</select></Field>}
              <Field label="الكمية (لتر)"><input type="number" className="input" value={s.quantity_liters} onChange={(e) => setStop(i, { quantity_liters: e.target.value })} /></Field>
            </div>{d.stops.length > 1 && <button className="btn sm danger" style={{ marginTop: 8 }} onClick={() => setD({ ...d, stops: d.stops.filter((_, j) => j !== i) })}><Trash2 size={14} /> حذف</button>}</div>); })}
          <div className="row"><button className="btn" onClick={() => setD({ ...d, stops: [...d.stops, { site_id: '', mode: 'tank', tank_id: '', quantity_liters: '' }] })}><Plus size={15} /> موقع آخر</button><div className="grow" />
            <span className="muted">الإجمالي <b className="num">{n(total)}</b> لتر</span><button className="btn primary" onClick={toCarrier}><Search size={16} /> اختر شركة النقل</button></div>
        </Card>
      )}

      {step === 'carrier' && (
        <>
          <div className="card mb" style={{ padding: 12 }}><div className="row">
            <span className="small"><b>{lp?.name}</b> ← <b>{site0?.name || market.data?.city}</b> · {PRODUCTS[d.product]} · <span className="num">{n(total)}</span> لتر · {dOnly(d.date + 'T12:00:00Z')} {d.window_start}–{d.window_end}</span>
            {!reofferId && <button className="btn sm ghost" onClick={() => setStep('details')}>تعديل</button>}<div className="grow" />
            <span className="small muted">فرز:</span>
            {[['price', 'السعر'], ['earliest', 'أقرب موعد'], ['performance', 'الأداء']].map(([k, l]) => <button key={k} className={'btn sm ' + (sort === k ? 'primary' : '')} onClick={() => setSort(k)}>{l}</button>)}
            <button className={'btn sm ' + (favOnly ? 'primary' : '')} onClick={() => setFavOnly(!favOnly)}><Star size={14} /> المفضلون</button>
            <button className="btn sm" disabled={cmp.length < 2} onClick={() => setShowCmp(true)}><Columns3 size={14} /> قارن ({cmp.length}/3)</button>
          </div></div>
          {reofferId && ctxo.data && <div className="mb"><Alert tone="warn">{ctxo.data.offers.filter((f) => ['rejected', 'expired'].includes(f.status)).map((f) => `${f.name_ar}: ${f.status === 'rejected' ? 'اعتذر' + (f.reason ? ` (${f.reason})` : '') : 'انتهت مهلة رده'}`).join(' · ')} — الناقلون المعتذرون لا يظهرون في القائمة.</Alert></div>}
          {market.loading && !market.data ? <Spinner /> : market.error ? <Alert tone="bad">{market.error.message}</Alert> : (
            <>
              {market.data && !market.data.any_on_date && <div className="mb"><Alert tone="warn">لا يوجد ناقل متاح في {dOnly(d.date + 'T12:00:00Z')}. {market.data.earliest_overall ? <>أقرب موعد متاح: <b>{dOnly(market.data.earliest_overall + 'T12:00:00Z')}</b> <button className="btn sm" onClick={() => setD({ ...d, date: market.data.earliest_overall })}>اعتماد هذا الموعد</button></> : 'اطلب عرض سعر من الناقلين أدناه.'}</Alert></div>}
              {cards.length === 0 ? <Empty>{favOnly ? 'لا يوجد ناقل مفضل يخدم هذا المسار' : 'لا يوجد ناقل معتمد يخدم هذا المسار حاليًا'}</Empty> : (
                <div className="grid g2">{cards.map((c) => <CarrierCard key={c.carrier_id} c={c} date={d.date} compare={cmp.includes(c.carrier_id)}
                  onCompare={() => setCmp(cmp.includes(c.carrier_id) ? cmp.filter((x) => x !== c.carrier_id) : cmp.length >= 3 ? (toast('المقارنة حتى ثلاثة ناقلين — أزل واحدًا أولًا'), cmp) : [...cmp, c.carrier_id])}
                  onPick={(o) => choose(c, o)} onQuote={() => quote(c)} onFav={() => fav(c)} />)}</div>)}
            </>)}
          {showCmp && <Modal title="مقارنة عروض الناقلين" wide onClose={() => setShowCmp(false)}>
            {(() => { const sel = (market.data?.cards || []).filter((c) => cmp.includes(c.carrier_id)); const rows = [
              ['السعر الإجمالي', (c) => (c.price ? sar(c.price.quote.total_halalas) + ' ر.س' : 'يتطلب عرض سعر')], ['مصدر السعر', (c) => c.price?.label || '—'],
              ['أقرب موعد', (c) => (c.available ? 'في موعدك' : c.earliest_date ? dOnly(c.earliest_date + 'T12:00:00Z') : '—')], ['سعة الصهريج', (c) => (c.suitable_capacity_l ? n(c.suitable_capacity_l) + ' لتر' : '—')],
              ['عدد الرحلات', (c) => c.trips_needed || '—'],
              ['رسوم الانتظار', (c) => (c.price?.quote.terms ? `${sar(c.price.quote.terms.waiting_fee_halalas_per_hour)} ر.س/ساعة بعد ${c.price.quote.terms.free_waiting_hours} ساعة مجانية` : '—')],
              ['سياسة الإلغاء', (c) => (c.price?.quote.terms ? (c.price.quote.terms.cancel_fee_halalas ? `مجاني قبل القبول، ${sar(c.price.quote.terms.cancel_fee_halalas)} ر.س بعده` : 'بدون رسوم') : '—')],
              ['مهلة رد الناقل', (c) => (c.price?.quote.terms ? `${c.price.quote.terms.accept_within_minutes} دقيقة` : '—')],
              ['التقييم', (c) => <Stars v={c.rating?.overall} count={c.rating?.count} size={12} />], ['رحلات منفذة عبر فيول آب', (c) => c.trips_done], ['الالتزام بالموعد', (c) => (c.on_time_pct == null ? 'لا توجد عينة' : `${c.on_time_pct}% (${c.sample} رحلة)`)],
              ['التحميل', (c) => c.loading.join('، ')], ['التسليم', (c) => c.delivery.join('، ')]];
            return <div className="tscroll"><table className="t"><thead><tr><th></th>{sel.map((c) => <th key={c.carrier_id}><div className="row"><Logo name={c.name} url={c.logo_url} size={30} /> {c.name}</div></th>)}</tr></thead>
              <tbody>{rows.map(([l, f]) => <tr key={l}><td className="muted small">{l}</td>{sel.map((c) => <td key={c.carrier_id}>{f(c)}</td>)}</tr>)}
                <tr><td /> {sel.map((c) => <td key={c.carrier_id}><button className="btn sm primary" disabled={!c.price || !c.earliest_date} onClick={() => { setShowCmp(false); choose(c, { date: c.available ? d.date : c.earliest_date }); }}>اختيار</button></td>)}</tr></tbody></table></div>; })()}
          </Modal>}
        </>
      )}

      {step === 'summary' && pick && (
        <div className="grid g-main">
          <div className="stack">
            <Card title="ملخص الطلب" actions={<button className="btn sm" onClick={() => setStep('carrier')}><ArrowRight size={14} /> تغيير الناقل</button>}>
              <div className="row mb"><Logo name={pick.name} url={pick.logo_url} /><div><b style={{ fontSize: 17 }}>{pick.name}</b><div className="small muted">{pick.on_time_pct == null ? 'لا توجد عينة أداء بعد' : `${pick.on_time_pct}% في الموعد من ${pick.sample} رحلة`} · {pick.trips_done} رحلة منفذة</div></div></div>
              <dl className="kv"><dt>التحميل</dt><dd>{lp?.name}</dd><dt>المنتج</dt><dd>{PRODUCTS[d.product]}</dd><dt>الموعد</dt><dd>{dOnly(d.date + 'T12:00:00Z')} · {d.window_start} – {d.window_end}</dd>
                <dt>التسليم</dt><dd>{d.stops.map((s, i) => <div key={i}>{org?.sites.find((x) => x.id === s.site_id)?.name} — <span className="num">{n(s.quantity_liters)}</span> لتر ({s.mode === 'tank' ? 'خزان ' + (org?.tanks.find((t) => t.id === s.tank_id)?.code || '') : 'تزويد مباشر'})</div>)}</dd>
                <dt>الصهريج</dt><dd>{n(pick.suitable_capacity_l)} لتر{pick.trips_needed > 1 ? ` · ${pick.trips_needed} رحلات` : ''}</dd></dl>
            </Card>
            <Card title="مستند أرامكو">
              {reofferId ? <Alert tone="info">المستند نفسه: <b className="num">{ctxo.data?.doc_number}</b> — يُكشف للناقل بعد قبوله فقط.</Alert>
                : pendingDoc && pendingDoc.status !== 'approved' ? <DocumentReview doc={pendingDoc} lookups={lookups} onApproved={(x) => { docs.reload(); setPendingDoc(null); if (x.loading_point_id !== d.loading_point_id || x.product !== d.product) fail('المستند لا يطابق نقطة التحميل أو المنتج في الطلب'); else setDoc(x); }} />
                  : <div className="stack">
                    {matchingDocs.length > 0 && <Field label="مستند معتمد بكمية كافية"><select className="input" value={doc?.id || ''} onChange={(e) => setDoc(matchingDocs.find((x) => x.id === e.target.value) || null)}>
                      <option value="">اختر…</option>{matchingDocs.map((x) => <option key={x.id} value={x.id}>{x.doc_number} — متاح {liters(x.quantities.available_ml)} لتر</option>)}</select></Field>}
                    {doc ? <Alert tone="good">المستند المرفق: <b className="num">{doc.doc_number}</b></Alert> : <label className="scan" style={{ display: 'block', cursor: 'pointer', padding: 18 }}><Upload size={28} color="var(--brand)" />
                      <div style={{ fontWeight: 600, margin: '6px 0' }}>{busy ? 'جارٍ الاستخراج…' : 'ارفع طلب أرامكو PDF'}</div><input type="file" accept="application/pdf" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>}
                    {!doc && <a className="btn sm ghost" href={`/api/demo/sample-aramco.pdf?liters=${total}&lp=${d.loading_point_id}&token=${auth.token}`}>تنزيل مستند تجريبي ({n(total)} لتر)</a>}
                  </div>}
            </Card>
          </div>
          <Card title="السعر والإرسال">
            {finalQuote && <dl className="kv"><dt>أجرة النقل</dt><dd className="num">{sar(finalQuote.base_halalas)} ر.س</dd><dt>رسوم الخدمة</dt><dd className="num">{sar(finalQuote.platform_fee_halalas)}</dd><dt>ض.ق.م</dt><dd className="num">{sar(finalQuote.vat_halalas)}</dd>
              <dt>الإجمالي</dt><dd className="price-big"><span className="num">{sar(finalQuote.total_halalas)}</span> ر.س</dd><dt>المصدر</dt><dd className="small">{pick.usePackage ? `باقة ${pick.package.number}` : pick.price.label}</dd>
              {finalQuote.terms && <><dt>مهلة رد الناقل</dt><dd><Chip tone="info">{finalQuote.terms.accept_within_minutes} دقيقة من الإرسال</Chip></dd><dt>الانتظار والإلغاء</dt><dd className="small">{sar(finalQuote.terms.waiting_fee_halalas_per_hour)} ر.س/س بعد {finalQuote.terms.free_waiting_hours} س · إلغاء {finalQuote.terms.cancel_fee_halalas ? sar(finalQuote.terms.cancel_fee_halalas) + ' ر.س بعد القبول' : 'بدون رسوم'}</dd></>}</dl>}
            <Alert tone="info">يصل الطلب إلى <b>{pick.name}</b> وحده. إن اعتذر أو انتهت مهلة رده يظهر لك زر «اختر ناقلًا آخر» بنفس بيانات الطلب.</Alert>
            <button className="btn primary lg block mt" disabled={busy || (!reofferId && !doc)} onClick={send}><Send size={18} /> إرسال الطلب إلى {pick.name}</button>
          </Card>
        </div>
      )}
    </>
  );
}
