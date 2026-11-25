import React, { useState } from 'react';
import { Plus, Check, Minus } from 'lucide-react';
import { api, useApi, navigate, liters, sar, dt, fail, toast, PRODUCTS } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Meter } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

export function Projects() {
  const me = useMe();
  const lk = useApi('/lookups').data;
  const org = useApi('/org');
  const dash = useApi('/dashboard');
  const trips = useApi('/trips?status=awaiting_acceptance,awaiting_assignment,assigned,to_loading,at_loading,loaded,to_delivery,at_site');
  const assets = useApi('/assets');
  const [modal, setModal] = useState(null);
  if (!org.data) return <Spinner />;
  const { projects, sites, tanks, cost_centers } = org.data;
  const post = (path) => async (e) => { e.preventDefault(); try { await api(path, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('تم الحفظ'); setModal(null); org.reload(); } catch (err) { fail(err); } };
  return (
    <>
      <Title sub="الرحلات القادمة والخزانات والمعدات والميزانية لكل مشروع">المشاريع والمواقع</Title>
      {can(me, 'org.manage') && <div className="filters"><div className="grow" /><button className="btn" onClick={() => setModal('tank')}><Plus size={15} /> خزان</button><button className="btn" onClick={() => setModal('site')}><Plus size={15} /> موقع</button><button className="btn primary" onClick={() => setModal('project')}><Plus size={15} /> مشروع</button></div>}
      <div className="stack">{projects.map((p) => {
        const used = dash.data?.by_project.find((x) => x.id === p.id);
        const pSites = sites.filter((s) => s.project_id === p.id);
        const pTanks = tanks.filter((t) => pSites.some((s) => s.id === t.site_id));
        const pTrips = (trips.data || []).filter((t) => t.project_name === p.name);
        const pAssets = (assets.data || []).filter((a) => a.project_id === p.id);
        const low = pTanks.filter((t) => t.book_ml <= t.reorder_ml);
        return (
          <Card key={p.id} title={<a href={'/projects/' + p.id} onClick={(e) => { e.preventDefault(); navigate('/projects/' + p.id); }}>{p.code} — {p.name}</a>} actions={<>{low.length ? <Chip tone="warn">نقص وقود: {low.map((t) => t.code).join('، ')}</Chip> : null}<button className="btn sm" onClick={() => navigate('/projects/' + p.id)}>صفحة المشروع</button></>}>
            <div className="grid g4">
              <div><div className="small muted">الميزانية اللترية</div>{p.budget_ml ? <><b className="num">{liters(used?.ml || 0)}</b> / <span className="num">{liters(p.budget_ml)}</span> لتر<div style={{ marginTop: 6 }}><Meter value={used?.ml || 0} max={p.budget_ml} /></div><div className="tiny muted" style={{ marginTop: 4 }}>المتاح {liters(p.budget_ml - (used?.ml || 0))} لتر</div></> : '—'}
                {p.budget_halalas && can(me, 'price.view') ? <div className="tiny muted">الميزانية المالية {sar(p.budget_halalas)} ر.س · المصروف {sar(used?.cost || 0)}</div> : null}</div>
              <div><div className="small muted">المواقع</div>{pSites.map((s) => <div key={s.id} className="small" style={{ cursor: 'pointer' }} onClick={() => navigate('/sites/' + s.id)}><b style={{ color: 'var(--brand)' }}>{s.name}</b> · {s.city}<div className="tiny muted">المستلم: {s.receiver_name} {s.receiver_phone}</div></div>)}</div>
              <div><div className="small muted">الخزانات</div>{pTanks.map((t) => <div key={t.id} className="small" style={{ cursor: 'pointer' }} onClick={() => navigate('/tanks/' + t.id)}><b>{t.code}</b> <span className="num">{liters(t.book_ml)}</span> / {liters(t.capacity_ml)} لتر</div>)}{!pTanks.length && <span className="small muted">تزويد مباشر فقط</span>}</div>
              <div><div className="small muted">الرحلات القادمة ({pTrips.length})</div>{pTrips.slice(0, 4).map((t) => <div key={t.id} className="small" style={{ cursor: 'pointer' }} onClick={() => navigate('/trips/' + t.id)}><span className="num">{t.number}</span> · {t.status_ar}</div>)}
                <div className="small muted" style={{ marginTop: 6 }}>المعدات النشطة: <b>{pAssets.filter((a) => a.status === 'active').length}</b></div></div>
            </div>
          </Card>
        );
      })}</div>
      {modal === 'project' && <Modal title="مشروع جديد" onClose={() => setModal(null)}><form className="stack" onSubmit={post('/projects')}>
        <Field label="الرمز"><input name="code" className="input" required /></Field><Field label="الاسم"><input name="name" className="input" required /></Field>
        <Field label="مركز التكلفة"><select name="cost_center_id" className="input"><option value="">—</option>{cost_centers.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>
        <Field label="الميزانية اللترية"><input name="budget_liters" type="number" className="input" /></Field><Field label="الميزانية المالية (ر.س)"><input name="budget_sar" type="number" className="input" /></Field>
        <button className="btn primary">حفظ</button></form></Modal>}
      {modal === 'tank' && <Modal title="خزان جديد" onClose={() => setModal(null)}><form className="stack" onSubmit={post('/tanks')}>
        <Field label="الموقع"><select name="site_id" className="input" required>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="رمز الخزان"><input name="code" className="input" required placeholder="TNK-03" /></Field><Field label="الاسم"><input name="name" className="input" /></Field>
        <Field label="المنتج"><select name="product" className="input"><option value="diesel">ديزل</option><option value="gasoline91">بنزين 91</option><option value="gasoline95">بنزين 95</option></select></Field>
        <Field label="السعة (لتر)"><input name="capacity_liters" type="number" className="input" required defaultValue="30000" /></Field>
        <Field label="حد إعادة الطلب (لتر)"><input name="reorder_liters" type="number" className="input" defaultValue="5000" /></Field>
        <button className="btn primary">حفظ</button></form></Modal>}
      {modal === 'site' && <Modal title="موقع جديد" onClose={() => setModal(null)}><form className="stack" onSubmit={post('/sites')}>
        <Field label="الاسم"><input name="name" className="input" required /></Field><Field label="المدينة" hint="المدن التي يغطيها ناقلون معتمدون تظهر أولًا"><input name="city" className="input" required defaultValue="الرياض" list="cities" /><datalist id="cities">{(lk?.cities || []).map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="المشروع"><select name="project_id" className="input">{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label="اسم المستلم"><input name="receiver_name" className="input" /></Field><Field label="جوال المستلم"><input name="receiver_phone" className="input" /></Field>
        <Field label="تعليمات الدخول"><input name="access_notes" className="input" /></Field><button className="btn primary">حفظ</button></form></Modal>}
    </>
  );
}

const MATRIX = [
  ['طلب نقل ومقارنة الأسعار', ['client_admin', 'procurement']],
  ['رؤية الأسعار والتكاليف', ['client_admin', 'procurement', 'project_manager', 'finance']],
  ['إدارة الأصول', ['client_admin', 'project_manager']],
  ['إدارة شرائح NFC', ['client_admin', 'fuel_supervisor']],
  ['تنفيذ التزويد', ['client_admin', 'fuel_supervisor']],
  ['إدارة المخزون والجرد', ['client_admin', 'fuel_supervisor']],
  ['اعتماد الاستثناءات والتصحيحات', ['client_admin', 'project_manager', 'finance']],
  ['تأكيد الاستلام', ['client_admin', 'project_manager', 'fuel_supervisor', 'site_receiver']],
  ['التقارير الإدارية والمالية', ['client_admin', 'project_manager', 'finance', 'procurement']],
  ['إعداد الشركة والمستخدمين', ['client_admin']],
];
const ROLES = ['client_admin', 'procurement', 'project_manager', 'fuel_supervisor', 'finance', 'site_receiver'];

export function Settings() {
  const me = useMe();
  const org = useApi('/org');
  const audit = useApi('/audit');
  const lk = useApi('/lookups').data;
  const [tab, setTab] = useState('users');
  if (!org.data) return <Spinner />;
  const s = me.company.settings || {};
  return (
    <>
      <Title sub={me.company.name}>الإعدادات</Title>
      <div className="tabs">{[['users', 'المستخدمون'], ['roles', 'مصفوفة الصلاحيات'], ['policy', 'سياسات الوقود'], ['audit', 'سجل التدقيق']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'users' && <Card flush><table className="t"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>النطاق</th></tr></thead>
        <tbody>{org.data.users.map((u) => <tr key={u.id + u.role}><td><b>{u.name}</b></td><td className="small" style={{ direction: 'ltr', textAlign: 'right' }}>{u.email}</td><td><Chip>{u.role_ar}</Chip></td><td className="small">{u.scope_project_id ? 'مشروع ' + org.data.projects.find((p) => p.id === u.scope_project_id)?.code : 'كل الشركة'}</td></tr>)}</tbody></table></Card>}
      {tab === 'roles' && <Card flush><div className="tscroll"><table className="t"><thead><tr><th>الصلاحية</th>{ROLES.map((r) => <th key={r}>{lk?.roles[r]}</th>)}</tr></thead>
        <tbody>{MATRIX.map(([l, rs]) => <tr key={l}><td>{l}</td>{ROLES.map((r) => <td key={r} style={{ textAlign: 'center' }}>{rs.includes(r) ? <Check size={16} color="var(--good)" /> : <Minus size={14} color="var(--line-2)" />}</td>)}</tr>)}</tbody></table></div>
        <div className="small muted" style={{ padding: 14 }}>يُطبق الفصل على الواجهات وواجهات الربط والملفات والتصدير. العضوية المحدودة بمشروع لا ترى أصول أو رحلات المشاريع الأخرى حتى بالمعرف المباشر.</div></Card>}
      {tab === 'policy' && <Card><dl className="kv">
        <dt>QR احتياطي</dt><dd>{s.allow_qr !== false ? 'مسموح كاستثناء مسجل' : 'غير مسموح'}</dd>
        <dt>الإدخال اليدوي لمرجع الأصل</dt><dd>{s.allow_manual !== false ? 'مسموح كاستثناء مسجل' : 'غير مسموح'}</dd>
        <dt>تنبيه العمليات المتقاربة</dt><dd>أقل من {s.rapid_repeat_minutes || 15} دقيقة لنفس الأصل</dd>
        <dt>طريقة تسعير اللتر</dt><dd>المتوسط المرجّح للخزان، وتكلفة الدفعة للتزويد المباشر</dd>
        <dt>قراءة العداد</dt><dd>إلزامية للأصول ذات العداد</dd>
        <dt>العمل دون اتصال</dt><dd>مسودة معلقة يعيد الخادم التحقق منها عند المزامنة (التفويض المسبق دون اتصال مؤجل لسياسة مستقلة)</dd>
      </dl></Card>}
      {tab === 'audit' && <Card flush>{audit.data ? <div className="tscroll"><table className="t"><tbody>{audit.data.map((a) => <tr key={a.id}><td className="small">{dt(a.at)}</td><td>{a.user_name}</td><td><Chip>{a.action}</Chip></td><td className="tiny muted" style={{ direction: 'ltr', textAlign: 'right', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.data_json}</td></tr>)}</tbody></table></div> : <Spinner />}</Card>}
    </>
  );
}
