import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const UPLOAD_DIR = process.env.FUELAPP_UPLOADS || path.join(ROOT, 'uploads');

let db;

export function openDb(file = process.env.FUELAPP_DB || path.join(ROOT, 'data', 'fuelapp.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

/** ترحيل قواعد البيانات القائمة: أعمدة أُضيفت بعد الإصدار الأول */
function migrate(d) {
  const cols = (t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const oc = cols('orders');
  for (const c of ['contract_id', 'contract_rate_id', 'package_id', 'reservation_id', 'quote_request_id']) if (!oc.includes(c)) d.exec(`ALTER TABLE orders ADD COLUMN ${c} TEXT`);
  const sc = cols('sites');
  for (const c of ['gate_lat REAL', 'gate_lng REAL', 'receiving_hours TEXT', 'receiving_days TEXT', 'access_updated_at TEXT', 'access_updated_by TEXT']) if (!sc.includes(c.split(' ')[0])) d.exec(`ALTER TABLE sites ADD COLUMN ${c}`);
  if (!cols('companies').includes('logo_file_id')) d.exec('ALTER TABLE companies ADD COLUMN logo_file_id TEXT');
}

export function getDb() {
  if (!db) openDb();
  return db;
}

export const q = {
  get: (sql, ...p) => getDb().prepare(sql).get(...p),
  all: (sql, ...p) => getDb().prepare(sql).all(...p),
  run: (sql, ...p) => getDb().prepare(sql).run(...p),
};

let txDepth = 0;
/** معاملة صريحة (BEGIN IMMEDIATE يقفل الكتابة فورًا ويمنع السباق بين طلبين متزامنين) */
export function tx(fn) {
  const d = getDb();
  if (txDepth > 0) return fn();
  d.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch {}
    throw e;
  } finally {
    txDepth--;
  }
}

export const uid = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
export const now = () => new Date().toISOString();

/** ترقيم مقروء: FA-ORD-000123 */
export function nextNumber(name, prefix) {
  const row = q.get('INSERT INTO counters(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1 RETURNING value', name);
  return `${prefix}-${String(row.value).padStart(6, '0')}`;
}

export function audit(ctx, action, entity, entityId, data) {
  q.run('INSERT INTO audit_log(company_id,user_id,membership_role,action,entity,entity_id,data_json) VALUES (?,?,?,?,?,?,?)',
    ctx?.companyId ?? null, ctx?.userId ?? null, ctx?.role ?? null, action, entity, entityId, data ? JSON.stringify(data) : null);
}

/** الإشعار مرتبط بمفتاح المصدر: إعادة المحاولة لا تنتج إشعارًا مكررًا */
export function notify(companyId, role, title, body, link, sourceKey) {
  q.run('INSERT INTO notifications(company_id,role,title,body,link,source_key) VALUES (?,?,?,?,?,?) ON CONFLICT(source_key) DO NOTHING',
    companyId, role, title, body, link, sourceKey ?? null);
}

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export const L = (ml) => (ml == null ? null : Math.round(ml) / 1000);          // ml → لتر
export const ML = (liters) => Math.round(Number(liters) * 1000);               // لتر → ml
export const SAR = (h) => (h == null ? null : h / 100);
