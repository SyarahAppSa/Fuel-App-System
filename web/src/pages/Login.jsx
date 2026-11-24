import React, { useState } from 'react';
import { LogIn, Building2, Truck, UserRound, ShieldCheck } from 'lucide-react';
import { api, auth, useApi, fail } from '../lib.js';

const TYPE = { client: ['الشركات العميلة', Building2], carrier: ['الناقلون والسائقون', Truck], platform: ['إدارة فيول آب', ShieldCheck] };

export default function Login({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const demo = useApi('/demo-accounts');
  async function login(e, em = email, pw = password) {
    e?.preventDefault(); setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email: em, password: pw } });
      auth.token = r.token; history.replaceState(null, '', '/'); onDone();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  const groups = {};
  for (const a of demo.data || []) {
    if (a.company.includes('الجنوب')) continue;
    (groups[a.type] ||= {})[a.company] ||= [];
    if (!groups[a.type][a.company].some((x) => x.email === a.email)) groups[a.type][a.company].push(a);
  }
  return (
    <div className="login">
      <div className="hero">
        <div className="row"><div style={{ background: "#fff", borderRadius: 20, padding: "10px 16px" }}><img src="/brand/logo-full.png" alt="فيول آب" style={{ height: 96, display: "block" }} /></div></div>
        <div>
          <h1>الوقود من مستند أرامكو<br />إلى آخر لتر في المعدة.</h1>
          <p>منصة سعودية تجمع سوق نقل الوقود للشركات وإدارة الوقود داخل مواقعها: احجز الناقل، تابع الصهريج، استلم في الخزان، ووزّع على المعدات بشرائح NFC — مع تتبع كامل لكل عملية ولكل لتر.</p>
          <div className="pts">
            <div>مقارنة الناقلين المؤهلين بأسعار شفافة وتفصيل الرسوم</div>
            <div>الصور الأربع وتأكيد المستلم لكل تسليم</div>
            <div>دفتر مخزون للخزانات والتزويد المباشر دون ازدواج</div>
            <div>تقرير لكل معدة: من زوّدها ومتى وكم ومن أين</div>
          </div>
        </div>
        <div className="small" style={{ color: '#6f8699' }}>بيئة عرض — جميع البيانات تجريبية</div>
      </div>
      <div className="form">
        <h2 style={{ fontSize: 24, marginBottom: 6 }}>تسجيل الدخول</h2>
        <p className="muted" style={{ marginTop: 0 }}>اختر حساب تجربة أو ادخل ببريدك.</p>
        <form onSubmit={login} className="stack">
          <input className="input" type="email" placeholder="البريد الإلكتروني" value={email} onChange={(e) => setEmail(e.target.value)} style={{ direction: 'ltr', textAlign: 'right' }} required />
          <input className="input" type="password" placeholder="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn primary lg" disabled={busy}><LogIn size={18} /> دخول</button>
        </form>
        <div className="sep" style={{ margin: '22px 0 14px' }} />
        <div className="small muted mb">حسابات التجربة (كلمة المرور: <b className="num">FuelApp@2026</b>)</div>
        <div className="stack" style={{ gap: 14, maxHeight: '52vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
          {['client', 'carrier', 'platform'].filter((t) => groups[t]).map((t) => {
            const [label, I] = TYPE[t];
            return (
              <div key={t}>
                <div className="row small" style={{ fontWeight: 600, marginBottom: 6 }}><I size={15} /> {label}</div>
                {Object.entries(groups[t]).map(([co, list]) => (
                  <div key={co} style={{ marginBottom: 8 }}>
                    <div className="tiny muted" style={{ marginBottom: 4 }}>{co}</div>
                    <div className="grid g2" style={{ gap: 6 }}>
                      {list.map((a) => (
                        <button key={a.email + a.role} className="acct" onClick={() => login(null, a.email, 'FuelApp@2026')} disabled={busy}>
                          <UserRound size={16} color="var(--brand)" /><div><div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div><div className="tiny muted">{a.role_ar}</div></div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
