import React, { useState } from 'react';
import { Fuel, Droplets, Container, Wallet, Clock, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useApi, navigate, liters, sar, n, dt, ago, EXC_TYPE, CATEGORY } from '../lib.js';
import { Card, Kpi, Bars, TankGauge, Meter, Spinner, Chip, Empty } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

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
    const v = d.daily.find((x) => x.d === k)?.ml || 0;
    days.push({ key: k, value: v / 1000, label: k, short: k.slice(8) });
  }
  const pendingCount = d.open_exceptions.reduce((s, e) => s + e.n, 0) + d.awaiting_receipt_confirmation;
  const money = d.spend;
  return (
    <>
      <Title sub={`${me.company.name} · آخر تحديث ${dt(d.generated_at)}`}>نظرة عامة</Title>
      <div className="filters">
        <label className="field"><span>من</span><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="field"><span>إلى</span><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        {!me.scope_project_id && <label className="field"><span>المشروع</span><select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
          <option value="">كل المشاريع</option>{(org.data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></label>}
        <div className="grow" />
        {can(me, 'order.create') && <button className="btn primary" onClick={() => navigate('/orders/new')}>+ طلب نقل جديد</button>}
        {can(me, 'fueling.create') && <button className="btn dark" onClick={() => navigate('/fuel')}><Fuel size={16} /> جلسة تزويد</button>}
      </div>
      <div className="grid g4">
        <Kpi icon={Droplets} label="الكمية المستلمة" value={liters(d.received_ml)} unit="لتر" foot={`${d.received_count} استلام (خزان + تزويد مباشر)`} onClick={() => navigate('/reports?tab=cycle')} />
        <Kpi icon={Fuel} label="المصروف للمعدات" value={liters(d.issued_ml)} unit="لتر" foot={`${n(d.issued_count)} عملية تزويد`} onClick={() => navigate('/fuel/log')} />
        <Kpi icon={Container} label="المخزون في الخزانات" value={liters(d.stock_ml)} unit="لتر" foot={`+ ${liters(d.direct_balance_ml)} لتر متبقٍ في دفعات مباشرة`} onClick={() => navigate('/tanks')} />
        {money ? (
          <Kpi icon={Wallet} label="الإنفاق (نقل + وقود)" value={money.fuel_halalas == null ? sar(money.transport_halalas) : sar(money.transport_halalas + money.fuel_halalas)} unit="ر.س"
            foot={money.fuel_halalas == null ? `تكلفة وقود غير متوفرة لـ ${money.fuel_unknown_batches} دفعة — الرقم يشمل النقل فقط` : `نقل ${sar(money.transport_halalas)} · وقود ${sar(money.fuel_halalas)}`} onClick={() => navigate('/reports?tab=cycle')} />
        ) : <Kpi icon={Wallet} label="الإنفاق" value="—" foot="غير متاح لدورك" />}
      </div>
      <div className="grid g4 mt">
        <Kpi icon={Clock} label="التسليم في الموعد" value={d.on_time.pct == null ? 'بيانات غير كافية' : d.on_time.pct + '%'}
          foot={`${d.on_time.on_time} من ${d.on_time.counted} رحلة ذات نافذة مسجلة`} onClick={() => navigate('/trips')} />
        <Kpi icon={AlertTriangle} label="عمليات معلّقة" value={pendingCount} tone={pendingCount ? 'warn' : undefined}
          foot={[d.awaiting_receipt_confirmation ? `${d.awaiting_receipt_confirmation} بانتظار تأكيد الاستلام` : null, ...d.open_exceptions.map((e) => `${e.n} ${EXC_TYPE[e.type] || e.type}`)].filter(Boolean).join(' · ') || 'لا شيء معلق'}
          onClick={() => navigate('/approvals')} />
        <div className="card" style={{ gridColumn: 'span 2', padding: 16 }}>
          <div className="row small muted" style={{ marginBottom: 8 }}>الرحلات حسب الحالة</div>
          <div className="row">{d.trips_by_status.map((s) => <a key={s.status} href="#" onClick={(e) => { e.preventDefault(); navigate('/trips?status=' + s.status); }}><Chip>{s.label} <b className="num">{s.n}</b></Chip></a>)}</div>
        </div>
      </div>

      <div className="grid g-main mt">
        <Card title="الصرف اليومي للمعدات — آخر 14 يومًا" actions={<span className="small muted">لتر</span>}>
          <Bars data={days} />
        </Card>
        <Card title="الخزانات" actions={<a className="small" style={{ color: 'var(--brand-2)' }} href="/tanks" onClick={(e) => { e.preventDefault(); navigate('/tanks'); }}>التفاصيل</a>}>
          <div className="stack">{d.tanks.length ? d.tanks.map((t) => <div key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/tanks/' + t.id)}><TankGauge t={t} /></div>) : <Empty>لا توجد خزانات</Empty>}</div>
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card title="ميزانية الوقود حسب المشروع" flush>
          <table className="t"><thead><tr><th>المشروع</th><th>المصروف</th><th style={{ width: '35%' }}>من الميزانية اللترية</th>{money && <th>التكلفة</th>}</tr></thead>
            <tbody>{d.by_project.map((p) => {
              const pct = p.budget_ml ? p.ml / p.budget_ml : null;
              return (<tr key={p.id}><td><b>{p.code}</b><div className="small muted">{p.name}</div></td><td><span className="num">{liters(p.ml)}</span> لتر</td>
                <td>{p.budget_ml ? <><Meter value={p.ml} max={p.budget_ml} tone={pct > 0.9 ? 'bad' : pct > 0.75 ? 'warn' : ''} /><div className="tiny muted mt" style={{ marginTop: 4 }}>{Math.round(pct * 100)}% من {liters(p.budget_ml)} لتر</div></> : <span className="muted small">بدون ميزانية</span>}</td>
                {money && <td>{p.unknown ? <Chip tone="warn">جزئية</Chip> : null} <span className="num">{sar(p.cost)}</span></td>}</tr>);
            })}</tbody></table>
        </Card>
        <Card title="الأصول الأعلى استهلاكًا" flush>
          {d.top_assets.length ? <table className="t"><tbody>{d.top_assets.map((a) => (
            <tr key={a.id} className="click" onClick={() => navigate('/assets/' + a.id)}><td><b>{a.code}</b><div className="small muted">{a.name} · {CATEGORY[a.category]}</div></td>
              <td><span className="num">{liters(a.ml)}</span> لتر</td><td className="small muted">{a.n} عملية</td><td><ArrowLeft size={15} color="var(--muted)" /></td></tr>
          ))}</tbody></table> : <Empty />}
        </Card>
      </div>
    </>
  );
}
