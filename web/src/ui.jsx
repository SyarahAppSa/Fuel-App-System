import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, Nfc, Radio, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { setToaster, liters, n } from './lib.js';

export function Card({ title, actions, children, flush, className = '', icon }) {
  return (
    <section className={'card ' + className}>
      {(title || actions) && <div className="hd">{icon}{title && <h3>{title}</h3>}<div className="grow" />{actions}</div>}
      <div className={'bd' + (flush ? ' flush' : '')}>{children}</div>
    </section>
  );
}
export const Chip = ({ tone = '', children, title }) => <span className={'chip ' + tone} title={title}>{children}</span>;
export const Empty = ({ children = 'لا توجد بيانات' }) => <div className="empty">{children}</div>;
export const Spinner = () => <div className="empty"><Loader2 className="spin" size={22} style={{ animation: 'spin 1s linear infinite' }} /><style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style></div>;
export const Field = ({ label, hint, children }) => <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
export function Alert({ tone = 'info', children }) {
  const I = { bad: AlertTriangle, warn: AlertTriangle, good: CheckCircle2, info: Info }[tone];
  return <div className={'alert ' + tone}><I size={17} style={{ flexShrink: 0, marginTop: 1 }} /><div>{children}</div></div>;
}

export function Kpi({ label, value, unit, foot, onClick, icon: I, tone }) {
  return (
    <div className="card kpi" onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {I && <I className="ico" size={26} />}
      <div className="lbl">{label}</div>
      <div className="val" style={tone ? { color: `var(--${tone})` } : null}><span className="num">{value}</span>{unit && <small>{unit}</small>}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(860px,100%)' } : null}>
        <div className="hd"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div>
        <div className="bd">{children}</div>
        {footer && <div className="ft">{footer}</div>}
      </div>
    </div>
  );
}

export function Toaster() {
  const [t, set] = useState(null);
  useEffect(() => { let h; setToaster((msg, kind) => { set({ msg, kind }); clearTimeout(h); h = setTimeout(() => set(null), 4200); }); }, []);
  return t ? <div className={'toast ' + (t.kind || '')} role="status">{t.msg}</div> : null;
}

export function Meter({ value, max, mark, tone }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className="meter" title={`${n(pct, 0)}%`}><i className={tone} style={{ width: pct + '%' }} />{mark != null && max ? <b style={{ insetInlineStart: Math.min(100, (mark / max) * 100) + '%' }} /> : null}</div>;
}

export function TankGauge({ t }) {
  const pct = t.capacity_ml ? Math.max(0, Math.min(1, t.book_ml / t.capacity_ml)) : 0;
  const low = t.book_ml <= t.reorder_ml;
  return (
    <div className="tank">
      <div className="vessel" title={`${Math.round(pct * 100)}%`}><i style={{ height: pct * 100 + '%' }} /><b style={{ bottom: (t.reorder_ml / t.capacity_ml) * 100 + '%' }} /></div>
      <div className="stack" style={{ gap: 4 }}>
        <b>{t.code} <span className="muted small">{t.name}</span></b>
        <div className="small muted">{t.site_name}</div>
        <div><span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{liters(t.book_ml)}</span> <span className="muted small">/ {liters(t.capacity_ml)} لتر</span></div>
        {low ? <Chip tone="warn"><AlertTriangle size={12} /> تحت حد إعادة الطلب ({liters(t.reorder_ml)})</Chip> : <span className="small muted">{Math.round(pct * 100)}% من السعة</span>}
      </div>
    </div>
  );
}

/** أعمدة سلسلة واحدة: لون واحد، بدون مفتاح، تلميح عند المرور */
export function Bars({ data, unit = 'لتر', format = (v) => n(v) }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars" role="img" aria-label="رسم بياني للصرف اليومي">
      {data.map((d) => (
        <div className="b" key={d.key}>
          <div className="tip">{d.label}: {format(d.value)} {unit}</div>
          <i style={{ height: `${(d.value / max) * 100}%` }} />
          <span>{d.short}</span>
        </div>
      ))}
    </div>
  );
}

export function Steps({ steps, current, done = [] }) {
  return <div className="steps">{steps.map((s) => <div key={s.key} className={'s ' + (done.includes(s.key) ? 'done' : '') + (s.key === current ? ' cur' : '')}><i />{s.label}</div>)}</div>;
}

/* ------------------------------------------------------------------ */
/* قارئ NFC: Web NFC على Android Chrome + محاكي للعرض + إدخال المعرف     */
/* ------------------------------------------------------------------ */
export const nfcSupported = () => typeof window !== 'undefined' && 'NDEFReader' in window;
const norm = (s) => String(s || '').replace(/[^0-9a-f]/gi, '').toUpperCase();

export function NfcReader({ onRead, demoTags = [], label = 'اقرأ شريحة المعدة', compact }) {
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState('');
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  async function scan() {
    setErr(null);
    try {
      const reader = new window.NDEFReader();
      ctrl.current = new AbortController();
      await reader.scan({ signal: ctrl.current.signal });
      setScanning(true);
      reader.onreading = (e) => { setScanning(false); ctrl.current.abort(); navigator.vibrate?.(80); onRead(norm(e.serialNumber)); };
      reader.onreadingerror = () => setErr('تعذرت قراءة الشريحة، قرّب الجهاز وأعد المحاولة');
    } catch (e) { setScanning(false); setErr(e.name === 'NotAllowedError' ? 'رُفض إذن NFC في المتصفح' : 'تعذر تشغيل قارئ NFC: ' + e.message); }
  }
  return (
    <div className={'scan' + (scanning ? ' on' : '')} style={compact ? { padding: 14 } : null}>
      <Nfc size={compact ? 28 : 40} color="var(--brand)" />
      <div style={{ fontWeight: 600, margin: '8px 0 12px' }}>{scanning ? 'قرّب الجهاز من الشريحة...' : label}</div>
      {nfcSupported()
        ? <button className="btn primary lg" onClick={scan} disabled={scanning}><Radio size={18} /> {scanning ? 'جارٍ المسح' : 'مسح عبر NFC'}</button>
        : <div className="small muted mb">قارئ Web NFC غير متاح على هذا المتصفح (يعمل على Chrome في Android). استخدم المحاكي أو أدخل المعرف.</div>}
      {err && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{err}</div>}
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        {demoTags.length > 0 && (
          <select className="input" style={{ maxWidth: 260 }} value="" onChange={(e) => e.target.value && onRead(e.target.value)} aria-label="محاكاة قراءة">
            <option value="">محاكاة قراءة شريحة (عرض)…</option>
            {demoTags.map((t) => <option key={t.uid} value={t.uid}>{t.display_no} — {t.asset_code || 'غير مرتبطة'} ({t.status_ar || t.status})</option>)}
          </select>
        )}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (norm(manual)) onRead(norm(manual)); }}>
          <input className="input" style={{ width: 170, direction: 'ltr' }} placeholder="UID مثل 04A1B2…" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="btn sm">قراءة</button>
        </form>
      </div>
    </div>
  );
}
