import React, { useEffect, useState } from 'react';
import { Me } from './ctx.jsx';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard, FileText, Truck, MapPin, Tractor, Nfc, Fuel, Container, FileSignature, CheckSquare, BarChart3, Wallet, Settings as Cog,
  Menu, Bell, LogOut, Users, Route, ShieldCheck, ClipboardCheck, Crown, Headset, UserCog,
} from 'lucide-react';
import './styles.css';
import { api, auth, usePath, navigate, match, useApi, ago, demoEnter, fail } from './lib.js';
import { Toaster, Spinner } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { NewOrder, Documents } from './pages/Orders.jsx';
import { TripList, TripDetail } from './pages/Trips.jsx';
import { AssetList, AssetReport } from './pages/Assets.jsx';
import NfcTags from './pages/Nfc.jsx';
import { FuelSession, FuelLog, FuelingDetail } from './pages/Fueling.jsx';
import { Tanks, TankDetail } from './pages/Tanks.jsx';
import Approvals from './pages/Approvals.jsx';
import Reports from './pages/Reports.jsx';
import { Projects, Settings } from './pages/Settings.jsx';
import { CarrierOverview, Fleet } from './pages/Carrier.jsx';
import { DriverHome, DriverTrip } from './pages/Driver.jsx';
import Admin from './pages/Admin.jsx';
import Receipt from './pages/Receipt.jsx';
import Soon from './pages/Soon.jsx';
import Contracts from './pages/Contracts.jsx';


const CLIENT_NAV = [
  { grp: 'التشغيل' },
  { to: '/', label: 'نظرة عامة', icon: LayoutDashboard },
  { to: '/orders/new', label: 'طلبات النقل والتوريد', icon: FileText, cap: 'order.create' },
  { to: '/trips', label: 'الرحلات', icon: Truck, cap: 'order.view' },
  { to: '/projects', label: 'المشاريع والمواقع', icon: MapPin, cap: 'asset.view' },
  { grp: 'الوقود والأصول' },
  { to: '/assets', label: 'المعدات والمركبات', icon: Tractor, cap: 'asset.view' },
  { to: '/nfc', label: 'شرائح NFC', icon: Nfc, cap: 'nfc.manage' },
  { to: '/fuel', label: 'التزويد', icon: Fuel, cap: ['fueling.create', 'fueling.view'] },
  { to: '/tanks', label: 'الخزانات والمخزون', icon: Container, cap: 'inventory.view' },
  { grp: 'الإدارة' },
  { to: '/contracts', label: 'العقود والباقات', icon: FileSignature, cap: ['order.create', 'report.view', 'finance.view'] },
  { to: '/approvals', label: 'الموافقات', icon: CheckSquare, cap: ['exception.decide', 'fueling.view'] },
  { to: '/reports', label: 'التقارير', icon: BarChart3, cap: ['report.view', 'inventory.view'] },
  { to: '/finance', label: 'المالية', icon: Wallet, soon: true },
  { to: '/settings', label: 'الإعدادات', icon: Cog, cap: 'org.manage' },
];
const CARRIER_NAV = [
  { grp: 'الناقل' },
  { to: '/', label: 'نظرة عامة', icon: LayoutDashboard },
  { to: '/trips', label: 'الطلبات والرحلات', icon: Route },
  { to: '/fleet', label: 'الأسطول والأسعار', icon: Truck },
  { to: '/contracts', label: 'العقود والباقات والسعة', icon: FileSignature },
];
const DRIVER_NAV = [{ grp: 'السائق' }, { to: '/', label: 'رحلاتي', icon: Truck }];
const RECEIVER_NAV = [{ grp: 'مستلم الموقع' }, { to: '/', label: 'رحلات موقعي', icon: ClipboardCheck }];
const ADMIN_NAV = [{ grp: 'إدارة فيول آب' }, { to: '/', label: 'المنصة', icon: ShieldCheck }, { to: '/trips', label: 'كل الرحلات', icon: Route }];

function routes(me) {
  const t = me.company.type, role = me.role;
  if (role === 'platform_admin') return [['/', Admin], ['/trips', TripList], ['/trips/:id', TripDetail]];
  if (role === 'driver') return [['/', DriverHome], ['/trips/:id', DriverTrip]];
  if (t === 'carrier') return [['/', CarrierOverview], ['/trips', TripList], ['/trips/:id', TripDetail], ['/fleet', Fleet], ['/contracts', Contracts]];
  if (role === 'site_receiver') return [['/', TripList], ['/trips', TripList], ['/trips/:id', TripDetail]];
  return [
    ['/', role === 'fuel_supervisor' ? FuelSession : Dashboard], ['/dashboard', Dashboard], ['/orders/new', NewOrder], ['/documents', Documents], ['/trips', TripList], ['/trips/:id', TripDetail],
    ['/projects', Projects], ['/assets', AssetList], ['/assets/:id', AssetReport], ['/nfc', NfcTags], ['/fuel', FuelSession], ['/fuel/log', FuelLog], ['/fuelings/:id', FuelingDetail],
    ['/tanks', Tanks], ['/tanks/:id', TankDetail], ['/approvals', Approvals], ['/reports', Reports], ['/settings', Settings], ['/contracts', Contracts], ['/finance', Soon],
  ];
}

function Shell({ me, reloadMe, openDemo }) {
  const accounts = useApi(openDemo ? '/demo-accounts' : null, [openDemo]);
  const enterAs = async (email) => { try { await demoEnter(email); navigate('/'); reloadMe(); } catch (e) { fail(e); } };
  const path = usePath();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const notes = useApi(bell ? '/notifications' : null, [bell]);
  const nav = me.role === 'platform_admin' ? ADMIN_NAV : me.role === 'driver' ? DRIVER_NAV : me.company.type === 'carrier' ? CARRIER_NAV : me.role === 'site_receiver' ? RECEIVER_NAV : CLIENT_NAV;
  const has = (cap) => !cap || (Array.isArray(cap) ? cap : [cap]).some((c) => me.caps.includes(c));
  let page = null, params = {};
  for (const [p, C] of routes(me)) { const m = match(p, path); if (m) { page = C; params = m; break; } }
  const Page = page || (() => <div className="empty">الصفحة غير موجودة</div>);
  const switchTo = async (id) => { const r = await api('/auth/switch', { method: 'POST', body: { membership_id: id } }); auth.token = r.token; navigate('/'); reloadMe(); };
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch {} auth.token = null; try { sessionStorage.setItem('hj_manual', '1'); } catch {} location.href = '/'; };
  useEffect(() => setOpen(false), [path]);
  const initials = (me.company.name.replace(/[()]/g, '').split(/\s+/).find((w) => !['شركة', 'مصنع', 'مؤسسة'].includes(w)) || 'ه').replace(/^ال/, '')[0];
  return (
    <Me.Provider value={me}>
      <div className="shell">
        <aside className={'side' + (open ? ' open' : '')}>
          <div className="logo"><div><b>فيول آب</b><small>نقل وإدارة الوقود للشركات</small></div><img src="/brand/logo-mark.png" className="brand-logo" alt="فيول آب" /></div>
          <div className="org"><div className="av">{initials}</div><div><b>{me.company.name}</b><small>{{ client: 'شركة عميلة', carrier: 'شركة نقل', platform: 'إدارة المنصة' }[me.company.type]}</small></div></div>
          <nav>
            {nav.map((it, i) => it.grp ? <div className="grp" key={i}>{it.grp}</div> : has(it.cap) && (
              <a key={it.to} href={it.to} className={'item' + ((it.to === '/' ? path === '/' : path.startsWith(it.to.replace('/new', ''))) ? ' on' : '') + (it.soon ? ' soon' : '')}
                onClick={(e) => { e.preventDefault(); navigate(it.to); }}>
                <it.icon size={19} />{it.label}{it.soon && <span className="tag">نسخة الشركات</span>}
              </a>
            ))}
          </nav>
          <div className="foot">
            {me.company.type === 'client' && <button className="pill" onClick={() => navigate('/contracts')}><Crown size={17} /> العقود والباقات</button>}
            <a className="pill" href="mailto:support@fuelapp.demo"><Headset size={17} /> الدعم والمساعدة</a>
          </div>
          <div className="me">
            <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{me.user.name}</div>
            <div>{me.role_ar}</div>
            {me.memberships.length > 1 && (
              <select value={me.current_membership} onChange={(e) => switchTo(e.target.value)} aria-label="تبديل الشركة">
                {me.memberships.map((m) => <option key={m.id} value={m.id}>{m.company_name} — {m.role_ar}</option>)}
              </select>
            )}
          </div>
        </aside>
        <div className="main">
          <div className="rolebar"><UserCog size={18} /><span className="grow">أنت تستخدم حساب {me.role_ar} في {me.company.name}{openDemo && ' — وضع العرض: الدخول بلا كلمة مرور'}</span><span className="demo-badge" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', borderColor: 'rgba(255,255,255,.25)' }}>بيانات تجريبية</span><button onClick={logout}>خروج</button></div>
          <div className="top">
            <button className="circle-btn menu-btn" onClick={() => setOpen(!open)} aria-label="القائمة"><Menu size={20} /></button>
            <div id="page-title" className="grow" />
            <div style={{ position: 'relative' }}>
              <button className="circle-btn" onClick={() => { setBell(!bell); if (!bell && me.unread) api('/notifications/read', { method: 'POST' }).then(reloadMe); }} aria-label="الإشعارات">
                <Bell size={19} />{me.unread > 0 && <span className="badge">{me.unread}</span>}
              </button>
              {bell && (
                <div className="card" style={{ position: 'absolute', insetInlineEnd: 0, top: 52, width: 340, maxHeight: 420, overflowY: 'auto', zIndex: 30 }}>
                  {(notes.data || []).length === 0 ? <div className="empty">لا توجد إشعارات</div> : notes.data.map((x) => (
                    <a key={x.id} href={x.link} onClick={(e) => { e.preventDefault(); setBell(false); navigate(x.link.replace('/carrier', '')); }} style={{ display: 'block', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{x.title}</div><div className="small muted">{x.body} · {ago(x.created_at)}</div>
                    </a>
                  ))}
                </div>
              )}
            </div>
            {openDemo && accounts.data && (
              <select className="input" style={{ width: 'auto', maxWidth: 260, borderRadius: 22 }} value={me.user.email} onChange={(e) => enterAs(e.target.value)} aria-label="تبديل الحساب بلا كلمة مرور" title="وضع العرض: تبديل الحساب بلا كلمة مرور">
                {[...new Map(accounts.data.map((a) => [a.email, a])).values()].map((a) => <option key={a.email} value={a.email}>{a.name} — {a.role_ar} · {a.company}</option>)}
              </select>
            )}
            <div className="who"><span className="nm">{me.user.name}</span><span className="av">{me.user.name.replace(/^م\.\s*/, '')[0]}</span></div>
          </div>
          <div className="content"><Page {...params} key={path.split('?')[0]} /></div>
        </div>
      </div>
      {open && <div className="modal-bg" style={{ zIndex: 55, background: 'rgba(0,0,0,.3)' }} onClick={() => setOpen(false)} />}
    </Me.Provider>
  );
}

function App() {
  const path = usePath();
  const [me, setMe] = useState(undefined);
  const [open, setOpen] = useState(false);
  const load = async () => {
    if (!auth.token) {
      const cfg = await api('/demo/config').catch(() => ({ open: false }));
      setOpen(cfg.open);
      let manual = false; try { manual = sessionStorage.getItem('hj_manual') === '1'; } catch {}
      if (cfg.open && !manual) { try { await demoEnter(); } catch { return setMe(null); } }
      else return setMe(null);
    }
    return api('/me').then((m) => { setMe(m); api('/demo/config').then((c) => setOpen(c.open)).catch(() => {}); }).catch(() => setMe(null));
  };
  useEffect(() => { load(); }, []);
  const r = match('/r/:token', path);
  if (r) return <Receipt token={r.token} />;
  if (me === undefined) return <Spinner />;
  if (!me) return <Login onDone={load} open={open} />;
  return <Shell me={me} reloadMe={load} openDemo={open} />;
}

createRoot(document.getElementById('root')).render(<><App /><Toaster /></>);
