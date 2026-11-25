import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';

/* ---------------- API ---------------- */
export const auth = {
  get token() { try { return localStorage.getItem('hj_token'); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem('hj_token', v) : localStorage.removeItem('hj_token'); } catch {} },
};

export class ApiError extends Error { constructor(status, msg, details) { super(msg); this.status = status; this.details = details; } }

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let r;
  try { r = await fetch('/api' + path, { method, headers, body: payload }); }
  catch { throw new ApiError(0, 'تعذر الاتصال بالخادم'); }
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    if (r.status === 401 && path !== '/auth/login') { auth.token = null; location.href = '/'; }
    throw new ApiError(r.status, data?.error || 'حدث خطأ', data?.details);
  }
  return data;
}

/** وضع العرض المفتوح: دخول بحساب تجريبي دون كلمة مرور */
export async function demoEnter(email) {
  const r = await api('/demo/enter', { method: 'POST', body: email ? { email } : {} });
  auth.token = r.token;
  try { sessionStorage.removeItem('hj_manual'); } catch {}
  return r;
}

export function useApi(path, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    if (!path) return;
    set((s) => ({ ...s, loading: true }));
    api(path).then((data) => set({ data, error: null, loading: false })).catch((error) => set({ data: null, error, loading: false }));
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/* ---------------- router ---------------- */
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
window.addEventListener('popstate', emit);
export function navigate(to, replace) { replace ? history.replaceState(null, '', to) : history.pushState(null, '', to); emit(); window.scrollTo(0, 0); }
export function usePath() { return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => location.pathname + location.search); }
export function match(pattern, path) {
  const p = pattern.split('/'), a = path.split('?')[0].split('/');
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) { if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]); else if (p[i] !== a[i]) return null; }
  return params;
}
export const query = () => Object.fromEntries(new URLSearchParams(location.search));

/* ---------------- toast ---------------- */
let toastFn = () => {};
export const setToaster = (fn) => { toastFn = fn; };
export const toast = (msg, kind) => toastFn(msg, kind);
export const fail = (e) => toast(e?.message || String(e), 'bad');

/* ---------------- formatting (توقيت الرياض، أرقام لاتينية للقراءة الميدانية) ---------------- */
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const n = (v, d = 0) => (v == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v));
export const liters = (ml, d = 0) => (ml == null ? '—' : n(ml / 1000, d));
export const sar = (h) => (h == null ? null : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(h / 100));
export const dt = (iso, opt = {}) => iso ? new Date(iso).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...opt }) : '—';
export const dOnly = (iso) => iso ? new Date(iso).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const today = (off = 0) => new Date(Date.now() + off * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);
export const ago = (iso) => {
  if (!iso) return '—'; const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'الآن'; if (m < 60) return `قبل ${m} د`; const h = Math.round(m / 60); if (h < 24) return `قبل ${h} س`; return `قبل ${Math.round(h / 24)} يوم`;
};
export { nf };
export const PRODUCTS = { diesel: 'ديزل', gasoline91: 'بنزين 91', gasoline95: 'بنزين 95' };
export const CATEGORY = { heavy_equipment: 'معدة ثقيلة', generator: 'مولد', vehicle: 'مركبة', fixed: 'أصل ثابت' };
export const VERIFY = { nfc: 'NFC', qr: 'QR بديل', manual: 'إدخال يدوي' };
export const EXC_TYPE = { quantity_variance: 'فرق كمية', missing_proof: 'إثبات ناقص', alt_verification: 'تحقق بديل', stock_variance: 'فرق جرد', offline_conflict: 'تعارض مزامنة', eligibility_change: 'تغير أهلية' };
export const TAG_TONE = { active: 'good', pending_activation: 'info', in_custody: '', suspended: 'warn', lost: 'bad', damaged: 'bad', replaced: '' };
export const TRIP_TONE = { awaiting_acceptance: 'warn', awaiting_assignment: 'warn', assigned: 'info', to_loading: 'info', at_loading: 'info', loaded: 'info', to_delivery: 'info', at_site: 'brand', delivered: 'brand', under_review: 'bad', closed: 'good', cancelled: '', rejected: 'bad', on_hold: 'warn' };
export const opId = () => 'op_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random().toString(16).slice(2));

export function getPosition() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({});
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res({}), { timeout: 3000, maximumAge: 60000 });
  });
}

/* ---------------- لوحة الألوان ---------------- */
export const PALETTES = [
  { key: 'royal', label: 'الملكي (الحالي)', swatch: ['#1a1db5', '#05096e'], meta: '#000098' },
  { key: 'petrol', label: 'البترولي', swatch: ['#0f7686', '#e8900c'], meta: '#0a5562' },
  { key: 'emerald', label: 'الزمردي', swatch: ['#0f7a4f', '#b8860b'], meta: '#0a5c3b' },
  { key: 'graphite', label: 'الفحمي', swatch: ['#ea580c', '#1b1e24'], meta: '#1b1e24' },
];
export function getPalette() { try { return localStorage.getItem('hj_palette') || 'royal'; } catch { return 'royal'; } }
export function applyPalette(key) {
  const p = PALETTES.find((x) => x.key === key) || PALETTES[0];
  if (p.key === 'royal') delete document.documentElement.dataset.palette; else document.documentElement.dataset.palette = p.key;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.meta);
  try { localStorage.setItem('hj_palette', p.key); } catch {}
  return p.key;
}
