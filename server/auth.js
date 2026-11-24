import crypto from 'node:crypto';
import { q, uid, HttpError } from './db.js';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `scrypt$${salt}$${h}`;
}
export function verifyPassword(pw, stored) {
  const [, salt, h] = stored.split('$');
  const test = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
}

/** مصفوفة الأدوار والصلاحيات */
export const ROLE_CAPS = {
  client_admin:    ['org.manage','order.create','order.view','price.view','asset.view','asset.manage','nfc.manage','fueling.create','fueling.view','inventory.view','inventory.manage','exception.decide','report.view','finance.view','receipt.confirm','doc.view'],
  procurement:     ['order.create','order.view','price.view','report.view','doc.view','asset.view','inventory.view'],
  project_manager: ['order.view','price.view','asset.view','asset.manage','fueling.view','inventory.view','exception.decide','report.view','receipt.confirm','doc.view'],
  fuel_supervisor: ['order.view','asset.view','nfc.manage','fueling.create','fueling.view','inventory.view','inventory.manage','receipt.confirm'],
  finance:         ['order.view','price.view','asset.view','fueling.view','inventory.view','exception.decide','report.view','finance.view','doc.view'],
  site_receiver:   ['order.view','receipt.confirm'],
  carrier_admin:   ['carrier.dispatch','carrier.fleet','carrier.prices','price.view'],
  dispatcher:      ['carrier.dispatch','price.view'],
  driver:          ['driver.execute'],
  platform_admin:  ['platform.admin'],
};

export const ROLE_LABELS = {
  client_admin: 'مدير حساب الشركة', procurement: 'المشتريات', project_manager: 'مدير المشروع',
  fuel_supervisor: 'مشرف الوقود', finance: 'المالية', site_receiver: 'مستلم الموقع',
  carrier_admin: 'مدير الناقل', dispatcher: 'مسؤول الإسناد', driver: 'سائق', platform_admin: 'إدارة فيول آب',
};

export function createSession(userId, membershipId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  q.run('INSERT INTO sessions(token,user_id,membership_id,expires_at) VALUES (?,?,?,?)', token, userId, membershipId, exp);
  return token;
}

export function loadContext(token) {
  if (!token) return null;
  const s = q.get(`SELECT s.token, s.user_id, s.expires_at, m.id membership_id, m.company_id, m.role, m.scope_project_id, m.scope_site_id,
      m.approval_limit_halalas, u.name user_name, u.email, c.type company_type, c.name_ar company_name, c.status company_status
    FROM sessions s JOIN memberships m ON m.id = s.membership_id AND m.active = 1
    JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = m.company_id
    WHERE s.token = ?`, token);
  if (!s || s.expires_at < new Date().toISOString()) return null;
  const caps = new Set(ROLE_CAPS[s.role] || []);
  const driver = s.role === 'driver' ? q.get('SELECT id FROM drivers WHERE user_id = ? AND company_id = ?', s.user_id, s.company_id) : null;
  return {
    token, userId: s.user_id, userName: s.user_name, email: s.email,
    membershipId: s.membership_id, companyId: s.company_id, companyType: s.company_type, companyName: s.company_name,
    companyStatus: s.company_status, role: s.role, scopeProjectId: s.scope_project_id, scopeSiteId: s.scope_site_id,
    approvalLimit: s.approval_limit_halalas, driverId: driver?.id ?? null,
    caps, can: (c) => caps.has(c),
  };
}

export function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || null);
  req.ctx = loadContext(token);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.ctx) return next(new HttpError(401, 'يلزم تسجيل الدخول'));
  next();
}

export const requireCap = (...caps) => (req, _res, next) => {
  if (!req.ctx) return next(new HttpError(401, 'يلزم تسجيل الدخول'));
  if (!caps.some((c) => req.ctx.can(c))) return next(new HttpError(403, 'ليست لديك صلاحية لهذا الإجراء'));
  next();
};

/** شرط نطاق المشروع لعضوية محدودة بمشروع */
export function projectScope(ctx, col = 'project_id') {
  return ctx.scopeProjectId ? { sql: ` AND ${col} = ?`, params: [ctx.scopeProjectId] } : { sql: '', params: [] };
}

export { uid };
