import React, { useMemo, useState } from 'react';
import { Upload, FileCheck2, Plus, Trash2, Star, Truck, CheckCircle2, Search } from 'lucide-react';
import { api, useApi, navigate, liters, sar, n, today, dOnly, fail, toast, auth, opId, PRODUCTS } from '../lib.js';
import { Card, Field, Chip, Steps, Spinner, Alert, Empty, Meter } from '../ui.jsx';
import { Title } from '../ctx.jsx';

const STEPS = [{ key: 'doc', label: 'مستند أرامكو' }, { key: 'delivery', label: 'التسليم' }, { key: 'carrier', label: 'مقارنة الناقلين' }, { key: 'review', label: 'المراجعة والإرسال' }];

export function DocumentReview({ doc, onApproved, lookups }) {
  const f = doc.extraction?.fields || {};
  const [v, setV] = useState({ doc_number: doc.doc_number || '', loading_point_id: doc.loading_point_id || '', product: doc.product || '', quantity_liters: doc.authorized_ml ? doc.authorized_ml / 1000 : '', issue_date: doc.issue_date || '', expiry_date: doc.expiry_date || '' });
  const [busy, setBusy] = useState(false);
  const cls = (k) => 'input' + (f[k]?.confidence === 'low' || (!f[k] && doc.extraction?.status === 'text') ? ' lowconf' : '');
  const conf = (k) => (f[k] ? (f[k].confidence === 'high' ? 'مستخرج بثقة عالية' : 'مستخرج — راجع القيمة') : 'لم يُستخرج — أدخل يدويًا');
  async function approve() {
    setBusy(true);
    try { const r = await api(`/documents/${doc.id}/approve`, { method: 'POST', body: v }); toast('اعتُمدت بيانات المستند'); onApproved(r); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  return (
    <div className="grid g2">
      <div className="card" style={{ overflow: 'hidden', minHeight: 420 }}>
        <iframe title="المستند" src={`/api/files/${doc.file_id}?token=${auth.token}`} style={{ width: '100%', height: '100%', minHeight: 460, border: 0 }} />
      </div>
      <div className="stack">
        {doc.duplicate_of && <Alert tone="warn">هذا الملف مرفوع سابقًا (نفس البصمة). لتوزيع المستند على عدة رحلات استخدم النسخة المعتمدة بدل رفعه مجددًا.</Alert>}
        {doc.extraction?.status === 'scanned' && <Alert tone="info">الملف ممسوح ضوئيًا بلا نص قابل للاستخراج — أدخل الحقول يدويًا من الصورة.</Alert>}
        {doc.extraction?.status === 'unreadable' && <Alert tone="bad">تعذرت قراءة الملف — أدخل الحقول يدويًا أو ارفع نسخة أوضح.</Alert>}
        <div className="form-grid">
          <Field label="رقم المستند" hint={conf('doc_number')}><input className={cls('doc_number')} value={v.doc_number} onChange={(e) => setV({ ...v, doc_number: e.target.value })} style={{ direction: 'ltr' }} /></Field>
          <Field label="نقطة التحميل" hint={conf('loading_point_id')}><select className={cls('loading_point_id')} value={v.loading_point_id} onChange={(e) => setV({ ...v, loading_point_id: e.target.value })}>
            <option value="">—</option>{lookups?.loading_points.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</select></Field>
          <Field label="نوع الوقود" hint={conf('product')}><select className={cls('product')} value={v.product} onChange={(e) => setV({ ...v, product: e.target.value })}>
            <option value="">—</option>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="الكمية المصرح بها (لتر)" hint={conf('quantity_liters')}><input className={cls('quantity_liters')} type="number" value={v.quantity_liters} onChange={(e) => setV({ ...v, quantity_liters: e.target.value })} /></Field>
          <Field label="تاريخ الإصدار" hint={conf('issue_date')}><input className={cls('issue_date')} type="date" value={v.issue_date} onChange={(e) => setV({ ...v, issue_date: e.target.value })} /></Field>
          <Field label="صالح حتى" hint={conf('expiry_date')}><input className={cls('expiry_date')} type="date" value={v.expiry_date} onChange={(e) => setV({ ...v, expiry_date: e.target.value })} /></Field>
        </div>
        <div className="small muted">الحقول المظللة تحتاج مراجعة. يُسجَّل اعتمادك ووقته وأي تعديل على القيم المستخرجة.</div>
        <button className="btn primary" onClick={approve} disabled={busy}><FileCheck2 size={16} /> اعتماد بيانات المستند</button>
      </div>
    </div>
  );
}

export function NewOrder() {
  const lookups = useApi('/lookups').data;
  const org = useApi('/org').data;
  const docs = useApi('/documents');
  const [step, setStep] = useState('doc');
  const [doc, setDoc] = useState(null);
  const [pending, setPending] = useState(null);
  const [del, setDel] = useState({ date: today(1), window_start: '07:00', window_end: '15:00', fuel_price_per_liter: '1.66', stops: [{ site_id: '', mode: 'tank', tank_id: '', quantity_liters: '' }] });
  const [offers, setOffers] = useState(null);
  const [offer, setOffer] = useState(null);
  const [busy, setBusy] = useState(false);
  const idem = useMemo(() => opId(), []);
  const approved = (docs.data || []).filter((d) => d.status === 'approved' && d.quantities?.available_ml > 0);
  const total = del.stops.reduce((s, x) => s + Number(x.quantity_liters || 0), 0);
  const site0 = org?.sites.find((s) => s.id === del.stops[0].site_id);

  async function upload(file) {
    const fd = new FormData(); fd.append('file', file); setBusy(true);
    try { setPending(await api('/documents', { method: 'POST', form: fd })); docs.reload(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function search() {
    if (!del.stops.every((s) => s.site_id && Number(s.quantity_liters) > 0 && (s.mode === 'direct' || s.tank_id))) return fail('أكمل بيانات كل نقطة تسليم');
    if (total * 1000 > doc.quantities.available_ml) return fail(`الكمية تتجاوز المتاح في المستند (${liters(doc.quantities.available_ml)} لتر)`);
    setBusy(true); setOffers(null);
    try {
      const qs = new URLSearchParams({ loading_point_id: doc.loading_point_id, city: site0.city, product: doc.product, quantity_liters: total, date: del.date, window_start: del.window_start, window_end: del.window_end, project_id: site0.project_id || '' });
      setOffers(await api('/market/search?' + qs)); setStep('carrier');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true);
    try {
      const r = await api('/orders', { method: 'POST', body: { route_price_id: offer.route_price_id, contract_rate_id: offer.contract_rate_id, package_id: offer.package_id, project_id: site0?.project_id, aramco_document_id: doc.id, ...del, idempotency_key: idem } });
      toast(`أُرسل الطلب ${r.order_number || ''} للناقل`); navigate('/trips/' + r.trip_id);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const setStop = (i, patch) => setDel({ ...del, stops: del.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const done = STEPS.slice(0, STEPS.findIndex((s) => s.key === step)).map((s) => s.key);

  return (
    <>
      <Title sub="نقل وقود بطلب أرامكو مرفوع من العميل">طلب نقل جديد</Title>
      <div className="card mb" style={{ padding: '16px 16px 10px' }}><Steps steps={STEPS} current={step} done={done} /></div>

      {step === 'doc' && (
        pending && pending.status !== 'approved' ? (
          <Card title={`مراجعة البيانات المستخرجة — ${pending.original_name}`} actions={<button className="btn sm" onClick={() => setPending(null)}>رجوع</button>}>
            <DocumentReview doc={pending} lookups={lookups} onApproved={(d) => { docs.reload(); setDoc(d); setPending(null); setStep('delivery'); }} />
          </Card>
        ) : (
          <div className="grid g2">
            <Card title="مستند معتمد بكمية متاحة" flush>
              {docs.loading ? <Spinner /> : approved.length ? <table className="t"><tbody>{approved.map((d) => (
                <tr key={d.id} className="click" onClick={() => { setDoc(d); setStep('delivery'); }}>
                  <td><b className="num">{d.doc_number}</b><div className="small muted">{d.loading_point_name} · {PRODUCTS[d.product]}</div></td>
                  <td style={{ width: '40%' }}><Meter value={d.quantities.committed_ml} max={d.authorized_ml} /><div className="tiny muted" style={{ marginTop: 4 }}>متاح {liters(d.quantities.available_ml)} من {liters(d.authorized_ml)} لتر</div></td>
                  <td><button className="btn sm">اختيار</button></td></tr>
              ))}</tbody></table> : <Empty>لا توجد مستندات معتمدة بكمية متاحة</Empty>}
            </Card>
            <Card title="رفع مستند أرامكو جديد">
              <label className="scan" style={{ display: 'block', cursor: 'pointer' }}>
                <Upload size={36} color="var(--brand)" />
                <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>{busy ? 'جارٍ الفحص والاستخراج…' : 'اختر ملف PDF (عادي أو ممسوح ضوئيًا)'}</div>
                <div className="small muted">يُفحص نوع الملف، ثم تُستخرج البيانات وتعرض بجانب الملف للمراجعة. لا يُكشف المستند للناقل قبل قبول الرحلة.</div>
                <input type="file" accept="application/pdf" hidden onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
              </label>
              <div className="row mt small"><span className="muted">لا يوجد مستند للتجربة؟</span><a className="btn sm" href={`/api/demo/sample-aramco.pdf?liters=20000&token=${auth.token}`}>تنزيل مستند أرامكو تجريبي (20,000 لتر)</a></div>
            </Card>
          </div>
        )
      )}

      {step === 'delivery' && doc && (
        <Card title="تفاصيل التسليم" actions={<Chip tone="info">{doc.doc_number} · متاح {liters(doc.quantities?.available_ml)} لتر {PRODUCTS[doc.product]}</Chip>}>
          <div className="form-grid">
            <Field label="تاريخ التسليم"><input type="date" className="input" value={del.date} min={today()} onChange={(e) => setDel({ ...del, date: e.target.value })} /></Field>
            <Field label="بداية النافذة"><input type="time" className="input" value={del.window_start} onChange={(e) => setDel({ ...del, window_start: e.target.value })} /></Field>
            <Field label="نهاية النافذة"><input type="time" className="input" value={del.window_end} onChange={(e) => setDel({ ...del, window_end: e.target.value })} /></Field>
            <Field label="سعر لتر الوقود (ر.س)" hint="لاحتساب تكلفة الصرف. اتركه فارغًا إن لم يكن معلومًا وستظهر التكلفة «غير متوفرة»"><input type="number" step="0.01" className="input" value={del.fuel_price_per_liter} onChange={(e) => setDel({ ...del, fuel_price_per_liter: e.target.value })} /></Field>
          </div>
          <h4 className="mt" style={{ marginBottom: 10 }}>نقاط التسليم</h4>
          <div className="stack">
            {del.stops.map((s, i) => {
              const tanks = (org?.tanks || []).filter((t) => t.site_id === s.site_id && t.product === doc.product);
              const site = org?.sites.find((x) => x.id === s.site_id);
              return (
                <div key={i} className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
                  <div className="form-grid">
                    <Field label={`الموقع ${i + 1}`}><select className="input" value={s.site_id} onChange={(e) => setStop(i, { site_id: e.target.value, tank_id: '' })}>
                      <option value="">اختر…</option>{(org?.sites || []).map((x) => <option key={x.id} value={x.id}>{x.name} — {x.city}</option>)}</select></Field>
                    <Field label="طريقة التسليم"><select className="input" value={s.mode} onChange={(e) => setStop(i, { mode: e.target.value })}>
                      <option value="tank">إلى خزان الموقع</option><option value="direct">تزويد مباشر للمعدات</option></select></Field>
                    {s.mode === 'tank' && <Field label="الخزان"><select className="input" value={s.tank_id} onChange={(e) => setStop(i, { tank_id: e.target.value })}>
                      <option value="">اختر…</option>{tanks.map((t) => <option key={t.id} value={t.id}>{t.code} — فراغ {liters(t.capacity_ml - t.book_ml)} لتر</option>)}</select></Field>}
                    <Field label="الكمية (لتر)"><input type="number" className="input" value={s.quantity_liters} onChange={(e) => setStop(i, { quantity_liters: e.target.value })} /></Field>
                    <Field label="المستلم" hint={site?.receiver_phone}><input className="input" placeholder={site?.receiver_name || ''} value={s.receiver_name || ''} onChange={(e) => setStop(i, { receiver_name: e.target.value })} /></Field>
                    <Field label="تعليمات الدخول"><input className="input" placeholder={site?.access_notes || ''} value={s.access_notes || ''} onChange={(e) => setStop(i, { access_notes: e.target.value })} /></Field>
                  </div>
                  {s.mode === 'direct' && <div className="small muted" style={{ marginTop: 8 }}>التزويد المباشر: تُنشأ دفعة مخصصة عند وصول الصهريج، وتُخصم منها تعبئات المعدات عبر NFC ولا تدخل خزان الموقع.</div>}
                  {del.stops.length > 1 && <button className="btn sm danger" style={{ marginTop: 8 }} onClick={() => setDel({ ...del, stops: del.stops.filter((_, j) => j !== i) })}><Trash2 size={14} /> حذف</button>}
                </div>
              );
            })}
          </div>
          <div className="row mt">
            <button className="btn" onClick={() => setDel({ ...del, stops: [...del.stops, { site_id: '', mode: 'tank', tank_id: '', quantity_liters: '' }] })}><Plus size={15} /> نقطة تسليم أخرى</button>
            <div className="grow" />
            <span className="muted">الإجمالي <b className="num">{n(total)}</b> لتر</span>
            <button className="btn" onClick={() => setStep('doc')}>رجوع</button>
            <button className="btn primary" onClick={search} disabled={busy}><Search size={16} /> ابحث عن ناقلين</button>
          </div>
        </Card>
      )}

      {step === 'carrier' && offers && (
        <Card title={`الناقلون المؤهلون — ${doc.loading_point_name || ''} ← ${site0?.city} · ${n(total)} لتر · ${dOnly(del.date + 'T12:00:00Z')}`}
          actions={<button className="btn sm" onClick={() => setStep('delivery')}>تعديل التسليم</button>}>
          {offers.length === 0 ? <Empty>لا يوجد ناقل يغطي هذا المسار والمنتج</Empty> : (
            <div className="stack">{offers.map((o) => (
              <div key={o.route_price_id || o.contract_rate_id || o.package_id} className={'offer' + (offer === o ? ' sel' : '') + (!o.available ? ' na' : '')}>
                <div>
                  <div className="row"><Truck size={18} color="var(--ink-3)" /><b>{o.carrier_name}</b>{o.kind === 'contract' && <Chip tone="info">سعر العقد {o.contract_number}</Chip>}{o.kind === 'package' && <Chip tone="brand">باقة {o.package_number} · متوافر {o.package_balance.project_available}</Chip>}{o.available ? <Chip tone="good">متاح</Chip> : <Chip tone="bad">{o.blocked_reasons?.[0] || 'غير متاح في الموعد'}</Chip>}</div>
                  <div className="small muted" style={{ marginTop: 4 }}>{o.available_vehicles} صهريج مؤهل (حتى {n(o.best_vehicle_capacity_liters)} لتر) · {o.available_drivers} سائق متاح</div>
                </div>
                <div className="small">
                  <div className="row"><Star size={14} color="var(--warn)" /> {o.performance.on_time_pct == null ? <span className="muted">لا توجد عينة أداء على المسار</span> : <span><b className="num">{o.performance.on_time_pct}%</b> في الموعد</span>}</div>
                  <div className="muted tiny">عينة المسار: {o.performance.route_sample} رحلة · إجمالي {o.performance.total_trips}</div>
                </div>
                <div className="small">
                  <div className="price-big"><span className="num">{sar(o.quote.total_halalas)}</span> <span className="small muted">ر.س</span></div>
                  {o.kind === 'package' ? <div className="tiny muted">{o.quote.note}</div> : <div className="tiny muted">أجرة {sar(o.quote.base_halalas)} {o.quote.pricing_type === 'per_1000l' ? `(${sar(o.quote.unit_price_halalas)}/1000 لتر)` : '(سعر ثابت للمسار)'} + خدمة {o.quote.platform_commission_pct}% + ض.ق.م {sar(o.quote.vat_halalas)}</div>}
                  <div className="tiny muted">انتظار {sar(o.quote.terms.waiting_fee_halalas_per_hour)}/س بعد {o.quote.terms.free_waiting_hours} س · إلغاء {sar(o.quote.terms.cancel_fee_halalas)}</div>
                </div>
                <button className={'btn ' + (offer === o ? 'primary' : '')} disabled={!o.available} onClick={() => { setOffer(o); setStep('review'); }}>اختيار</button>
              </div>
            ))}</div>
          )}
        </Card>
      )}

      {step === 'review' && offer && (
        <Card title="مراجعة الطلب">
          <div className="grid g2">
            <dl className="kv">
              <dt>المستند</dt><dd className="num">{doc.doc_number}</dd>
              <dt>المنتج</dt><dd>{PRODUCTS[doc.product]}</dd>
              <dt>نقطة التحميل</dt><dd>{doc.loading_point_name}</dd>
              <dt>الموعد</dt><dd>{del.date} · {del.window_start} – {del.window_end}</dd>
              <dt>التسليم</dt><dd>{del.stops.map((s, i) => <div key={i}>{org.sites.find((x) => x.id === s.site_id)?.name} — <span className="num">{n(s.quantity_liters)}</span> لتر ({s.mode === 'tank' ? 'خزان ' + (org.tanks.find((t) => t.id === s.tank_id)?.code || '') : 'تزويد مباشر'})</div>)}</dd>
            </dl>
            <dl className="kv">
              <dt>الناقل</dt><dd>{offer.carrier_name} {offer.kind === 'contract' && <Chip tone="info">عقد {offer.contract_number}</Chip>}{offer.kind === 'package' && <Chip tone="brand">باقة {offer.package_number}</Chip>}</dd>
              <dt>أجرة النقل</dt><dd><span className="num">{sar(offer.quote.base_halalas)}</span> ر.س</dd>
              <dt>رسوم الخدمة</dt><dd><span className="num">{sar(offer.quote.platform_fee_halalas)}</span> ر.س</dd>
              <dt>ض.ق.م 15%</dt><dd><span className="num">{sar(offer.quote.vat_halalas)}</span> ر.س</dd>
              <dt>الإجمالي</dt><dd className="price-big"><span className="num">{sar(offer.quote.total_halalas)}</span> ر.س</dd>
              <dt>مهلة رد الناقل</dt><dd>{offer.quote.terms.accept_within_minutes} دقيقة</dd>
            </dl>
          </div>
          <Alert tone="info">يُحفظ السعر وشروط الانتظار والإلغاء كنسخة متفق عليها. يرى الناقل ملخصًا للتسعير، وتُكشف تفاصيل المستند والمستلم بعد قبوله فقط.</Alert>
          <div className="row mt"><div className="grow" /><button className="btn" onClick={() => setStep('carrier')}>رجوع</button>
            <button className="btn primary lg" onClick={submit} disabled={busy}><CheckCircle2 size={18} /> اعتماد السعر وإرسال الطلب</button></div>
        </Card>
      )}
    </>
  );
}

export function Documents() {
  const docs = useApi('/documents');
  return (
    <>
      <Title>مستندات أرامكو</Title>
      <Card flush>{docs.loading ? <Spinner /> : <div className="tscroll"><table className="t">
        <thead><tr><th>الرقم</th><th>نقطة التحميل</th><th>المنتج</th><th>المصرح</th><th>المحجوز</th><th>المحمل</th><th>المسلّم</th><th>الملغى</th><th>المتاح</th><th>الحالة</th></tr></thead>
        <tbody>{docs.data.map((d) => <tr key={d.id}><td className="num">{d.doc_number || '—'}</td><td>{d.loading_point_name}</td><td>{PRODUCTS[d.product]}</td>
          {['authorized_ml', 'reserved_ml', 'loaded_ml', 'delivered_ml', 'cancelled_ml', 'available_ml'].map((k) => <td key={k} className="num">{d.quantities ? liters(d.quantities[k]) : '—'}</td>)}
          <td><Chip tone={d.status === 'approved' ? 'good' : 'warn'}>{d.status === 'approved' ? 'معتمد' : 'قيد المراجعة'}</Chip>{d.duplicate_of && <Chip tone="bad">مكرر</Chip>}</td></tr>)}</tbody></table></div>}</Card>
    </>
  );
}
