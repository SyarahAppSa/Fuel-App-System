import React, { useState } from 'react';
import { Plus, Upload, Printer, Download, ArrowLeftRight, Nfc, Gauge, Fuel, Wallet, Clock, Hash } from 'lucide-react';
import { api, useApi, navigate, liters, sar, n, dt, dOnly, fail, toast, auth, PRODUCTS, CATEGORY, VERIFY, TAG_TONE } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Kpi, Alert } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

function AssetForm({ org, asset, onClose, onDone }) {
  const [v, setV] = useState(asset ? { ...asset, tank_capacity_liters: asset.tank_capacity_ml / 1000 || '', per_tx_limit_liters: asset.per_tx_limit_ml / 1000 || '', daily_limit_liters: asset.daily_limit_ml / 1000 || '', monthly_limit_liters: asset.monthly_limit_ml / 1000 || '' }
    : { category: 'heavy_equipment', fuel_type: 'diesel', meter_type: 'hours', status: 'active' });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => { try { await api(asset ? '/assets/' + asset.id : '/assets', { method: asset ? 'PUT' : 'POST', body: v }); toast('تم الحفظ'); onDone(); } catch (e) { fail(e); } };
  return (
    <Modal title={asset ? 'تعديل الأصل' : 'إضافة أصل'} onClose={onClose} wide footer={<><button className="btn primary" onClick={save}>حفظ</button><button className="btn" onClick={onClose}>إلغاء</button></>}>
      <div className="form-grid">
        <Field label="الرقم الداخلي"><input className="input" value={v.code || ''} onChange={set('code')} /></Field>
        <Field label="الاسم"><input className="input" value={v.name || ''} onChange={set('name')} /></Field>
        <Field label="التصنيف"><select className="input" value={v.category} onChange={set('category')}>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="نوع الوقود المسموح"><select className="input" value={v.fuel_type} onChange={set('fuel_type')}>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="اللوحة / الرقم التسلسلي"><input className="input" value={v.plate_or_serial || ''} onChange={set('plate_or_serial')} /></Field>
        <Field label="العداد"><select className="input" value={v.meter_type} onChange={set('meter_type')}><option value="hours">ساعات تشغيل</option><option value="km">كيلومترات</option><option value="none">بدون</option></select></Field>
        {!asset && <>
          <Field label="الموقع"><select className="input" value={v.site_id || ''} onChange={(e) => { const s = org.sites.find((x) => x.id === e.target.value); setV({ ...v, site_id: e.target.value, project_id: s?.project_id }); }}><option value="">—</option>{org.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="مركز التكلفة"><select className="input" value={v.cost_center_id || ''} onChange={set('cost_center_id')}><option value="">—</option>{org.cost_centers.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>
        </>}
        <Field label="سعة خزان الأصل (لتر)"><input type="number" className="input" value={v.tank_capacity_liters || ''} onChange={set('tank_capacity_liters')} /></Field>
        <Field label="سقف العملية (لتر)"><input type="number" className="input" value={v.per_tx_limit_liters || ''} onChange={set('per_tx_limit_liters')} /></Field>
        <Field label="السقف اليومي (لتر)"><input type="number" className="input" value={v.daily_limit_liters || ''} onChange={set('daily_limit_liters')} /></Field>
        <Field label="السقف الشهري (لتر)"><input type="number" className="input" value={v.monthly_limit_liters || ''} onChange={set('monthly_limit_liters')} /></Field>
        {asset && <Field label="الحالة"><select className="input" value={v.status} onChange={set('status')}><option value="active">نشط</option><option value="maintenance">صيانة</option><option value="inactive">غير نشط</option></select></Field>}
      </div>
    </Modal>
  );
}

const TEMPLATE = 'code,name,category,fuel_type,plate_or_serial,project_code,site_name,cost_center_code,meter_type,per_tx_limit_liters,daily_limit_liters\nEX-200-10,حفار 200,معدة ثقيلة,ديزل,SN-0001,PRJ-101,موقع الخرج - كيلو 42,CC-410,ساعات,500,900\n';
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...rest] = rows.filter((r) => r.some((x) => x.trim()));
  return rest.map((r) => Object.fromEntries(h.map((k, i) => [k.replace(/^﻿/, '').trim(), (r[i] || '').trim()])));
}
function ImportModal({ onClose, onDone }) {
  const [rows, setRows] = useState(null); const [res, setRes] = useState(null);
  const preview = async (r) => { setRows(r); try { setRes(await api('/assets/import', { method: 'POST', body: { rows: r } })); } catch (e) { fail(e); } };
  const commit = async () => { try { const x = await api('/assets/import', { method: 'POST', body: { rows, commit: true } }); toast(`استُورد ${x.committed} أصل`); onDone(); } catch (e) { fail(e); } };
  const errCsv = () => { const blob = new Blob(['﻿' + 'الصف,الأخطاء\n' + res.errors.map((e) => `${e.row},"${e.errors.join('؛ ')}"`).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'import-errors.csv'; a.click(); };
  return (
    <Modal title="استيراد الأصول من Excel/CSV" onClose={onClose} wide footer={res && <><button className="btn primary" disabled={!res.valid} onClick={commit}>استيراد {res.valid} صف صالح</button>{res.errors.length > 0 && <button className="btn" onClick={errCsv}><Download size={15} /> تقرير الأخطاء</button>}</>}>
      <div className="row mb">
        <a className="btn sm" href={URL.createObjectURL(new Blob(['﻿' + TEMPLATE], { type: 'text/csv' }))} download="fuelapp-assets-template.csv"><Download size={14} /> النموذج الجاهز</a>
        <label className="btn sm primary"><Upload size={14} /> اختر ملف CSV<input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) preview(parseCsv(await f.text())); }} /></label>
        <span className="small muted">احفظ ملف Excel بصيغة CSV UTF-8. صحح الأخطاء وأعد رفع الصفوف المرفوضة فقط.</span>
      </div>
      {res && <>
        <div className="row mb"><Chip>الإجمالي {res.total}</Chip><Chip tone="good">صالح {res.valid}</Chip><Chip tone={res.errors.length ? 'bad' : ''}>أخطاء {res.errors.length}</Chip></div>
        {res.errors.length > 0 && <table className="t"><thead><tr><th>الصف</th><th>الرقم</th><th>الأخطاء</th></tr></thead><tbody>{res.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.data.code}</td><td style={{ color: 'var(--bad)' }}>{e.errors.join('، ')}</td></tr>)}</tbody></table>}
      </>}
    </Modal>
  );
}

export function AssetList() {
  const me = useMe();
  const [f, setF] = useState({ q: '', project_id: '', category: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const r = useApi('/assets?' + qs, [qs]);
  const org = useApi('/org').data;
  const [modal, setModal] = useState(null);
  return (
    <>
      <Title sub="سجل المعدات والمركبات والمولدات وحالة الشرائح">المعدات والمركبات</Title>
      <div className="filters">
        <input className="input" placeholder="بحث بالرقم أو الاسم أو اللوحة" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        {!me.scope_project_id && <select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">كل المشاريع</option>{org?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select>}
        <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">كل التصنيفات</option>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="grow" />
        {can(me, 'asset.manage') && <><button className="btn" onClick={() => setModal('import')}><Upload size={15} /> استيراد</button><button className="btn primary" onClick={() => setModal('add')}><Plus size={15} /> إضافة أصل</button></>}
      </div>
      <Card flush>{r.loading ? <Spinner /> : !r.data.length ? <Empty /> : <div className="tscroll"><table className="t">
        <thead><tr><th>الأصل</th><th>التصنيف</th><th>المشروع / الموقع</th><th>الشريحة</th><th>آخر تزويد</th><th>آخر قراءة</th><th>آخر 30 يومًا</th><th>الحالة</th></tr></thead>
        <tbody>{r.data.map((a) => (
          <tr key={a.id} className="click" onClick={() => navigate('/assets/' + a.id)}>
            <td><b>{a.code}</b><div className="small muted">{a.name} · {a.plate_or_serial}</div></td>
            <td>{CATEGORY[a.category]}<div className="tiny muted">{PRODUCTS[a.fuel_type]}</div></td>
            <td className="small">{a.project_code}<div className="tiny muted">{a.site_name}</div></td>
            <td>{a.tag_display_no ? <Chip tone="good"><Nfc size={12} /> {a.tag_display_no}</Chip> : a.tag_pending ? <Chip tone="info">بانتظار التفعيل</Chip> : <Chip tone="warn">بدون شريحة</Chip>}</td>
            <td className="small">{dt(a.last_fueling_at)}</td>
            <td className="num small">{a.last_meter != null ? n(a.last_meter, 1) + (a.meter_type === 'km' ? ' كم' : ' س') : '—'}</td>
            <td><span className="num">{liters(a.month_ml)}</span> لتر</td>
            <td><Chip tone={a.status === 'active' ? 'good' : 'warn'}>{{ active: 'نشط', maintenance: 'صيانة', inactive: 'غير نشط' }[a.status]}</Chip></td>
          </tr>))}</tbody></table></div>}</Card>
      {modal === 'add' && org && <AssetForm org={org} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
    </>
  );
}

function SourceChain({ r }) {
  if (r.source_type === 'batch') {
    const s = r.source_chain[0] || {};
    return <div className="chain"><span className="chip brand">تزويد مباشر</span>← <span className="lnk">رحلة {s.trip_number}</span>← <span className="lnk">طلب {s.order_number}</span>{s.doc_number && <>← <span className="lnk">مستند {s.doc_number}</span></>}</div>;
  }
  return (
    <div className="chain"><span className="chip info">خزان {r.tank_code}</span>
      {r.source_chain.length ? <>← {r.source_chain.slice(0, 2).map((c, i) => <span key={i} className="lnk" title={c.carrier_name || ''}>{c.kind === 'opening' ? 'رصيد افتتاحي' : c.kind === 'transfer_in' ? 'تحويل وارد' : `استلام ${c.trip_number}${c.doc_number ? ' · ' + c.doc_number : ''}`}</span>)}<span className="tiny muted">(متوسط مرجّح)</span></> : null}
    </div>
  );
}

export function AssetReport({ id }) {
  const me = useMe();
  const [f, setF] = useState({ from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const r = useApi(`/reports/asset/${id}?${qs}`, [qs]);
  const org = useApi('/org').data;
  const [modal, setModal] = useState(null);
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!r.data) return <Spinner />;
  const { asset: a, rows, totals, assignments, tag_history } = r.data;
  const showCost = can(me, 'price.view', 'finance.view');
  const move = async (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await api(`/assets/${a.id}/move`, { method: 'POST', body: fd }); toast('نُقل الأصل. العمليات السابقة تبقى على مشروعها'); setModal(null); r.reload(); } catch (err) { fail(err); } };
  return (
    <>
      <Title sub="بطاقة الأصل وسجل التزويد بكامل سلسلة المصدر">{a.code} — {a.name}</Title>
      <div className="grid g-main">
        <div className="asset-card">
          <div className="row"><div className="grow"><div className="muted small">{CATEGORY[a.category]} · {PRODUCTS[a.fuel_type]}</div><h2 style={{ fontSize: 24, margin: '4px 0' }}>{a.name}</h2>
            <div className="muted">{a.code} · {a.plate_or_serial}</div></div>
            {a.tag_display_no ? <Chip tone="good"><Nfc size={13} /> {a.tag_display_no}</Chip> : <Chip tone="warn">بدون شريحة نشطة</Chip>}</div>
          <div className="grid g4 mt" style={{ gap: 10 }}>
            {[['المشروع', `${a.project_code} ${a.project_name}`], ['الموقع', a.site_name], ['مركز التكلفة', `${a.cost_center_code} ${a.cost_center_name || ''}`], ['الحدود', `${liters(a.per_tx_limit_ml)} / عملية · ${liters(a.daily_limit_ml)} / يوم`]].map(([k, v]) => <div key={k}><div className="muted tiny">{k}</div><div className="small" style={{ fontWeight: 600 }}>{v}</div></div>)}
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row"><label className="field grow"><span>من</span><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label><label className="field grow"><span>إلى</span><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label></div>
            <div className="row no-print">
              <button className="btn sm" onClick={() => print()}><Printer size={14} /> طباعة / PDF</button>
              <a className="btn sm" href={`/api/reports/fuelings.csv?asset_id=${a.id}&${qs}&token=${auth.token}`}><Download size={14} /> Excel/CSV</a>
              {can(me, 'asset.manage') && <button className="btn sm" onClick={() => setModal('move')}><ArrowLeftRight size={14} /> نقل لمشروع</button>}
              {can(me, 'asset.manage') && <button className="btn sm" onClick={() => setModal('edit')}>تعديل</button>}
            </div>
            <div className="tiny muted">آخر تحديث {dt(r.data.generated_at)}</div>
          </div>
        </div>
      </div>
      <div className="grid g4 mt">
        <Kpi icon={Fuel} label="إجمالي اللترات" value={liters(totals.liters_ml)} unit="لتر" foot={`${totals.count} عملية معتمدة`} />
        {showCost ? <Kpi icon={Wallet} label="التكلفة" value={totals.cost_halalas == null ? 'غير متوفرة' : sar(totals.cost_halalas)} unit={totals.cost_halalas == null ? '' : 'ر.س'} foot={totals.cost_halalas == null ? `جزئي معلوم: ${sar(totals.cost_partial_halalas)} ر.س` : 'وقود + نصيب أجرة النقل'} /> : <Kpi icon={Wallet} label="التكلفة" value="—" foot="غير متاحة لدورك" />}
        <Kpi icon={Gauge} label="معدل الاستهلاك" value={totals.rate ? n(totals.rate.value, 2) : 'بيانات غير كافية'} unit={totals.rate?.unit} foot={totals.rate ? `من ${totals.rate.readings} قراءات صالحة على ${n(totals.rate.span, 1)} ${a.meter_type === 'km' ? 'كم' : 'ساعة'}` : 'يلزم قراءتا عداد صالحتان ضمن الفترة'} />
        <Kpi icon={Clock} label="آخر تزويد" value={totals.last_fueling_at ? dOnly(totals.last_fueling_at) : '—'} foot={totals.last_meter != null ? `آخر قراءة ${n(totals.last_meter, 1)} ${a.meter_type === 'km' ? 'كم' : 'ساعة'}` : ''} />
      </div>

      <Card className="mt" title="سجل التزويد: من زوّدها، متى، كم، ومن أين" flush>
        {!rows.length ? <Empty>لا توجد عمليات في الفترة</Empty> : <div className="tscroll"><table className="t">
          <thead><tr><th>العملية</th><th>الوقت</th><th>اللترات</th><th>المصدر ← الرحلة ← الطلب ← المستند</th><th>المشروع وقت التنفيذ</th>{showCost && <th>التكلفة</th>}<th>العداد</th><th>المشغّل</th><th>التحقق</th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id} className="click" onClick={() => navigate('/fuelings/' + x.id)} style={x.status !== 'approved' ? { opacity: 0.55 } : null}>
              <td><b className="num">{x.number}</b>{x.corrects_number && <div className="tiny" style={{ color: 'var(--warn)' }}>تصحيح لـ {x.corrects_number}</div>}{x.status === 'rejected' && <div className="tiny" style={{ color: 'var(--bad)' }}>مرفوضة</div>}</td>
              <td className="small">{dt(x.created_at)}</td>
              <td><b className="num" style={{ color: x.quantity_ml < 0 ? 'var(--bad)' : undefined }}>{liters(x.quantity_ml, 1)}</b></td>
              <td><SourceChain r={x} /></td>
              <td className="small">{x.project_code}<div className="tiny muted">{x.cost_center_code}</div></td>
              {showCost && <td className="num small">{x.cost_halalas == null ? <Chip tone="warn">غير متوفرة</Chip> : sar(x.cost_halalas)}</td>}
              <td className="num small">{x.meter_value != null ? n(x.meter_value, 1) : '—'}</td>
              <td className="small">{x.operator_name}</td>
              <td><Chip tone={x.verification === 'nfc' ? 'good' : 'warn'}>{VERIFY[x.verification]}</Chip>{x.exception_flag && x.exception_flag !== 'correction' && <div className="tiny muted">{x.exception_flag}</div>}</td>
            </tr>))}</tbody></table></div>}
      </Card>
      <div className="grid g2 mt">
        <Card title="سجل النقل بين المشاريع">{assignments.map((x) => <div key={x.id} className="small" style={{ marginBottom: 6 }}><b>{x.project_name}</b> · من {dOnly(x.effective_from)}<span className="muted"> · {x.by_name}</span></div>)}</Card>
        <Card title="سجل الشريحة">{tag_history.length ? tag_history.map((x) => <div key={x.id} className="small" style={{ marginBottom: 6 }}><Chip tone={x.action === 'rejected' ? 'bad' : ''}>{x.action}</Chip> {x.display_no} {x.reason && `— ${x.reason}`}<span className="tiny muted"> · {dt(x.at)} {x.by_name}</span></div>) : <Empty />}</Card>
      </div>
      {modal === 'move' && org && (
        <Modal title="نقل الأصل لمشروع/موقع آخر" onClose={() => setModal(null)}>
          <form onSubmit={move} className="stack">
            <Field label="الموقع الجديد"><select name="site_id" className="input" required>{org.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="مركز التكلفة"><select name="cost_center_id" className="input"><option value="">بدون تغيير</option>{org.cost_centers.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>
            <Field label="تاريخ النفاذ"><input name="effective_from" type="date" className="input" /></Field>
            <Alert tone="info">تبقى العمليات السابقة مسجلة على المشروع ومركز التكلفة وقت تنفيذها.</Alert>
            <button className="btn primary">نقل</button>
          </form>
        </Modal>
      )}
      {modal === 'edit' && org && <AssetForm org={org} asset={a} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
    </>
  );
}
