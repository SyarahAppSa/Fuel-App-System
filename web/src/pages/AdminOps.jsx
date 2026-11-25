import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Clock, FileWarning, Scale, Truck, Building2, Users, Container, Fuel, Wallet, ClipboardList, Search, Download, Printer, ArrowRight, ExternalLink, UserCheck, Info, FileText, ShieldCheck,
} from 'lucide-react';
import { api, useApi, navigate, query, auth, n, dt, dOnly, ago, fail, toast, PRODUCTS } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Alert } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

/* ------------------------------------------------------------------ */
/* أدوات مشتركة                                                         */
/* ------------------------------------------------------------------ */
const FKEYS = ['period', 'from', 'to', 'company_id', 'city', 'project_id', 'product'];
const curFilters = () => { const x = query(); const f = Object.fromEntries(FKEYS.map((k) => [k, x[k] || ''])); if (!f.period) f.period = 'month'; return f; };
const fqs = (f, extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v)).toString();
const SECTION_ICON = { orders: ClipboardList, trips: Truck, companies: Building2, drivers: Users, vehicles: Container, fuel: Fuel, finance: Wallet };
export const cellFmt = (v, t) => (v == null || v === '' ? '—' : t === 'l' ? n(v / 1000) : t === 'sar' ? n(v / 100, 2) : t === 'dt' ? dt(v) : t === 'prod' ? PRODUCTS[v] || v : v);
const valFmt = (m) => (m.value == null ? 'بيانات غير كافية' : typeof m.value === 'number' ? n(m.value, m.unit === 'ر.س' ? 2 : 0) : m.value);

export function FilterBar({ onChange, hideCompany }) {
  const f = curFilters();
  const opts = useApi('/admin/filters').data;
  const set = (patch) => { const nf = { ...f, ...patch }; navigate(location.pathname + '?' + fqs(nf), true); onChange?.(nf); };
  return (
    <div className="card" style={{ padding: 12, marginBottom: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 4, background: 'var(--surface-2)', borderRadius: 14, padding: 4 }}>
          {[['today', 'اليوم'], ['7d', 'آخر 7 أيام'], ['month', 'هذا الشهر'], ['all', 'الكل'], ['custom', 'فترة محددة']].map(([k, l]) => (
            <button key={k} className={'btn sm ' + (f.period === k ? 'primary' : 'ghost')} onClick={() => set({ period: k })}>{l}</button>))}
        </div>
        {f.period === 'custom' && <><input type="date" className="input" style={{ width: 'auto' }} value={f.from} onChange={(e) => set({ from: e.target.value })} /><span className="muted">←</span><input type="date" className="input" style={{ width: 'auto' }} value={f.to} onChange={(e) => set({ to: e.target.value })} /></>}
        {!hideCompany && <select className="input" style={{ width: 'auto', maxWidth: 230 }} value={f.company_id} onChange={(e) => set({ company_id: e.target.value })}><option value="">كل الشركات</option>
          {opts?.companies.map((c) => <option key={c.id} value={c.id}>{c.name_ar} · {{ client: 'عميل', carrier: 'ناقل', supplier: 'مورد' }[c.type]}</option>)}</select>}
        <select className="input" style={{ width: 'auto' }} value={f.city} onChange={(e) => set({ city: e.target.value })}><option value="">كل المناطق</option>{opts?.cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="input" style={{ width: 'auto', maxWidth: 220 }} value={f.project_id} onChange={(e) => set({ project_id: e.target.value })}><option value="">كل المشاريع</option>{opts?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.company_name}</option>)}</select>
        <select className="input" style={{ width: 'auto' }} value={f.product} onChange={(e) => set({ product: e.target.value })}><option value="">كل أنواع الوقود</option>{Object.entries(PRODUCTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {(f.company_id || f.city || f.project_id || f.product) && <button className="btn sm ghost" onClick={() => set({ company_id: '', city: '', project_id: '', product: '' })}>مسح الفلاتر</button>}
      </div>
    </div>
  );
}

function MetricTile({ m, f, extra }) {
  const go = () => navigate('/admin/records?' + fqs(f, { metric: m.key, ...extra }));
  return (
    <button className="card" onClick={go} title={m.def || 'اضغط لعرض السجلات التي كوّنت الرقم'}
      style={{ textAlign: 'start', padding: '12px 14px', cursor: 'pointer', border: '1px solid var(--line)', background: '#fff', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span className="small" style={{ color: 'var(--text-2)', fontWeight: 600 }}>{m.label}{m.def && <Info size={12} style={{ marginInlineStart: 4, color: 'var(--muted)' }} />}</span>
      <span style={{ fontSize: m.value == null ? 14 : 22, fontWeight: 800, color: m.tone && m.value ? `var(--${m.tone === 'bad' ? 'bad' : 'warn'})` : 'var(--ink)' }} className="num">{valFmt(m)}{m.unit && m.value != null && <small className="muted" style={{ fontSize: 12, fontWeight: 500 }}> {m.unit}</small>}</span>
      {m.state && <span className="tiny muted">حالة حالية</span>}
    </button>
  );
}

const ATT_ICON = { no_response: Clock, late_trip: Truck, variance: Scale, document: FileWarning };
const ATT_LABEL = { no_response: 'بلا رد ناقل', late_trip: 'رحلة متأخرة', variance: 'فرق كمية', document: 'وثيقة تنتهي' };

function FollowUpModal({ target, onClose, onDone }) {
  const opts = useApi('/admin/filters').data;
  const [v, setV] = useState({ assignee_user_id: '', note: '' });
  const save = async () => { try { await api('/admin/follow-ups', { method: 'POST', body: { ...target, ...v } }); toast('عُيّن المتابع وسُجّل الإجراء'); onDone(); } catch (e) { fail(e); } };
  return (
    <Modal title="تعيين متابعة" onClose={onClose} footer={<button className="btn primary" onClick={save}>تعيين</button>}>
      <div className="stack">
        <Field label="المتابع"><select className="input" value={v.assignee_user_id} onChange={(e) => setV({ ...v, assignee_user_id: e.target.value })}><option value="">أنا</option>{opts?.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="ملاحظة"><textarea className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        <div className="small muted">يُسجَّل الإجراء في سجل تدقيق الإدارة.</div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* الصفحة الرئيسية: مركز التشغيل                                         */
/* ------------------------------------------------------------------ */
export function AdminHome() {
  const me = useMe();
  const f = curFilters();
  const r = useApi('/admin/home?' + fqs(f), [fqs(f)]);
  const [fu, setFu] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const d = r.data;
  return (
    <>
      <Title sub={d ? `${d.period_ar} · آخر تحديث ${dt(d.generated_at)}` : ''}>مركز التشغيل</Title>
      <FilterBar />
      {!d ? <Spinner /> : (
        <div className="stack" style={{ gap: 16 }}>
          <Card title={`تحتاج تدخل (${d.attention.length})`} icon={<AlertTriangle size={18} color="var(--bad)" />} actions={<span className="tiny muted">لا تتقيد بالفترة — كل ما هو مفتوح الآن</span>} flush>
            {d.attention.length === 0 ? <Empty>لا شيء يحتاج تدخلًا الآن</Empty> : (
              <table className="t"><tbody>{(showAll ? d.attention : d.attention.slice(0, 8)).map((a, i) => { const I = ATT_ICON[a.kind];
                return (<tr key={i} className="click" onClick={() => a.link && navigate(a.link)}>
                  <td style={{ width: 130 }}><Chip tone={a.kind === 'document' ? (a.tone || 'warn') : a.kind === 'variance' ? 'warn' : 'bad'}><I size={13} /> {ATT_LABEL[a.kind]}</Chip></td>
                  <td><b className="small">{a.title}</b><div className="tiny muted">{a.sub}{a.since && ` · ${a.kind === 'document' ? dOnly(a.since) : ago(a.since)}`}</div></td>
                  <td className="small"><span className="muted">المسؤول: </span>{a.responsible}{a.follow_up && <div className="tiny"><UserCheck size={11} /> المتابع: {a.follow_up}</div>}</td>
                  <td>{can(me, 'platform.manage') && a.entity_type && <button className="btn sm" onClick={(e) => { e.stopPropagation(); setFu({ entity_type: a.entity_type, entity_id: a.entity_id }); }}>تعيين متابع</button>}</td>
                </tr>); })}</tbody></table>)}
            {d.attention.length > 8 && <div style={{ padding: 10, textAlign: 'center' }}><button className="btn sm ghost" onClick={() => setShowAll(!showAll)}>{showAll ? 'عرض أقل' : `عرض الكل (${d.attention.length})`}</button></div>}
          </Card>

          {d.sections.map((s) => { const I = SECTION_ICON[s.key]; return (
            <Card key={s.key} title={s.title} icon={<span className="kpi" style={{ padding: 0 }}><span className="ico" style={{ width: 34, height: 34 }}><I size={17} /></span></span>}
              actions={s.key === 'fuel' || s.key === 'finance' ? <span className="tiny muted">{s.key === 'fuel' ? 'لتر' : 'ر.س شاملة الضريبة للفواتير'}</span> : null}>
              {s.restricted ? <Alert tone="info">الأرقام المالية تتطلب صلاحية المالية.</Alert> : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: 10 }}>{s.metrics.map((m) => <MetricTile key={m.key} m={m} f={f} />)}</div>)}
              {s.key === 'companies' && !d.supply_connected && <div className="tiny muted mt">لا يوجد موردون مسجلون بعد.</div>}
              {s.key === 'vehicles' && (
                <table className="t mt"><thead><tr><th>الناقل</th><th>المنطقة</th><th>الصهاريج</th><th>السعة الإجمالية (لتر)</th><th>السعة المتاحة الآن</th></tr></thead>
                  <tbody>{d.capacity.map((c) => <tr key={c.id} className="click" onClick={() => navigate(`/admin/companies/${c.id}?` + fqs(f))}><td><b>{c.company}</b></td><td>{c.region}</td><td>{c.vehicles}</td><td className="num">{n(c.capacity_l)}</td><td className="num">{n(c.available_l)}</td></tr>)}</tbody></table>)}
            </Card>); })}
          <div className="tiny muted">تعريفات: الأرقام تُحسب من سجلات قاعدة البيانات مباشرة. الطلبات والرحلات والفواتير تُفلتر بتاريخ إنشائها ضمن الفترة؛ الشركات والسائقون والصهاريج والفروقات المفتوحة حالة حالية. مرّر المؤشر على أي رقم لتعريفه، واضغطه لفتح سجلاته.</div>
        </div>
      )}
      {fu && <FollowUpModal target={fu} onClose={() => setFu(null)} onDone={() => { setFu(null); r.reload(); }} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* قائمة السجلات وراء أي رقم                                             */
/* ------------------------------------------------------------------ */
export function RecordsTable({ columns, rows, onRow }) {
  return (
    <div className="tscroll"><table className="t">
      <thead><tr>{columns.map((c) => <th key={c[0]}>{c[1]}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id || i} className={r.link ? 'click' : ''} onClick={() => r.link && (onRow ? onRow(r) : navigate(r.link))}>
        {columns.map((c) => <td key={c[0]} className={['l', 'sar'].includes(c[2]) ? 'num' : ''} style={c[0] === 'responsible' ? { minWidth: 220, fontSize: 12 } : null}>{c[0] === 'status_ar' && r.late ? <Chip tone="bad">{r[c[0]]}</Chip> : cellFmt(r[c[0]], c[2])}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export function AdminRecords() {
  const me = useMe();
  const x = query(); const f = curFilters();
  const r = useApi('/admin/records?' + fqs(f, { metric: x.metric }), [fqs(f), x.metric]);
  const d = r.data;
  return (
    <>
      <Title sub="السجلات التي كوّنت الرقم بنفس الفلتر">{d ? `${d.label}` : 'السجلات'}</Title>
      <div className="row mb"><button className="btn sm" onClick={() => history.back()}><ArrowRight size={14} /> رجوع</button>
        {d && <><Chip tone="info">{d.entity_label}</Chip><b className="num" style={{ fontSize: 20 }}>{d.value == null ? 'بيانات غير كافية' : n(d.value, d.unit === 'ر.س' ? 2 : 0)}</b>{d.unit && <span className="muted">{d.unit}</span>}<span className="muted small">· {d.total} سجل</span></>}
        <div className="grow" />
        {d && can(me, 'platform.export') && <a className="btn sm primary" href={`/api/admin/records?${fqs(f, { metric: x.metric, format: 'xlsx' })}&token=${auth.token}`}><Download size={14} /> Excel</a>}
      </div>
      {d?.def && <div className="mb"><Alert tone="info">{d.def}</Alert></div>}
      <FilterBar />
      {r.error ? <Alert tone="bad">{r.error.message}</Alert> : !d ? <Spinner /> : <Card flush>{d.rows.length ? <RecordsTable columns={d.columns} rows={d.rows} /> : <Empty>لا توجد سجلات — العدد فعلًا صفر لهذا الفلتر</Empty>}</Card>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* الشركات                                                              */
/* ------------------------------------------------------------------ */
export function AdminCompanies() {
  const r = useApi('/admin/companies');
  const [type, setType] = useState('');
  const rows = (r.data || []).filter((c) => !type || c.type === type);
  return (
    <>
      <Title sub="صفحة مستقلة لكل شركة بأدائها وسجلاتها">الشركات</Title>
      <div className="tabs">{[['', 'الكل'], ['carrier', 'شركات النقل'], ['client', 'الشركات العميلة'], ['supplier', 'موردو الوقود']].map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l} ({(r.data || []).filter((c) => !k || c.type === k).length})</button>)}</div>
      <Card flush>{!r.data ? <Spinner /> : <RecordsTable columns={[['name_ar', 'الشركة'], ['type_ar', 'النوع'], ['city', 'المدينة'], ['status_ar', 'الحالة'], ['drivers', 'السائقون'], ['vehicles', 'الصهاريج'], ['pending_docs', 'وثائق معلقة']]} rows={rows} />}</Card>
    </>
  );
}

export function AdminCompany({ id }) {
  const me = useMe();
  const f = curFilters();
  const r = useApi(`/admin/companies/${id}?` + fqs(f), [fqs(f)]);
  const d = r.data;
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!d) return <Spinner />;
  const c = d.company;
  const exp = (fmt) => `/api/admin/companies/${id}/export?${fqs(f, { format: fmt })}&token=${auth.token}`;
  const fc = { ...f, company_id: id };
  return (
    <>
      <Title sub={`${{ client: 'شركة عميلة', carrier: 'شركة نقل', supplier: 'مورد وقود' }[c.type]} · ${d.period_ar}`}>{c.name_ar}</Title>
      <div className="row mb">
        <Chip tone={c.status === 'approved' ? 'good' : 'warn'}>{{ approved: 'مفعّلة', pending: 'تنتظر الاعتماد', suspended: 'موقوفة' }[c.status]}</Chip>
        <span className="small muted">{c.city} · س.ت {c.cr_number}</span><div className="grow" />
        {can(me, 'platform.export') && <><a className="btn sm primary" href={exp('xlsx')}><Download size={14} /> تقرير الشركة Excel</a><a className="btn sm" target="_blank" rel="noreferrer" href={exp('pdf')}><Printer size={14} /> PDF</a></>}
      </div>
      <FilterBar hideCompany />
      <div className="stack" style={{ gap: 14 }}>
        {d.groups.map((g) => (
          <Card key={g.title} title={g.title}><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10 }}>{g.metrics.map((m) => <MetricTile key={m.key} m={m} f={fc} />)}
            {g.title === 'الطلبات الواردة' && <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}><span className="small" style={{ fontWeight: 600, color: 'var(--text-2)' }}>التسليم في الموعد</span><span style={{ fontSize: 22, fontWeight: 800 }}>{d.on_time.pct == null ? 'بيانات غير كافية' : d.on_time.pct + '%'}</span><span className="tiny muted">عينة {d.on_time.sample} رحلة</span></div>}
              {g.title === 'الطلبات الواردة' && d.rating && <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}><span className="small" style={{ fontWeight: 600, color: 'var(--text-2)' }}>تقييم العملاء</span><span style={{ fontSize: 22, fontWeight: 800 }}>{d.rating.overall == null ? 'لا توجد تقييمات' : d.rating.overall + ' / 5'}</span><span className="tiny muted">{d.rating.count} تقييم · موعد {d.rating.on_time ?? '—'} · تواصل {d.rating.communication ?? '—'} · توثيق {d.rating.documentation ?? '—'}</span></div>}</div></Card>))}
        {c.type === 'carrier' && <>
          <div className="grid g2">
            <Card title={`السائقون (${d.drivers.length})`} flush><RecordsTable columns={[['name', 'السائق'], ['phone', 'الجوال'], ['license_expiry', 'الرخصة'], ['driver_state', 'الحالة'], ['current_trip', 'الرحلة الحالية'], ['trips_done', 'منفذة']]} rows={d.drivers.map((x) => ({ ...x, link: null }))} /></Card>
            <Card title={`الصهاريج (${d.vehicles.length})`} flush><RecordsTable columns={[['plate', 'اللوحة'], ['capacity_ml', 'السعة', 'l'], ['docs_valid_until', 'الوثائق'], ['vehicle_state', 'الحالة'], ['current_trip', 'الرحلة الحالية']]} rows={d.vehicles.map((x) => ({ ...x, link: null }))} /></Card>
          </div>
          <div className="grid g2">
            <Card title="مناطق التغطية والأسعار"><div className="row mb">{d.coverage.map((x, i) => <Chip key={i} tone={x.kind === 'loading' ? 'info' : 'brand'}>{x.kind === 'loading' ? 'تحميل' : 'تسليم'}: {x.label}</Chip>)}</div>
              <table className="t"><tbody>{d.prices.map((p) => <tr key={p.id}><td>{p.loading_point_name} ← {p.delivery_city}</td><td>{PRODUCTS[p.product]}</td><td className="num">{p.price_halalas == null ? '—' : n(p.price_halalas / 100, 2) + ' ر.س'}{p.pricing_type === 'per_1000l' ? ' /1000ل' : ''}</td></tr>)}</tbody></table></Card>
            <Card title="العقود والوثائق">{d.contracts.map((x) => <div key={x.number} className="small mb"><b>{x.number}</b> · {x.client_name} · {x.type === 'monthly' ? 'شهري' : 'سنوي'} · {x.status}</div>)}
              <div className="sep" />{d.documents.map((x) => <div key={x.id} className="small mb">{x.label} · {x.number} · تنتهي {x.expires_at} <Chip tone={x.status === 'approved' ? 'good' : 'warn'}>{x.status}</Chip></div>)}</Card>
          </div>
        </>}
        {c.type === 'client' && <>
          <Card title="حسب المشروع" flush><table className="t"><thead><tr><th>المشروع</th><th>الطلبات</th><th>المصروف (لتر)</th><th>أجرة النقل</th><th>تكلفة الوقود المصروف</th></tr></thead>
            <tbody>{d.by_project.map((p) => <tr key={p.id}><td><b>{p.code}</b> {p.name}</td><td>{p.orders}</td><td className="num">{n(p.issued_ml / 1000)}</td><td className="num">{p.transport_halalas == null ? '—' : n(p.transport_halalas / 100, 2)}</td><td className="num">{p.fuel_cost_halalas == null ? '—' : n(p.fuel_cost_halalas / 100, 2)}</td></tr>)}</tbody></table></Card>
          <div className="grid g3">
            <Card title="ناقلوها">{d.carriers.length ? d.carriers.map((x) => <div key={x.id} className="small mb"><a href={`/admin/companies/${x.id}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/companies/${x.id}`); }} style={{ color: 'var(--brand)' }}>{x.name_ar}</a> · {x.trips} رحلة</div>) : <Empty />}</Card>
            <Card title="الخزانات والمعدات والشرائح">{d.tanks.map((t) => <div key={t.id} className="small">{t.code}: <span className="num">{n(t.book_ml / 1000)}</span> / {n(t.capacity_ml / 1000)} لتر</div>)}
              <div className="small mt">المعدات: {d.assets.total} (نشطة {d.assets.active})</div><div className="small">الشرائح: {d.tags.map((x) => `${x.status} ${x.n}`).join(' · ')}</div></Card>
            <Card title="العقود والباقات">{[...d.contracts.map((x) => `${x.number} · ${x.carrier_name} · ${x.type === 'monthly' ? 'شهري' : 'سنوي'} · ${x.status}`), ...d.packages.map((x) => `${x.number} · ${x.total_trips} رحلة · ${x.status}`)].map((t) => <div key={t} className="small mb">{t}</div>)}</Card>
          </div>
        </>}
        {c.type === 'supplier' && <Card title="عروض التوريد" flush><RecordsTable columns={[['number', 'العرض'], ['created_at', 'التاريخ', 'dt'], ['client_name', 'العميل'], ['quantity_ml', 'الكمية', 'l'], ['carrier_name', 'الناقل المرتبط'], ['order_number', 'الطلب'], ['supply_status_ar', 'الحالة'], ...(can(me, 'platform.finance') ? [['invoiced_halalas', 'المفوتر', 'sar'], ['paid_halalas', 'المسدد', 'sar']] : [])]} rows={d.supply} /></Card>}
        <Card title="المستخدمون">{d.members.map((u) => <span key={u.email} className="chip" style={{ margin: 3 }}>{u.name} · {u.role}</span>)}</Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* البحث الموحد وتفاصيل الطلب                                            */
/* ------------------------------------------------------------------ */
export function AdminSearch() {
  const [term, setTerm] = useState(query().q || '');
  const r = useApi(term.trim().length >= 2 ? '/admin/search?q=' + encodeURIComponent(term.trim()) : null, [term]);
  const recent = useApi('/admin/records?metric=orders.total&period=all');
  const d = r.data;
  return (
    <>
      <Title sub="ابحث برقم الطلب أو الرحلة أو لوحة الصهريج أو اسم الشركة أو السائق">الطلبات والرحلات</Title>
      <div className="card mb" style={{ padding: 14 }}><div className="row"><Search size={20} color="var(--brand)" />
        <input autoFocus className="input grow" style={{ fontSize: 16 }} placeholder="FA-ORD-… · FA-TRP-… · أ ب ج 4512 · ناقلات الوسطى · محمد القحطاني" value={term} onChange={(e) => { setTerm(e.target.value); history.replaceState(null, '', '?q=' + encodeURIComponent(e.target.value)); }} /></div></div>
      {term.trim().length >= 2 ? (!d ? <Spinner /> : (
        <div className="stack">
          {d.orders.length > 0 && <Card title={`الطلبات (${d.orders.length})`} flush><table className="t"><tbody>{d.orders.map((o) => (
            <tr key={o.id} className="click" onClick={() => navigate(o.link)}><td><b className="num">{o.number}</b><div className="tiny muted">{dt(o.created_at)}</div></td><td>{o.client_name}</td><td>{o.carrier_name || '—'}</td><td><Chip>{o.status_ar}</Chip></td>
              <td className="small">{o.trips.map((t) => <div key={t.id}>{t.number} · {t.status_ar} {t.plate && `· ${t.plate}`} {t.driver_name && `· ${t.driver_name}`}</div>)}</td></tr>))}</tbody></table></Card>}
          {[['companies', 'الشركات', (x) => x.name_ar], ['drivers', 'السائقون', (x) => `${x.name} · ${x.company_name}`], ['vehicles', 'الصهاريج', (x) => `${x.plate} · ${x.company_name}`]].map(([k, l, lab]) => d[k].length > 0 &&
            <Card key={k} title={l}>{d[k].map((x) => <button key={x.id} className="chip" style={{ margin: 3, cursor: 'pointer' }} onClick={() => navigate(x.link)}>{lab(x)}</button>)}</Card>)}
          {!d.orders.length && !d.companies.length && !d.drivers.length && !d.vehicles.length && <Empty>لا نتائج</Empty>}
        </div>)) : <Card title="أحدث الطلبات" flush>{recent.data ? <RecordsTable columns={recent.data.columns.filter((c) => !['responsible', 'follow_up'].includes(c[0]))} rows={recent.data.rows.slice(0, 15)} /> : <Spinner />}</Card>}
    </>
  );
}

export function AdminOrder({ id }) {
  const me = useMe();
  const r = useApi('/admin/orders/' + id);
  const [fu, setFu] = useState(null);
  const o = r.data;
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!o) return <Spinner />;
  const OT = { pending: 'warn', accepted: 'good', rejected: 'bad', withdrawn: '', expired: 'bad' };
  return (
    <>
      <Title sub={`${o.client_name} · ${dt(o.created_at)} · أنشأه ${o.created_by_name}`}>الطلب {o.number}</Title>
      <div className="row mb"><button className="btn sm" onClick={() => history.back()}><ArrowRight size={14} /> رجوع</button><Chip tone="info">{o.status_ar}</Chip><div className="grow" />
        {can(me, 'platform.manage') && <button className="btn sm" onClick={() => setFu({ entity_type: 'order', entity_id: o.id })}><UserCheck size={14} /> تعيين متابع</button>}</div>
      <Alert tone={o.stuck_at?.includes('انتهت') || o.stuck_at?.includes('متأخر') ? 'warn' : 'info'}><b>أين يقف الطلب:</b> {o.stuck_at} · <b>المسؤول:</b> {o.responsible}{o.follow_up && <> · <b>المتابع:</b> {o.follow_up}</>}</Alert>
      <div className="grid g-main mt">
        <div className="stack">
          <Card title={`الناقلون الذين وصلهم الطلب (${o.offers.length})`} flush><table className="t"><thead><tr><th>الناقل</th><th>وصل</th><th>الرد</th><th>زمن الرد</th><th>بواسطة / السبب</th>{can(me, 'platform.finance') && <th>عرضه</th>}</tr></thead>
            <tbody>{o.offers.map((f) => <tr key={f.id}><td><a href={`/admin/companies/${f.carrier_id}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/companies/${f.carrier_id}`); }} style={{ color: 'var(--brand)', fontWeight: 600 }}>{f.carrier_name}</a>{f.carrier_id === o.carrier_id && f.status === 'accepted' && <Chip tone="good">المعتمد</Chip>}</td>
              <td className="small">{dt(f.sent_at)}</td><td><Chip tone={OT[f.status]}>{f.status_ar}</Chip></td><td className="small">{f.response_minutes != null ? `${f.response_minutes} د` : f.status === 'pending' ? `المهلة حتى ${dt(f.deadline)}` : '—'}</td>
              <td className="small">{f.responded_by_name || ''} {f.reason && <div className="muted">{f.reason}</div>}</td>{can(me, 'platform.finance') && <td className="num small">{f.quote ? n(f.quote.total_halalas / 100, 2) : '—'}</td>}</tr>)}</tbody></table></Card>
          <Card title={`الرحلات (${o.trips.length})`} flush><table className="t"><thead><tr><th>الرحلة</th><th>الحالة</th><th>السائق والصهريج</th><th>التسليم والمستلم</th><th>المحملة / المسلّمة</th><th>الصور</th></tr></thead>
            <tbody>{o.trips.map((t) => <tr key={t.id} className="click" onClick={() => navigate('/trips/' + t.id)}><td><b className="num">{t.number}</b></td><td><Chip>{t.status_ar}</Chip></td>
              <td className="small">{t.driver_name ? <>{t.driver_name} <span className="muted">{t.driver_phone}</span><div>{t.plate}</div></> : '—'}</td>
              <td className="small">{t.stops.map((s) => <div key={s.id}>{s.site_name} ({s.city}) · {s.receiver_name} {s.receiver_phone} {s.receiver_ack && <Chip tone={s.receiver_ack === 'confirmed' ? 'good' : 'bad'}>{s.receiver_ack === 'confirmed' ? 'أكد' : 'اعترض'}</Chip>}</div>)}</td>
              <td className="num small">{t.loaded_ml != null ? n(t.loaded_ml / 1000) : '—'} / {t.stops.reduce((a, s) => a + (s.delivered_ml || 0), 0) ? n(t.stops.reduce((a, s) => a + (s.delivered_ml || 0), 0) / 1000) : '—'}</td>
              <td>{t.photos}/{2 + 2 * t.stops.length}</td></tr>)}</tbody></table></Card>
          <Card title="سجل تغيّر الحالة"><ul className="tl">{o.history.map((e) => <li key={e.id} className="done"><div className="small"><b>{e.trip_number}</b> · {e.to_ar}</div><div className="tiny muted">{dt(e.received_at)} · {e.actor_name || 'النظام'}{e.note ? ' · ' + e.note : ''}</div></li>)}</ul></Card>
        </div>
        <div className="stack">
          <Card title="بيانات الطلب"><dl className="kv"><dt>العميل</dt><dd><a href={`/admin/companies/${o.company_id}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/companies/${o.company_id}`); }} style={{ color: 'var(--brand)' }}>{o.client_name}</a></dd>
            <dt>المشروع</dt><dd>{o.project_code} {o.project_name}</dd><dt>الكمية</dt><dd className="num">{n(o.quantity_ml / 1000)} لتر {PRODUCTS[o.product]}</dd><dt>التحميل</dt><dd>{o.loading_point_name}</dd>
            <dt>الموعد</dt><dd className="small">{dt(o.window_start)} – {dt(o.window_end)}</dd><dt>الناقل المعتمد</dt><dd>{o.carrier_name}</dd>
            <dt>ملف أرامكو</dt><dd>{o.doc_file_id ? <a className="num" href={`/api/files/${o.doc_file_id}?token=${auth.token}`} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>{o.doc_number} <ExternalLink size={12} /></a> : '—'}</dd></dl></Card>
          {o.price && <Card title="السعر المعتمد"><dl className="kv"><dt>أجرة النقل</dt><dd className="num">{n(o.price.base_halalas / 100, 2)} ر.س</dd><dt>عمولة المنصة</dt><dd className="num">{n((o.price.platform_fee_halalas || 0) / 100, 2)}</dd><dt>الضريبة</dt><dd className="num">{n((o.price.vat_halalas || 0) / 100, 2)}</dd><dt>الإجمالي</dt><dd className="num"><b>{n(o.price.total_halalas / 100, 2)} ر.س</b></dd></dl></Card>}
          <Card title="المتابعة">{o.follow_ups.length ? o.follow_ups.map((x) => <div key={x.id} className="small mb"><Chip tone={x.status === 'open' ? 'warn' : 'good'}>{x.status === 'open' ? 'مفتوحة' : 'منتهية'}</Chip> {x.assignee} — {x.note} <div className="tiny muted">{dt(x.created_at)} · بواسطة {x.created_by_name}</div></div>) : <Empty>لا متابعات</Empty>}</Card>
        </div>
      </div>
      {fu && <FollowUpModal target={fu} onClose={() => setFu(null)} onDone={() => { setFu(null); r.reload(); }} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* التقارير وسجل التدقيق                                                 */
/* ------------------------------------------------------------------ */
export function AdminReports({ key: _k }) {
  const me = useMe();
  const opts = useApi('/admin/filters').data;
  const x = query(); const f = curFilters();
  const key = x.report || 'orders';
  const r = useApi(`/admin/reports/${key}?` + fqs(f), [key, fqs(f)]);
  const pick = (k) => navigate('/admin/reports?' + fqs(f, { report: k }), true);
  const exp = (fmt) => `/api/admin/reports/${key}?${fqs(f, { format: fmt })}&token=${auth.token}`;
  return (
    <>
      <Title sub="كل تقرير بالفلاتر نفسها، وتصدير Excel للبيانات وPDF للعرض التشغيلي">التقارير</Title>
      <div className="tabs">{opts?.reports.filter((rp) => !rp.finance || can(me, 'platform.finance')).map((rp) => <button key={rp.key} className={key === rp.key ? 'on' : ''} onClick={() => pick(rp.key)}>{rp.title}</button>)}</div>
      <FilterBar />
      {r.error ? <Alert tone="bad">{r.error.message}</Alert> : !r.data ? <Spinner /> : (
        <Card title={`${r.data.title} — ${r.data.total} سجل`} icon={<FileText size={18} color="var(--brand)" />} actions={can(me, 'platform.export') && <><a className="btn sm primary" href={exp('xlsx')}><Download size={14} /> Excel</a><a className="btn sm" target="_blank" rel="noreferrer" href={exp('pdf')}><Printer size={14} /> PDF</a></>} flush>
          {r.data.summary && <div className="row" style={{ padding: 14 }}>{r.data.summary.map(([k, v]) => <Chip key={k} tone="info">{k}: <b className="num">{n(v)}</b> لتر</Chip>)}</div>}
          {r.data.rows.length ? <RecordsTable columns={r.data.columns} rows={r.data.rows} /> : <Empty>لا توجد سجلات لهذا الفلتر</Empty>}
        </Card>)}
    </>
  );
}

export function AdminAudit() {
  const r = useApi('/admin/audit');
  return (
    <>
      <Title sub="إجراءات الإدارة الحساسة والتصدير والدخول">سجل التدقيق</Title>
      <Card flush>{!r.data ? <Spinner /> : <table className="t"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>السجل</th><th>التفاصيل</th></tr></thead>
        <tbody>{r.data.map((a) => <tr key={a.id}><td className="small">{dt(a.at)}</td><td>{a.user_name}</td><td><Chip tone={a.action.includes('export') ? 'info' : 'warn'}>{a.action}</Chip></td><td className="small">{a.entity} {a.entity_id?.slice(0, 14)}</td>
          <td className="tiny muted" style={{ direction: 'ltr', textAlign: 'right', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.data_json}</td></tr>)}</tbody></table>}</Card>
    </>
  );
}
