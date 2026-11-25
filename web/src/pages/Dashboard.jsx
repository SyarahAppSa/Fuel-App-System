import React, { useEffect, useState } from 'react';
import {
  Fuel, Droplets, Container, Wallet, Clock, AlertTriangle, ArrowLeft, Building2, MapPin, Tractor, Nfc, Truck, Users, FilePlus2,
  ClipboardList, Link2, Calendar, Gauge, PackageCheck,
} from 'lucide-react';
import { useApi, navigate, liters, sar, n, dt, ago, EXC_TYPE, CATEGORY } from '../lib.js';
import { Card, Kpi, Bars, TankGauge, Meter, Spinner, Empty, Donut, SERIES } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

const RENEWAL = '2026-12-30T23:59:59+03:00';
function Countdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const ms = Math.max(0, new Date(RENEWAL) - now);
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return <div className="count"><b className="num">{d}</b> <span>يوم</span> | <b className="num">{h}</b> <span>ساعات</span> | <b className="num">{m}</b> <span>دقيقة</span></div>;
}

export default function Dashboard() {
  const me = useMe();
  const [f, setF] = useState({ from: '', to: '', project_id: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data: d, loading } = useApi('/dashboard?' + qs, [qs]);
  const org = useApi('/org');
  if (loading && !d) return <Spinner />;
  if (!d) return null;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = new Date(Date.now() - i * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);
    days.push({ key: k, value: (d.daily.find((x) => x.d === k)?.ml || 0) / 1000, label: k, short: k.slice(8) });
  }
  const money = d.spend;
  const pending = d.open_exceptions.reduce((s, e) => s + e.n, 0) + d.awaiting_receipt_confirmation;
  const totalBalance = d.stock_ml + d.direct_balance_ml;
  const projects = d.by_project.filter((p) => p.ml > 0);
  const donut = projects.map((p, i) => ({ key: p.id, label: p.code, value: p.ml, color: SERIES[i % SERIES.length] }));
  const lowTanks = d.tanks.filter((t) => d.low_tanks.includes(t.id));
  const spendTotal = money ? (money.fuel_halalas == null ? null : money.transport_halalas + money.fuel_halalas) : null;
  return (
    <>
      <Title sub={`آخر تحديث ${dt(d.generated_at)}`}>لوحة التحكم</Title>
      <div className="stack" style={{ gap: 18 }}>
        {/* الباقة */}
        <div className="plan">
          <div className="grow">
            <h2>باقة فيول آب للشركات — التشغيل التجريبي</h2>
            <div className="renew">تاريخ تجديد الاشتراك: <span className="num">30/12/2026</span> · لوحة إدارة الوقود + سوق النقل + شرائح NFC</div>
          </div>
          <Countdown />
          <button className="btn" onClick={() => navigate('/contracts')}>ترقية الاشتراك</button>
        </div>

        {/* بطاقة الرصيد */}
        <div className="balance">
          <div className="main-bal" style={{ cursor: 'pointer' }} onClick={() => navigate('/tanks')}>
            <div className="bub"><Droplets size={32} /></div>
            <div><div className="lbl">الرصيد الإجمالي للوقود</div><div className="big"><span className="num">{liters(totalBalance)}</span><small>لتر</small></div>
              <div className="tiny" style={{ color: 'var(--on-dark-soft)' }}>خزانات + دفعات تزويد مباشر</div></div>
          </div>
          <div className="col">
            <div className="sub" onClick={() => navigate('/tanks')}><div className="bub sm"><Container size={24} /></div><div><div className="t">مخزون الخزانات</div><div className="mid"><span className="num">{liters(d.stock_ml)}</span><small>لتر</small></div></div></div>
            <div className="sub" onClick={() => navigate('/fuel')}><div className="bub sm"><Truck size={24} /></div><div><div className="t">دفعات التزويد المباشر</div><div className="mid"><span className="num">{liters(d.direct_balance_ml)}</span><small>لتر</small></div></div></div>
          </div>
          <div className="col">
            <div className="sub" onClick={() => navigate('/fuel/log')}><div className="bub sm"><Fuel size={24} /></div><div><div className="t">المصروف آخر 30 يومًا</div><div className="mid"><span className="num">{liters(d.month_issued_ml)}</span><small>لتر</small></div></div></div>
          </div>
          <div className="col">
            <div className="sub" onClick={() => navigate('/reports?tab=cycle')}><div className="bub sm"><PackageCheck size={24} /></div><div><div className="t">المستلم في الفترة</div><div className="mid"><span className="num">{liters(d.received_ml)}</span><small>لتر</small></div></div></div>
            <div className="sub" onClick={() => navigate('/reports?tab=cycle')}><div className="bub sm"><Wallet size={24} /></div><div><div className="t">الإنفاق (نقل + وقود)</div>
              <div className="mid">{money ? (spendTotal == null ? <span style={{ fontSize: 15 }}>غير متوفر كاملًا</span> : <><span className="num">{sar(spendTotal)}</span><small>ر.س</small></>) : <span style={{ fontSize: 15 }}>غير متاح لدورك</span>}</div></div></div>
          </div>
        </div>

        {/* الفترة */}
        <div className="ranges">
          <label className="pick"><Calendar size={16} /><span className="small muted">من</span><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <b className="muted">إلى</b>
          <label className="pick"><Calendar size={16} /><span className="small muted">إلى</span><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          {!me.scope_project_id && <label className="pick"><Building2 size={16} /><select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">كل المشاريع</option>{(org.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></label>}
        </div>

        {/* التنبيهات */}
        {(lowTanks.length > 0 || pending > 0 || d.needs_carrier?.length > 0) && (
          <div className="alerts">
            {(d.needs_carrier || []).map((o) => <div key={o.id} className="al bad" onClick={() => navigate('/orders/new?reoffer=' + o.id)}><Truck size={15} /> الطلب {o.number}: اعتذر الناقل أو انتهت مهلته — اختر ناقلًا آخر</div>)}
            {lowTanks.map((t) => <div key={t.id} className="al warn" onClick={() => navigate('/tanks/' + t.id)}><AlertTriangle size={15} /> الخزان {t.code} تحت حد إعادة الطلب — اطلب نقلًا</div>)}
            {d.awaiting_receipt_confirmation > 0 && <div className="al warn" onClick={() => navigate('/trips?status=delivered')}><PackageCheck size={15} /> {d.awaiting_receipt_confirmation} تسليم بانتظار تأكيد الاستلام</div>}
            {d.open_exceptions.map((e) => <div key={e.type} className="al bad" onClick={() => navigate('/approvals')}><AlertTriangle size={15} /> {e.n} {EXC_TYPE[e.type] || e.type} بانتظار القرار</div>)}
          </div>
        )}

        {/* المؤشرات */}
        <div className="grid g3">
          <Kpi icon={Building2} label="عدد المشاريع" value={d.counts.projects} foot={`${d.counts.sites} موقع تسليم`} onClick={() => navigate('/projects')} />
          <Kpi icon={Tractor} label="المعدات والمركبات النشطة" value={d.counts.assets} foot={`${d.counts.active_tags} بشريحة NFC نشطة`} onClick={() => navigate('/assets')} />
          <Kpi icon={Fuel} label="عمليات التزويد" value={n(d.issued_count)} foot={`${liters(d.issued_ml)} لتر في الفترة`} onClick={() => navigate('/fuel/log')} />
          <Kpi icon={Truck} label="رحلات قيد التنفيذ" value={d.counts.active_trips} foot={d.trips_by_status.map((s) => `${s.label} ${s.n}`).slice(0, 3).join(' · ')} onClick={() => navigate('/trips')} />
          <Kpi icon={Clock} label="التسليم في الموعد" value={d.on_time.pct == null ? 'بيانات غير كافية' : d.on_time.pct + '%'} foot={`${d.on_time.on_time} من ${d.on_time.counted} رحلة ذات نافذة مسجلة`} onClick={() => navigate('/trips')} />
          <Kpi icon={AlertTriangle} label="عمليات معلّقة" value={pending} tone={pending ? 'warn' : undefined} foot={pending ? 'استثناءات وتأكيدات بانتظار إجراء' : 'لا شيء معلق'} onClick={() => navigate('/approvals')} />
        </div>

        {/* إجراءات سريعة */}
        <Card title="إجراءات سريعة">
          <div className="qa">
            {can(me, 'order.create') && <button onClick={() => navigate('/orders/new')}><i><FilePlus2 size={20} /></i>طلب نقل جديد</button>}
            {can(me, 'fueling.create') && <button onClick={() => navigate('/fuel')}><i><Fuel size={20} /></i>جلسة تزويد NFC</button>}
            {can(me, 'nfc.manage') && <button onClick={() => navigate('/nfc')}><i><Link2 size={20} /></i>ربط شريحة بمعدة</button>}
            {can(me, 'inventory.view') && <button onClick={() => navigate('/tanks')}><i><ClipboardList size={20} /></i>جرد الخزانات</button>}
            {can(me, 'report.view') && <button onClick={() => navigate('/reports')}><i><Gauge size={20} /></i>التقارير</button>}
            {can(me, 'asset.view') && <button onClick={() => navigate('/assets')}><i><Tractor size={20} /></i>المعدات</button>}
            {can(me, 'exception.decide') && <button onClick={() => navigate('/approvals')}><i><AlertTriangle size={20} /></i>الموافقات</button>}
            {can(me, 'org.manage') && <button onClick={() => navigate('/settings')}><i><Users size={20} /></i>المستخدمون</button>}
          </div>
        </Card>

        {/* الرسوم */}
        <div className="grid g2">
          <Card title="الصرف اليومي للمعدات — آخر 14 يومًا" actions={<span className="small muted">لتر</span>}><Bars data={days} /></Card>
          <Card title="نسب الاستهلاك حسب المشروع">
            {donut.length ? (
              <div className="donut-wrap">
                <div className="legend">
                  {projects.map((p, i) => (
                    <div key={p.id} className="li"><span className="sw" style={{ background: SERIES[i % SERIES.length] }} /><span>{p.code} — {p.name}</span>
                      <b className="num">{liters(p.ml)} لتر · {Math.round((p.ml / d.issued_ml) * 100)}%</b></div>
                  ))}
                </div>
                <Donut data={donut} center={liters(d.issued_ml)} unit="لتر مصروف" />
              </div>
            ) : <Empty>لا يوجد صرف في الفترة</Empty>}
          </Card>
        </div>

        <div className="grid g-main">
          <Card title="ميزانية الوقود حسب المشروع" flush>
            <table className="t"><thead><tr><th>المشروع</th><th>المصروف</th><th style={{ width: '34%' }}>من الميزانية اللترية</th>{money && <th>التكلفة</th>}</tr></thead>
              <tbody>{d.by_project.map((p) => {
                const pct = p.budget_ml ? p.ml / p.budget_ml : null;
                return (<tr key={p.id} className="click" onClick={() => navigate('/projects')}><td><b>{p.code}</b><div className="small muted">{p.name}</div></td><td><span className="num">{liters(p.ml)}</span> لتر</td>
                  <td>{p.budget_ml ? <><Meter value={p.ml} max={p.budget_ml} tone={pct > 0.9 ? 'bad' : pct > 0.75 ? 'warn' : ''} /><div className="tiny muted" style={{ marginTop: 4 }}>{Math.round(pct * 100)}% من {liters(p.budget_ml)} لتر</div></> : <span className="muted small">بدون ميزانية</span>}</td>
                  {money && <td className="num">{sar(p.cost)}</td>}</tr>);
              })}</tbody></table>
          </Card>
          <Card title="آخر النشاط">
            {d.recent.length ? <ul className="feed">{d.recent.map((r) => (
              <li key={r.kind + r.id + r.at} onClick={() => navigate(r.kind === 'fueling' ? '/fuelings/' + r.id : '/trips/' + r.id)}>
                <div className={'fi ' + r.kind}>{r.kind === 'fueling' ? <Fuel size={18} /> : <Truck size={18} />}</div>
                <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{r.kind === 'fueling' ? <>تزويد {r.subject} — <span className="num">{liters(r.quantity_ml)}</span> لتر</> : <>{r.ref}: {r.status_ar}</>}</div>
                  <div className="tiny muted">{r.actor || r.subject} · {ago(r.at)}</div></div>
              </li>))}</ul> : <Empty />}
          </Card>
        </div>

        <div className="grid g2">
          <Card title="الخزانات" actions={<a className="small" style={{ color: 'var(--brand)' }} href="/tanks" onClick={(e) => { e.preventDefault(); navigate('/tanks'); }}>التفاصيل</a>}>
            <div className="grid g2">{d.tanks.length ? d.tanks.map((t) => <div key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/tanks/' + t.id)}><TankGauge t={t} /></div>) : <Empty>لا توجد خزانات</Empty>}</div>
          </Card>
          <Card title="الأصول الأعلى استهلاكًا" flush>
            {d.top_assets.length ? <table className="t"><tbody>{d.top_assets.map((a) => (
              <tr key={a.id} className="click" onClick={() => navigate('/assets/' + a.id)}><td><b>{a.code}</b><div className="small muted">{a.name} · {CATEGORY[a.category]}</div></td>
                <td><span className="num">{liters(a.ml)}</span> لتر</td><td className="small muted">{a.n} عملية</td><td><ArrowLeft size={15} color="var(--muted)" /></td></tr>
            ))}</tbody></table> : <Empty />}
          </Card>
        </div>
      </div>
    </>
  );
}
