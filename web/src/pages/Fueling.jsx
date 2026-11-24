import React, { useEffect, useMemo, useState } from 'react';
import { Fuel, CheckCircle2, XCircle, AlertTriangle, Container, Truck, Download, RotateCcw, WifiOff, Printer, KeyRound } from 'lucide-react';
import { api, useApi, navigate, liters, sar, n, dt, fail, toast, opId, auth, PRODUCTS, CATEGORY, VERIFY } from '../lib.js';
import { Card, Chip, Spinner, Empty, Field, NfcReader, Alert, Modal } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';
import * as outbox from '../outbox.js';

export function SyncBar({ scope }) {
  const [items, setItems] = useState(outbox.items());
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const u = outbox.subscribe(setItems); const on = () => setOnline(true), off = () => setOnline(false); addEventListener('online', on); addEventListener('offline', off); return () => { u(); removeEventListener('online', on); removeEventListener('offline', off); }; }, []);
  const mine = items.filter((i) => !scope || i.scope === scope);
  const pend = mine.filter((i) => i.status === 'pending' || i.status === 'retry'), failed = mine.filter((i) => i.status === 'failed'), sent = mine.filter((i) => i.status === 'sent');
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="sync"><span className={'dot ' + (!online ? 'off' : pend.length ? 'pend' : '')} />{online ? 'متصل' : 'دون اتصال — يُحفظ محليًا'}
        <span className="grow" /><span>مرفوع {sent.length}</span>·<span style={{ color: pend.length ? 'var(--warn)' : undefined }}>معلّق {pend.length}</span>·<span style={{ color: failed.length ? 'var(--bad)' : undefined }}>فاشل {failed.length}</span>
        {pend.length > 0 && online && <button className="btn sm" onClick={() => outbox.flush()}>مزامنة</button>}</div>
      {failed.map((i) => <div key={i.id} className="alert bad small"><div className="grow">{i.label}: {i.error}</div><button className="btn sm" onClick={() => outbox.retry(i.id)}>إعادة</button><button className="btn sm ghost" onClick={() => outbox.discard(i.id)}>تجاهل</button></div>)}
    </div>
  );
}

export function FuelSession() {
  const me = useMe();
  const org = useApi('/org').data;
  const [site, setSite] = useState(() => { try { return localStorage.getItem('hj_site') || ''; } catch { return ''; } });
  const sources = useApi('/fuel-sources' + (site ? '?site_id=' + site : ''), [site]);
  const tags = useApi(can(me, 'nfc.manage') ? '/nfc-tags' : null);
  const assets = useApi('/assets');
  const [src, setSrc] = useState(null);
  const [auth_, setAuth] = useState(null);
  const [read, setRead] = useState(null);
  const [form, setForm] = useState({ quantity_liters: '', meter_value: '', measure_source: 'pump_meter' });
  const [alt, setAlt] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const op = useMemo(() => opId(), [read, alt]);
  useEffect(() => { try { localStorage.setItem('hj_site', site); } catch {} }, [site]);

  async function check(payload) {
    setBusy(true); setAuth(null);
    try { setAuth(await api('/fuelings/authorize', { method: 'POST', body: { ...payload, source_type: src.type, source_id: src.id } })); }
    catch (e) { setAuth({ authorized: false, reasons: [{ msg: e.message }], warnings: [] }); }
    finally { setBusy(false); }
  }
  const onTag = (uid) => { const p = { uid, verification: 'nfc' }; setRead(p); setAlt(null); check(p); };
  const onAlt = (asset_id, verification) => { const p = { asset_id, verification }; setRead(p); check(p); };
  async function submit() {
    const body = { ...read, ...form, source_type: src.type, source_id: src.id, client_op_id: op, captured_at: new Date().toISOString() };
    setBusy(true);
    try {
      if (!navigator.onLine) {
        await outbox.enqueue({ id: op, scope: 'fuel', label: `تزويد ${auth_?.asset?.code || ''} ${form.quantity_liters} لتر`, url: '/fuelings', json: { ...body, offline: true } });
        toast('حُفظت العملية كمسودة معلقة — يعيد الخادم التحقق عند المزامنة'); reset(); return;
      }
      const r = await api('/fuelings', { method: 'POST', body });
      setReceipt({ ...r, asset: auth_.asset, qty: form.quantity_liters, source: src, meter: form.meter_value });
      sources.reload();
    } catch (e) {
      if (e.status === 0) { await outbox.enqueue({ id: op, scope: 'fuel', label: `تزويد ${auth_?.asset?.code || ''}`, url: '/fuelings', json: { ...body, offline: true } }); toast('انقطع الاتصال — حُفظت كمسودة'); reset(); }
      else { fail(e); if (e.details?.reasons) setAuth({ ...auth_, authorized: false, reasons: e.details.reasons }); }
    } finally { setBusy(false); }
  }
  const reset = () => { setAuth(null); setRead(null); setAlt(null); setReceipt(null); setForm({ quantity_liters: '', meter_value: '', measure_source: 'pump_meter' }); };
  const demoTags = (tags.data?.tags || []).map((t) => ({ ...t, status_ar: { active: 'نشطة', suspended: 'موقوفة', lost: 'مفقودة', replaced: 'مستبدلة', pending_activation: 'بانتظار التفعيل', in_custody: 'في العهدة', damaged: 'تالفة' }[t.status] }));
  const a = auth_?.asset;
  const settings = me.company.settings || {};

  if (receipt) return (
    <div className="field-app">
      <Title>إيصال تزويد</Title>
      <Card>
        <div style={{ textAlign: 'center' }}><CheckCircle2 size={48} color="var(--good)" /><h2 style={{ margin: '8px 0' }}>تم اعتماد العملية</h2><div className="num" style={{ fontSize: 18, fontWeight: 700 }}>{receipt.number}</div></div>
        <div className="sep" />
        <dl className="kv"><dt>الأصل</dt><dd>{receipt.asset.code} — {receipt.asset.name}</dd><dt>الكمية</dt><dd className="num">{n(receipt.qty, 1)} لتر</dd><dt>المصدر</dt><dd>{receipt.source.label}</dd>
          <dt>المشروع</dt><dd>{receipt.asset.project_code} · {receipt.asset.cost_center_code}</dd>{receipt.meter && <><dt>العداد</dt><dd className="num">{receipt.meter}</dd></>}
          {receipt.cost_halalas !== undefined && can(me, 'price.view') && <><dt>التكلفة</dt><dd className="num">{receipt.cost_halalas == null ? 'غير متوفرة' : sar(receipt.cost_halalas) + ' ر.س'}</dd></>}
          <dt>المشغّل</dt><dd>{me.user.name}</dd><dt>الوقت</dt><dd>{dt(new Date().toISOString())}</dd></dl>
        {receipt.warnings?.length > 0 && <div className="mt"><Alert tone="warn">{receipt.warnings.map((w) => w.msg).join('، ')}</Alert></div>}
        {receipt.duplicate && <div className="mt"><Alert tone="info">العملية مسجلة مسبقًا بنفس المعرف — لم تُكرر.</Alert></div>}
        <button className="btn primary lg block mt" onClick={reset}><Fuel size={18} /> عملية تالية</button>
      </Card>
    </div>
  );

  return (
    <div className="field-app">
      <Title sub="شاشة ميدانية: المصدر ← الشريحة ← الكمية">جلسة تزويد</Title>
      <div className="stack">
        <SyncBar scope="fuel" />
        <Card title="1. مصدر الوقود" actions={<select className="input" style={{ width: 'auto', padding: '5px 8px' }} value={site} onChange={(e) => { setSite(e.target.value); setSrc(null); }}><option value="">كل المواقع</option>{org?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}>
          {sources.loading ? <Spinner /> : !sources.data?.length ? <Empty>لا توجد مصادر متاحة</Empty> : (
            <div className="stack" style={{ gap: 8 }}>{sources.data.map((s) => (
              <label key={s.id} className="acct" style={src?.id === s.id ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : null}>
                <input type="radio" checked={src?.id === s.id} onChange={() => { setSrc(s); setAuth(null); setRead(null); }} />
                {s.type === 'tank' ? <Container size={20} color="var(--data)" /> : <Truck size={20} color="var(--brand)" />}
                <div className="grow"><b>{s.label}</b><div className="tiny muted">{s.site_name} · {PRODUCTS[s.product]}{s.type === 'batch' ? ' · دفعة مخصصة لا تدخل الخزان' : ''}</div></div>
                <div style={{ textAlign: 'left' }}><b className="num">{liters(s.balance_ml)}</b><div className="tiny muted">لتر متاح</div></div>
              </label>))}</div>
          )}
        </Card>
        {src && !read && (
          <Card title="2. تعريف المعدة">
            <NfcReader onRead={onTag} demoTags={demoTags} />
            {(settings.allow_qr !== false || settings.allow_manual !== false) && (
              <div className="mt"><button className="btn sm ghost" onClick={() => setAlt(alt ? null : 'manual')}><KeyRound size={14} /> الشريحة تالفة أو مفقودة؟ تحقق بديل</button>
                {alt && <div className="row mt">
                  <select className="input" style={{ maxWidth: 140 }} value={alt} onChange={(e) => setAlt(e.target.value)}>{settings.allow_qr !== false && <option value="qr">QR احتياطي</option>}{settings.allow_manual !== false && <option value="manual">مرجع الأصل يدويًا</option>}</select>
                  <select className="input grow" defaultValue="" onChange={(e) => e.target.value && onAlt(e.target.value, alt)}><option value="">اختر الأصل…</option>{(assets.data || []).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select>
                </div>}
                {alt && <div className="tiny muted" style={{ marginTop: 6 }}>تُسجل العملية كتحقق بديل وتظهر في تقرير الاستثناءات، وتخضع للصلاحيات والسقوف نفسها.</div>}
              </div>)}
          </Card>
        )}
        {busy && !auth_ && <Spinner />}
        {auth_ && (
          <Card title="3. التفويض والكمية" actions={<button className="btn sm" onClick={() => { setAuth(null); setRead(null); }}>قراءة أخرى</button>}>
            {a && (
              <div className="asset-card mb">
                <div className="row"><div className="grow"><div className="muted tiny">{CATEGORY[a.category]} · {PRODUCTS[a.fuel_type]}</div><b style={{ fontSize: 18 }}>{a.code} — {a.name}</b><div className="muted small">{a.project_code} {a.project_name} · {a.site_name} · {a.cost_center_code}</div></div>
                  {auth_.tag && <Chip tone={auth_.tag.status === 'active' ? 'good' : 'bad'}>{auth_.tag.display_no} · {auth_.tag.status_ar}</Chip>}{read?.verification !== 'nfc' && <Chip tone="warn">{VERIFY[read.verification]}</Chip>}</div>
                <div className="tiny muted mt" style={{ marginTop: 6 }}>سقف العملية {liters(a.per_tx_limit_ml)} · اليومي {liters(a.daily_limit_ml)} لتر</div>
              </div>
            )}
            {auth_.reasons.length > 0 && <Alert tone="bad"><b>رُفض التفويض</b><ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{auth_.reasons.map((r, i) => <li key={i}>{r.msg}</li>)}</ul></Alert>}
            {auth_.warnings.length > 0 && <div className="mt" style={{ marginTop: 8 }}><Alert tone="warn">{auth_.warnings.map((w) => w.msg).join('، ')}</Alert></div>}
            {a && auth_.reasons.filter((r) => !['meter_required', 'qty'].includes(r.code)).length === 0 && (
              <div className="stack mt">
                <div className="grid g2">
                  <Field label="الكمية الفعلية (لتر)"><input autoFocus type="number" inputMode="decimal" className="input" style={{ fontSize: 22, fontWeight: 700 }} value={form.quantity_liters} onChange={(e) => setForm({ ...form, quantity_liters: e.target.value })} /></Field>
                  {a.meter_type !== 'none' && <Field label={a.meter_type === 'km' ? 'عداد الكيلومترات' : 'ساعات التشغيل'}><input type="number" inputMode="decimal" className="input" style={{ fontSize: 22 }} value={form.meter_value} onChange={(e) => setForm({ ...form, meter_value: e.target.value })} /></Field>}
                </div>
                <Field label="مصدر القياس"><select className="input" value={form.measure_source} onChange={(e) => setForm({ ...form, measure_source: e.target.value })}><option value="pump_meter">عداد المضخة (قراءة يدوية)</option><option value="manual">تقدير يدوي</option><option value="tank_dip">قياس الخزان</option></select></Field>
                <button className="btn primary lg block" disabled={busy || !form.quantity_liters} onClick={submit}><CheckCircle2 size={20} /> اعتماد التزويد</button>
                {!navigator.onLine && <Alert tone="warn"><WifiOff size={14} /> دون اتصال: ستُحفظ كمسودة معلقة حتى يعيد الخادم التحقق.</Alert>}
              </div>
            )}
          </Card>
        )}
        <div className="row"><button className="btn sm ghost" onClick={() => navigate('/fuel/log')}>سجل العمليات ←</button></div>
      </div>
    </div>
  );
}

export function FuelLog() {
  const me = useMe();
  const org = useApi('/org').data;
  const [f, setF] = useState({ from: '', to: '', project_id: '', site_id: '', tank_id: '', verification: '', status: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const r = useApi('/fuelings?' + qs, [qs]);
  const sum = (r.data || []).filter((x) => x.status === 'approved').reduce((s, x) => s + x.quantity_ml, 0);
  return (
    <>
      <Title sub="سجل التزويد وعمليات NFC">سجل التزويد</Title>
      <div className="filters">
        <input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} title="من" />
        <input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} title="إلى" />
        <select className="input" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">كل المشاريع</option>{org?.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
        <select className="input" value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}><option value="">كل المواقع</option>{org?.sites.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="input" value={f.tank_id} onChange={(e) => setF({ ...f, tank_id: e.target.value })}><option value="">كل الخزانات</option>{org?.tanks.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
        <select className="input" value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })}><option value="">كل طرق التحقق</option>{Object.entries(VERIFY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <div className="grow" />
        <a className="btn" href={`/api/reports/fuelings.csv?${qs}&token=${auth.token}`}><Download size={15} /> تصدير Excel/CSV</a>
        {can(me, 'fueling.create') && <button className="btn primary" onClick={() => navigate('/fuel')}><Fuel size={15} /> جلسة تزويد</button>}
      </div>
      <Card flush title={`${r.data?.length ?? 0} عملية · ${liters(sum)} لتر معتمد`}>{r.loading ? <Spinner /> : !r.data.length ? <Empty /> : <div className="tscroll"><table className="t">
        <thead><tr><th>العملية</th><th>الوقت</th><th>الأصل</th><th>الشريحة / التحقق</th><th>اللترات</th>{can(me, 'price.view') && <th>التكلفة</th>}<th>المصدر</th><th>المشروع</th><th>العداد</th><th>المشغّل</th><th>الحالة</th></tr></thead>
        <tbody>{r.data.map((x) => (
          <tr key={x.id} className="click" onClick={() => navigate('/fuelings/' + x.id)}>
            <td className="num"><b>{x.number}</b></td><td className="small">{dt(x.created_at)}</td>
            <td><b>{x.asset_code}</b><div className="tiny muted">{x.asset_name}</div></td>
            <td className="small">{x.tag_display_no || '—'} <Chip tone={x.verification === 'nfc' ? 'good' : 'warn'}>{VERIFY[x.verification]}</Chip></td>
            <td className="num"><b>{liters(x.quantity_ml, 1)}</b></td>
            {can(me, 'price.view') && <td className="num small">{x.cost_halalas == null ? <Chip tone="warn">غير متوفرة</Chip> : sar(x.cost_halalas)}</td>}
            <td className="small">{x.source_type === 'tank' ? `خزان ${x.tank_code}` : <>مباشر · {x.trip_number}</>}</td>
            <td className="small">{x.project_code}</td><td className="num small">{x.meter_value ?? '—'}</td><td className="small">{x.operator_name}</td>
            <td><Chip tone={{ approved: 'good', rejected: 'bad', draft: 'warn' }[x.status]}>{{ approved: 'معتمدة', rejected: 'مرفوضة', draft: 'مسودة', reversed: 'معكوسة' }[x.status]}</Chip>{x.corrects_number && <div className="tiny muted">تصحيح {x.corrects_number}</div>}</td>
          </tr>))}</tbody></table></div>}</Card>
    </>
  );
}

export function FuelingDetail({ id }) {
  const me = useMe();
  const r = useApi('/fuelings/' + id);
  const [modal, setModal] = useState(false);
  const [v, setV] = useState({ new_quantity_liters: '', reason: '' });
  if (r.error) return <Empty>{r.error.message}</Empty>;
  if (!r.data) return <Spinner />;
  const x = r.data;
  const save = async () => { try { const c = await api(`/fuelings/${x.id}/correct`, { method: 'POST', body: v }); toast(`أُنشئت حركة التصحيح ${c.number}`); setModal(false); r.reload(); } catch (e) { fail(e); } };
  return (
    <>
      <Title sub="إيصال العملية وسجل التدقيق">عملية {x.number}</Title>
      <div className="grid g2">
        <Card title="تفاصيل العملية" actions={<><button className="btn sm" onClick={() => print()}><Printer size={14} /> طباعة</button>{can(me, 'exception.decide') && x.status === 'approved' && !x.corrects_number && <button className="btn sm" onClick={() => setModal(true)}><RotateCcw size={14} /> تصحيح</button>}</>}>
          <dl className="kv">
            <dt>الحالة</dt><dd><Chip tone={x.status === 'approved' ? 'good' : 'bad'}>{x.status === 'approved' ? 'معتمدة' : x.status}</Chip> {x.reject_reason && <span className="small">{x.reject_reason}</span>}</dd>
            <dt>الأصل</dt><dd><a href={'/assets/' + x.asset_id} onClick={(e) => { e.preventDefault(); navigate('/assets/' + x.asset_id); }} style={{ color: 'var(--brand-2)' }}>{x.asset_code} — {x.asset_name}</a></dd>
            <dt>الكمية</dt><dd className="num">{liters(x.quantity_ml, 3)} لتر ({x.measure_source})</dd>
            <dt>نوع الوقود</dt><dd>{PRODUCTS[x.product]}</dd>
            {can(me, 'price.view') && <><dt>التكلفة</dt><dd className="num">{x.cost_halalas == null ? 'غير متوفرة' : sar(x.cost_halalas) + ' ر.س'}</dd></>}
            <dt>التحقق</dt><dd>{VERIFY[x.verification]} {x.tag_display_no}</dd>
            <dt>العداد</dt><dd className="num">{x.meter_value ?? '—'} {x.meter_unit}</dd>
            <dt>المصدر</dt><dd>{x.source_type === 'tank' ? `خزان ${x.tank_code}` : `تزويد مباشر من رحلة ${x.trip_number}`}</dd>
            {x.trip_number && <><dt>الرحلة / الطلب</dt><dd>{x.trip_number} · {x.order_number} · مستند {x.doc_number}</dd></>}
            <dt>المشروع (وقت التنفيذ)</dt><dd>{x.project_code} {x.project_name}</dd><dt>مركز التكلفة</dt><dd>{x.cost_center_code} {x.cost_center_name}</dd><dt>الموقع</dt><dd>{x.site_name}</dd>
            <dt>المشغّل</dt><dd>{x.operator_name}</dd><dt>وقت الالتقاط</dt><dd>{dt(x.captured_at)}</dd><dt>وقت الاعتماد</dt><dd>{dt(x.approved_at)}</dd>
            {x.exception_flag && <><dt>تنبيه</dt><dd><Chip tone="warn">{x.exception_flag}</Chip></dd></>}
          </dl>
        </Card>
        <div className="stack">
          {x.corrections.length > 0 && <Card title="حركات التصحيح">{x.corrections.map((c) => <div key={c.number} className="small"><b className="num">{c.number}</b> · <span className="num">{liters(c.quantity_ml, 1)}</span> لتر · {c.reason} · {dt(c.created_at)}</div>)}</Card>}
          <Card title="سجل التدقيق">{x.audit.map((a) => <div key={a.id} className="small" style={{ marginBottom: 6 }}><b>{a.action}</b> · {a.by_name} · {dt(a.at)}<div className="tiny muted" style={{ direction: 'ltr', textAlign: 'right' }}>{a.data_json}</div></div>)}</Card>
        </div>
      </div>
      {modal && (
        <Modal title="تصحيح عملية معتمدة" onClose={() => setModal(false)} footer={<button className="btn primary" onClick={save}>إنشاء حركة تصحيح</button>}>
          <Alert tone="info">لا تُعدّل العملية الأصلية. تُنشأ حركة تصحيح مرتبطة بالفرق، بموافقتك وسببك، على نفس المشروع ومركز التكلفة الأصليين. يجب أن تكون دورًا مختلفًا عن المنفذ.</Alert>
          <div className="stack mt"><Field label="الكمية الصحيحة (لتر)"><input type="number" className="input" value={v.new_quantity_liters} onChange={(e) => setV({ ...v, new_quantity_liters: e.target.value })} /></Field>
            <Field label="السبب"><textarea className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field></div>
        </Modal>
      )}
    </>
  );
}
