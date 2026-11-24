// صندوق الصادر الميداني: يحفظ أحداث الرحلة والصور ومسودات التزويد محليًا عند انقطاع الشبكة
// كل عنصر يحمل معرف عملية (client_op_id) ثابتًا، فإعادة الإرسال لا تكرر الحركة على الخادم.
import { auth } from './lib.js';

const DB = 'fuelapp-outbox', STORE = 'ops';
const subs = new Set();
let cache = [];

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function withStore(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode); const st = tx.objectStore(STORE); const out = fn(st);
    tx.oncomplete = () => res(out?.result ?? out); tx.onerror = () => rej(tx.error);
  });
}
async function refresh() {
  try { cache = await withStore('readonly', (s) => s.getAll()); } catch { cache = []; }
  cache.sort((a, b) => a.created_at.localeCompare(b.created_at));
  subs.forEach((f) => f(cache));
}
export const subscribe = (f) => { subs.add(f); f(cache); return () => subs.delete(f); };
export const items = () => cache;

/** إضافة عملية للصادر ثم محاولة إرسالها فورًا */
export async function enqueue({ id, label, url, method = 'POST', json, fields, file, scope }) {
  const item = { id, label, url, method, json, fields, file, scope, status: 'pending', created_at: new Date().toISOString(), attempts: 0 };
  try { await withStore('readwrite', (s) => s.put(item)); } catch { /* المتصفح يمنع التخزين: نرسل مباشرة */ return sendNow(item); }
  await refresh();
  return flush();
}

async function sendNow(item) {
  const headers = { Authorization: 'Bearer ' + auth.token };
  let body;
  if (item.file) {
    body = new FormData();
    for (const [k, v] of Object.entries(item.fields || {})) if (v != null) body.append(k, v);
    body.append(item.file.field, item.file.blob, item.file.name);
  } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(item.json); }
  const r = await fetch('/api' + item.url, { method: item.method, headers, body });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

let flushing = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const it of cache.filter((x) => x.status === 'pending' || x.status === 'retry')) {
      if (!navigator.onLine) break;
      try {
        const r = await sendNow(it);
        if (r.ok) { it.status = 'sent'; it.result = r.data; delete it.file; }
        else if (r.status >= 500 || r.status === 0) { it.status = 'retry'; it.error = r.data?.error; }
        else { it.status = 'failed'; it.error = r.data?.error || 'رفض الخادم العملية'; }
      } catch { it.status = 'pending'; break; } // الشبكة غير متاحة
      it.attempts++;
      try { await withStore('readwrite', (s) => s.put(it)); } catch {}
    }
    // تنظيف المرسل بعد يوم
    const old = cache.filter((x) => x.status === 'sent' && Date.now() - new Date(x.created_at) > 864e5);
    if (old.length) try { await withStore('readwrite', (s) => old.forEach((o) => s.delete(o.id))); } catch {}
    await refresh();
  })().finally(() => { flushing = null; });
  return flushing;
}
export async function retry(id) { const it = cache.find((x) => x.id === id); if (it) { it.status = 'pending'; await withStore('readwrite', (s) => s.put(it)); await refresh(); flush(); } }
export async function discard(id) { await withStore('readwrite', (s) => s.delete(id)); await refresh(); }

refresh().then(flush);
window.addEventListener('online', () => flush());
setInterval(() => navigator.onLine && flush(), 20000);
