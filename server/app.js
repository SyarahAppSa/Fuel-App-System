import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { q, tx, uid, now, audit, HttpError, ROOT, L, ML } from './db.js';
import { authMiddleware, requireAuth, requireCap, verifyPassword, createSession, ROLE_LABELS, ROLE_CAPS, projectScope } from './auth.js';
import * as trips from './services/trips.js';
import * as inv from './services/inventory.js';
import * as fuel from './services/fueling.js';
import * as docs from './services/documents.js';
import * as rep from './services/reports.js';
import * as Con from './services/contracts.js';
import * as Adm from './services/admin.js';
import * as Fin from './services/finance.js';
import { sampleAramcoPdf } from './samples.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const h = (fn) => (req, res, next) => { try { const r = fn(req, res); if (r instanceof Promise) r.then((v) => v !== undefined && !res.headersSent && res.json(v)).catch(next); else if (r !== undefined && !res.headersSent) res.json(r); } catch (e) { next(e); } };
const client = (req, _res, next) => (req.ctx?.companyType === 'client' ? next() : next(new HttpError(403, 'هذه الشاشة للشركات العميلة')));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
  app.use('/api', authMiddleware);
  const api = express.Router();
  app.use('/api', api);

  /* ---------------- عام ---------------- */
  api.get('/health', h(() => ({ ok: true, time: now() })));
  api.get('/demo-accounts', h(() => q.all(`SELECT u.email, u.name, m.role, c.name_ar company, c.type FROM memberships m JOIN users u ON u.id = m.user_id JOIN companies c ON c.id = m.company_id
      WHERE c.is_demo = 1 ORDER BY c.type, c.name_ar, m.role`).map((r) => ({ ...r, role_ar: ROLE_LABELS[r.role] }))));

  api.post('/auth/login', h((req) => {
    const { email, password, membership_id } = req.body || {};
    const u = q.get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase().trim());
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
    const ms = q.all(`SELECT m.id, m.role, c.id company_id, c.name_ar company_name, c.type company_type FROM memberships m JOIN companies c ON c.id = m.company_id
        WHERE m.user_id = ? AND m.active = 1 ORDER BY m.rowid`, u.id);
    if (!ms.length) throw new HttpError(403, 'لا توجد عضوية نشطة');
    const m = ms.find((x) => x.id === membership_id) || ms[0];
    const token = createSession(u.id, m.id);
    audit({ userId: u.id, companyId: m.company_id, role: m.role }, 'auth.login', 'user', u.id);
    return { token, memberships: ms.map((x) => ({ ...x, role_ar: ROLE_LABELS[x.role] })) };
  }));
  // وضع العرض المفتوح: دخول بلا بريد ولا كلمة مرور — للنسخة التجريبية فقط ويُفعَّل بمتغير بيئة
  const openDemo = () => process.env.FUELAPP_OPEN_DEMO === '1';
  api.get('/demo/config', h(() => ({ open: openDemo() })));
  api.post('/demo/enter', h((req) => {
    if (!openDemo()) throw new HttpError(404, 'المسار غير موجود');
    const email = String(req.body?.email || 'admin@fuelapp.demo').toLowerCase().trim();
    const m = q.get(`SELECT m.id, m.user_id, m.company_id, m.role FROM memberships m JOIN users u ON u.id = m.user_id JOIN companies c ON c.id = m.company_id
        WHERE u.email = ? AND m.active = 1 AND c.is_demo = 1 ORDER BY m.rowid LIMIT 1`, email);
    if (!m) throw new HttpError(404, 'الحساب غير موجود');
    audit({ userId: m.user_id, companyId: m.company_id, role: m.role }, 'auth.demo_enter', 'user', m.user_id, { ip: req.ip });
    return { token: createSession(m.user_id, m.id) };
  }));
  api.post('/auth/switch', requireAuth, h((req) => {
    const m = q.get('SELECT * FROM memberships WHERE id = ? AND user_id = ? AND active = 1', req.body.membership_id, req.ctx.userId);
    if (!m) throw new HttpError(403, 'عضوية غير صالحة');
    q.run('DELETE FROM sessions WHERE token = ?', req.ctx.token);
    return { token: createSession(req.ctx.userId, m.id) };
  }));
  api.post('/auth/logout', requireAuth, h((req) => { q.run('DELETE FROM sessions WHERE token = ?', req.ctx.token); return { ok: true }; }));
  api.get('/me', requireAuth, h((req) => {
    const c = req.ctx;
    const memberships = q.all(`SELECT m.id, m.role, c.name_ar company_name, c.type company_type FROM memberships m JOIN companies c ON c.id = m.company_id WHERE m.user_id = ? AND m.active = 1`, c.userId)
      .map((x) => ({ ...x, role_ar: ROLE_LABELS[x.role] }));
    const unread = q.get('SELECT COUNT(*) n FROM notifications WHERE company_id = ? AND read = 0 AND (role IS NULL OR role = ? OR ? = \'client_admin\' OR ? = \'carrier_admin\')', c.companyId, c.role, c.role, c.role).n;
    const company = q.get('SELECT settings_json FROM companies WHERE id = ?', c.companyId);
    return { user: { id: c.userId, name: c.userName, email: c.email }, company: { id: c.companyId, name: c.companyName, type: c.companyType, status: c.companyStatus, settings: JSON.parse(company.settings_json) },
      role: c.role, role_ar: ROLE_LABELS[c.role], caps: [...c.caps], scope_project_id: c.scopeProjectId, driver_id: c.driverId, memberships, current_membership: c.membershipId, unread };
  }));
  api.get('/notifications', requireAuth, h((req) => q.all(`SELECT * FROM notifications WHERE company_id = ? AND (role IS NULL OR role = ? OR ? IN ('client_admin','carrier_admin')) ORDER BY id DESC LIMIT 40`, req.ctx.companyId, req.ctx.role, req.ctx.role)));
  api.post('/notifications/read', requireAuth, h((req) => { q.run('UPDATE notifications SET read = 1 WHERE company_id = ?', req.ctx.companyId); return { ok: true }; }));
  api.get('/lookups', requireAuth, h(() => ({ loading_points: q.all('SELECT * FROM loading_points ORDER BY name'), products: docs.PRODUCTS,
    cities: q.all("SELECT DISTINCT ref city FROM carrier_coverage WHERE kind='delivery' UNION SELECT DISTINCT city FROM sites ORDER BY 1").map((r) => r.city),
    roles: ROLE_LABELS, trip_status: trips.TRIP_STATUS_AR, tag_status: fuel.TAG_STATUS_AR })));

  /* ---------------- الملفات الخاصة (وصول محدود ومسجل) ---------------- */
  api.get('/files/:id', requireAuth, h((req, res) => {
    const f = docs.authorizeFile(req.ctx, req.params.id, req.query.download ? 'download' : 'view');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.original_name || f.id)}"`);
    fs.createReadStream(f.abs).pipe(res);
  }));

  /* ---------------- هيكل الشركة العميلة ---------------- */
  const C = [requireAuth, client];
  api.get('/org', ...C, h((req) => {
    const c = req.ctx.companyId; const sc = projectScope(req.ctx, 'id');
    return {
      branches: q.all('SELECT * FROM branches WHERE company_id = ?', c),
      projects: q.all('SELECT * FROM projects WHERE company_id = ?' + sc.sql + ' ORDER BY code', c, ...sc.params),
      cost_centers: q.all('SELECT * FROM cost_centers WHERE company_id = ? ORDER BY code', c),
      sites: q.all('SELECT * FROM sites WHERE company_id = ?' + projectScope(req.ctx).sql + ' ORDER BY name', c, ...projectScope(req.ctx).params),
      tanks: q.all('SELECT t.*, s.name site_name FROM tanks t JOIN sites s ON s.id = t.site_id WHERE t.company_id = ? ORDER BY t.code', c).map((t) => ({ ...t, ...inv.tankBalance(t.id) })),
      users: req.ctx.can('org.manage') ? q.all('SELECT u.id, u.name, u.email, m.role, m.scope_project_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ?', c).map((u) => ({ ...u, role_ar: ROLE_LABELS[u.role] })) : [],
    };
  }));
  api.post('/projects', ...C, requireCap('org.manage'), h((req) => {
    const { code, name, budget_liters, budget_sar, cost_center_id } = req.body; if (!code || !name) throw new HttpError(400, 'الرمز والاسم مطلوبان');
    const id = uid('prj_'); q.run('INSERT INTO projects(id,company_id,code,name,budget_ml,budget_halalas,cost_center_id) VALUES (?,?,?,?,?,?,?)', id, req.ctx.companyId, code, name, budget_liters ? ML(budget_liters) : null, budget_sar ? Math.round(budget_sar * 100) : null, cost_center_id || null);
    audit(req.ctx, 'project.create', 'project', id); return { id };
  }));
  api.post('/sites', ...C, requireCap('org.manage'), h((req) => {
    const b = req.body; if (!b.name || !b.city) throw new HttpError(400, 'الاسم والمدينة مطلوبان');
    const id = uid('sit_'); q.run('INSERT INTO sites(id,company_id,project_id,name,city,lat,lng,receiver_name,receiver_phone,access_notes) VALUES (?,?,?,?,?,?,?,?,?,?)', id, req.ctx.companyId, b.project_id || null, b.name, b.city, b.lat || null, b.lng || null, b.receiver_name || null, b.receiver_phone || null, b.access_notes || null);
    return { id };
  }));
  api.post('/tanks', ...C, requireCap('org.manage', 'inventory.manage'), h((req) => {
    const b = req.body; if (!b.site_id || !b.code || !b.capacity_liters) throw new HttpError(400, 'الموقع والرمز والسعة مطلوبة');
    if (!q.get('SELECT 1 FROM sites WHERE id = ? AND company_id = ?', b.site_id, req.ctx.companyId)) throw new HttpError(404, 'الموقع غير موجود');
    const id = uid('tnk_'); q.run('INSERT INTO tanks(id,company_id,site_id,code,name,product,capacity_ml,reorder_ml) VALUES (?,?,?,?,?,?,?,?)', id, req.ctx.companyId, b.site_id, b.code, b.name || b.code, b.product || 'diesel', ML(b.capacity_liters), ML(b.reorder_liters || 0));
    return { id };
  }));

  /* ---------------- الأصول ---------------- */
  const assetSelect = `SELECT a.*, p.name project_name, p.code project_code, s.name site_name, cc.code cost_center_code,
      (SELECT display_no FROM nfc_tags WHERE asset_id = a.id AND status='active') tag_display_no,
      (SELECT COUNT(*) FROM nfc_tags WHERE asset_id = a.id AND status='pending_activation') tag_pending,
      (SELECT MAX(created_at) FROM fuelings WHERE asset_id = a.id AND status='approved') last_fueling_at,
      (SELECT meter_value FROM fuelings WHERE asset_id = a.id AND status='approved' AND meter_value IS NOT NULL ORDER BY created_at DESC LIMIT 1) last_meter,
      (SELECT COALESCE(SUM(quantity_ml),0) FROM fuelings WHERE asset_id = a.id AND status='approved' AND created_at >= ?) month_ml
    FROM assets a LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id`;
  const monthStart = () => new Date(Date.now() - 30 * 864e5).toISOString();
  api.get('/assets', ...C, requireCap('asset.view', 'fueling.create'), h((req) => {
    const sc = projectScope(req.ctx, 'a.project_id');
    const where = ['a.company_id = ?']; const p = [monthStart(), req.ctx.companyId];
    for (const k of ['project_id', 'site_id', 'category', 'status']) if (req.query[k]) { where.push(`a.${k} = ?`); p.push(req.query[k]); }
    if (req.query.q) { where.push('(a.code LIKE ? OR a.name LIKE ? OR a.plate_or_serial LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
    return q.all(`${assetSelect} WHERE ${where.join(' AND ')}${sc.sql} ORDER BY a.code`, ...p, ...sc.params);
  }));
  api.get('/assets/:id', ...C, requireCap('asset.view', 'fueling.create'), h((req) => {
    const a = q.get(`${assetSelect} WHERE a.id = ? AND a.company_id = ?`, monthStart(), req.params.id, req.ctx.companyId);
    if (!a || (req.ctx.scopeProjectId && a.project_id !== req.ctx.scopeProjectId)) throw new HttpError(404, 'الأصل غير موجود'); return a;
  }));
  const assetFields = ['code', 'name', 'category', 'fuel_type', 'plate_or_serial', 'project_id', 'site_id', 'cost_center_id', 'status', 'meter_type'];
  function upsertAsset(ctx, b, id) {
    const vals = { ...Object.fromEntries(assetFields.map((k) => [k, b[k] ?? null])), tank_capacity_ml: b.tank_capacity_liters ? ML(b.tank_capacity_liters) : null,
      per_tx_limit_ml: b.per_tx_limit_liters ? ML(b.per_tx_limit_liters) : null, daily_limit_ml: b.daily_limit_liters ? ML(b.daily_limit_liters) : null, monthly_limit_ml: b.monthly_limit_liters ? ML(b.monthly_limit_liters) : null };
    if (!vals.code || !vals.name || !vals.category || !vals.fuel_type) throw new HttpError(400, 'الرقم الداخلي والاسم والتصنيف ونوع الوقود مطلوبة');
    vals.status ||= 'active'; vals.meter_type ||= 'none';
    if (id) {
      delete vals.project_id; delete vals.site_id; delete vals.cost_center_id; // النقل بين المشاريع له إجراء مستقل بتاريخ نفاذ
      const keys = Object.keys(vals); q.run(`UPDATE assets SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ? AND company_id = ?`, ...keys.map((k) => vals[k]), id, ctx.companyId);
      audit(ctx, 'asset.update', 'asset', id, vals); return { id };
    }
    const nid = uid('ast_'); const keys = Object.keys(vals);
    q.run(`INSERT INTO assets(id,company_id,${keys.join(',')}) VALUES (?,?,${keys.map(() => '?').join(',')})`, nid, ctx.companyId, ...keys.map((k) => vals[k]));
    q.run('INSERT INTO asset_assignments(id,asset_id,project_id,site_id,cost_center_id,effective_from,created_by) VALUES (?,?,?,?,?,?,?)', uid('asg_'), nid, vals.project_id, vals.site_id, vals.cost_center_id, now(), ctx.userId);
    return { id: nid };
  }
  api.post('/assets', ...C, requireCap('asset.manage'), h((req) => {
    try { return upsertAsset(req.ctx, req.body); } catch (e) { if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'الرقم الداخلي مستخدم'); throw e; }
  }));
  api.put('/assets/:id', ...C, requireCap('asset.manage'), h((req) => upsertAsset(req.ctx, req.body, req.params.id)));
  api.post('/assets/:id/move', ...C, requireCap('asset.manage'), h((req) => tx(() => {
    const a = q.get('SELECT * FROM assets WHERE id = ? AND company_id = ?', req.params.id, req.ctx.companyId); if (!a) throw new HttpError(404, 'الأصل غير موجود');
    const { project_id, site_id, cost_center_id, effective_from } = req.body;
    const site = q.get('SELECT * FROM sites WHERE id = ? AND company_id = ?', site_id, req.ctx.companyId); if (!site) throw new HttpError(400, 'حدد الموقع الجديد');
    const eff = effective_from ? new Date(effective_from).toISOString() : now();
    q.run('UPDATE assets SET project_id = ?, site_id = ?, cost_center_id = COALESCE(?, cost_center_id) WHERE id = ?', project_id || site.project_id, site.id, cost_center_id || null, a.id);
    q.run('INSERT INTO asset_assignments(id,asset_id,project_id,site_id,cost_center_id,effective_from,created_by) VALUES (?,?,?,?,?,?,?)', uid('asg_'), a.id, project_id || site.project_id, site.id, cost_center_id || a.cost_center_id, eff, req.ctx.userId);
    audit(req.ctx, 'asset.move', 'asset', a.id, { from: a.project_id, to: project_id || site.project_id, eff }); return { ok: true };
  })));
  // استيراد CSV: معاينة وكشف مكرر وتقرير أخطاء لكل صف
  api.post('/assets/import', ...C, requireCap('asset.manage'), h((req) => {
    const { rows, commit } = req.body; if (!Array.isArray(rows)) throw new HttpError(400, 'لا توجد صفوف');
    const projects = Object.fromEntries(q.all('SELECT id, code FROM projects WHERE company_id = ?', req.ctx.companyId).map((p) => [p.code, p.id]));
    const ccs = Object.fromEntries(q.all('SELECT id, code FROM cost_centers WHERE company_id = ?', req.ctx.companyId).map((p) => [p.code, p.id]));
    const sites = Object.fromEntries(q.all('SELECT id, name FROM sites WHERE company_id = ?', req.ctx.companyId).map((p) => [p.name, p.id]));
    const seen = new Set(); const CAT = { 'معدة ثقيلة': 'heavy_equipment', 'مولد': 'generator', 'مركبة': 'vehicle', 'أصل ثابت': 'fixed' };
    const result = rows.map((r, i) => {
      const errors = []; const code = String(r.code || '').trim();
      if (!code) errors.push('الرقم الداخلي مطلوب');
      if (seen.has(code)) errors.push('مكرر داخل الملف'); seen.add(code);
      if (code && q.get('SELECT 1 FROM assets WHERE company_id = ? AND code = ?', req.ctx.companyId, code)) errors.push('موجود مسبقًا في النظام');
      if (!r.name) errors.push('الاسم مطلوب');
      const category = CAT[r.category] || r.category; if (!['heavy_equipment', 'generator', 'vehicle', 'fixed'].includes(category)) errors.push('تصنيف غير معروف');
      const fuel_type = { 'ديزل': 'diesel', 'بنزين 91': 'gasoline91', 'بنزين 95': 'gasoline95' }[r.fuel_type] || r.fuel_type; if (!docs.PRODUCTS[fuel_type]) errors.push('نوع وقود غير معروف');
      if (r.project_code && !projects[r.project_code]) errors.push('رمز المشروع غير موجود');
      if (r.site_name && !sites[r.site_name]) errors.push('الموقع غير موجود');
      if (r.cost_center_code && !ccs[r.cost_center_code]) errors.push('مركز التكلفة غير موجود');
      return { row: i + 2, data: { ...r, category, fuel_type, project_id: projects[r.project_code], site_id: sites[r.site_name], cost_center_id: ccs[r.cost_center_code],
        meter_type: { 'كم': 'km', 'ساعات': 'hours' }[r.meter_type] || r.meter_type || 'none' }, errors };
    });
    const valid = result.filter((r) => !r.errors.length);
    if (commit) tx(() => valid.forEach((r) => upsertAsset(req.ctx, r.data)));
    return { total: rows.length, valid: valid.length, errors: result.filter((r) => r.errors.length), committed: !!commit ? valid.length : 0 };
  }));

  /* ---------------- شرائح NFC ---------------- */
  api.get('/nfc-tags', ...C, requireCap('nfc.manage', 'asset.view'), h((req) => rep.tagControlReport(req.ctx)));
  api.post('/nfc-tags/batch', ...C, requireCap('nfc.manage'), h((req) => fuel.issueTagBatch(req.ctx, req.body)));
  api.post('/nfc-tags/bind', ...C, requireCap('nfc.manage'), h((req) => fuel.bindTag(req.ctx, req.body)));
  api.post('/nfc-tags/:id/:action', ...C, requireCap('nfc.manage'), h((req) => fuel.tagAction(req.ctx, req.params.id, req.params.action, req.body)));
  api.get('/nfc-tags/:id/events', ...C, requireCap('nfc.manage', 'asset.view'), h((req) => q.all(`SELECT e.*, u.name by_name, a.code asset_code FROM nfc_tag_events e LEFT JOIN users u ON u.id = e.by_user LEFT JOIN assets a ON a.id = e.asset_id WHERE e.tag_id = ? AND e.company_id = ? ORDER BY e.at DESC`, req.params.id, req.ctx.companyId)));

  /* ---------------- التزويد ---------------- */
  api.get('/fuel-sources', ...C, requireCap('fueling.create', 'fueling.view'), h((req) => inv.sourcesForSite(req.ctx, req.query.site_id)));
  api.post('/fuelings/authorize', ...C, requireCap('fueling.create'), h((req) => {
    const r = fuel.authorize(req.ctx, req.body);
    if (!r.authorized && req.body.quantity_liters == null) {
      q.run("INSERT INTO authorization_attempts(company_id,uid,tag_id,asset_id,operator_user_id,result,reasons_json) VALUES (?,?,?,?,?,'rejected',?)", req.ctx.companyId, req.body.uid ?? null, r.tag?.id ?? null, r.asset?.id ?? null, req.ctx.userId, JSON.stringify(r.reasons));
      if (r.tag) q.run("INSERT INTO nfc_tag_events(tag_id,company_id,uid,asset_id,action,result,reason,by_user) VALUES (?,?,?,?,'rejected','denied',?,?)", r.tag.id, req.ctx.companyId, req.body.uid, r.asset?.id ?? null, r.reasons.map((x) => x.msg).join('، '), req.ctx.userId);
    }
    return r;
  }));
  api.post('/fuelings', ...C, requireCap('fueling.create'), h((req) => fuel.createFueling(req.ctx, req.body)));
  api.get('/fuelings', ...C, requireCap('fueling.view'), h((req) => rep.fuelingRows(req.ctx, req.query)));
  api.get('/fuelings/:id', ...C, requireCap('fueling.view'), h((req) => {
    const f = q.get('SELECT id, created_at FROM fuelings WHERE id = ? AND company_id = ?', req.params.id, req.ctx.companyId); if (!f) throw new HttpError(404, 'العملية غير موجودة');
    const row = rep.fuelingRows(req.ctx, { limit: 5000 }).find((r) => r.id === f.id); if (!row) throw new HttpError(404, 'العملية غير موجودة');
    const corrections = q.all('SELECT number, quantity_ml, reject_reason reason, created_at FROM fuelings WHERE corrects_fueling_id = ?', f.id);
    return { ...row, source_chain: rep.sourceChain(row), corrections, audit: q.all("SELECT a.*, u.name by_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE entity = 'fueling' AND entity_id = ? ORDER BY id", f.id) };
  }));
  api.post('/fuelings/:id/correct', ...C, requireCap('exception.decide'), h((req) => fuel.correctFueling(req.ctx, req.params.id, req.body)));

  /* ---------------- الخزانات والمخزون ---------------- */
  api.get('/tanks/:id', ...C, requireCap('inventory.view'), h((req) => inv.tankLedger(req.ctx, req.params.id)));
  api.post('/tanks/:id/opening', ...C, requireCap('inventory.manage'), h((req) => inv.openingBalance(req.ctx, req.params.id, req.body)));
  api.post('/tanks/:id/count', ...C, requireCap('inventory.manage'), h((req) => inv.stockCount(req.ctx, req.params.id, req.body)));
  api.post('/tanks/transfer', ...C, requireCap('inventory.manage'), h((req) => inv.transfer(req.ctx, req.body)));

  /* ---------------- المستندات والطلبات والرحلات (العميل) ---------------- */
  api.get('/documents', ...C, requireCap('order.create', 'doc.view'), h((req) => docs.listDocuments(req.ctx)));
  api.post('/documents', ...C, requireCap('order.create'), upload.single('file'), h((req) => docs.uploadAramcoDocument(req.ctx, req.file)));
  api.get('/documents/:id', ...C, requireCap('order.create', 'doc.view'), h((req) => docs.getDocument(req.ctx, req.params.id)));
  api.post('/documents/:id/approve', ...C, requireCap('order.create'), h((req) => docs.approveDocument(req.ctx, req.params.id, req.body)));
  api.get('/market/search', ...C, requireCap('order.create'), h((req) => trips.searchCarriers(req.query, req.ctx)));
  api.post('/orders', ...C, requireCap('order.create'), h((req) => trips.createOrder(req.ctx, req.body)));
  api.get('/trips', requireAuth, h((req) => {
    const c = req.ctx; const where = []; const p = [];
    if (c.companyType === 'client') { if (!c.can('order.view')) throw new HttpError(403, 'غير مصرح'); where.push('t.company_id = ?'); p.push(c.companyId); if (c.scopeProjectId) { where.push('o.project_id = ?'); p.push(c.scopeProjectId); } }
    else if (c.role === 'driver') { where.push('t.driver_id = ?'); p.push(c.driverId); }
    else if (c.companyType === 'carrier') { where.push("(t.carrier_id = ? OR (t.status = 'awaiting_acceptance' AND EXISTS (SELECT 1 FROM order_offers f WHERE f.order_id = t.order_id AND f.carrier_id = ? AND f.status = 'pending')))"); p.push(c.companyId, c.companyId); }
    else if (c.can('platform.view')) where.push('1=1');
    if (req.query.status) { where.push('t.status IN (' + req.query.status.split(',').map(() => '?').join(',') + ')'); p.push(...req.query.status.split(',')); }
    const showPrice = c.can('price.view') || c.can('platform.finance');
    return q.all(`SELECT t.id, t.number, t.status, t.planned_start, t.window_start, t.window_end, t.accept_deadline, t.loaded_ml, t.delivered_at, t.created_at, o.number order_number, o.product, o.quantity_ml,
        ${showPrice ? 'o.transport_halalas,' : ''} lp.name loading_point_name, cl.name_ar client_name, ca.name_ar carrier_name, v.plate, d.name driver_name, p.name project_name,
        (SELECT GROUP_CONCAT(st.name, '، ') FROM trip_stops s JOIN sites st ON st.id = s.site_id WHERE s.trip_id = t.id) sites,
        (SELECT GROUP_CONCAT(DISTINCT st.city) FROM trip_stops s JOIN sites st ON st.id = s.site_id WHERE s.trip_id = t.id) cities,
        (SELECT GROUP_CONCAT(DISTINCT s.mode) FROM trip_stops s WHERE s.trip_id = t.id) modes
      FROM trips t JOIN orders o ON o.id = t.order_id JOIN loading_points lp ON lp.id = o.loading_point_id JOIN companies cl ON cl.id = t.company_id JOIN companies ca ON ca.id = t.carrier_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN projects p ON p.id = o.project_id
      WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT 300`, ...p).map((t) => ({ ...t, status_ar: trips.TRIP_STATUS_AR[t.status], client_name: c.companyType === 'carrier' || c.role === 'driver' ? t.client_name : undefined }));
  }));
  api.get('/trips/:id', requireAuth, h((req) => trips.tripView(req.ctx, req.params.id)));
  api.post('/trips/:id/cancel', ...C, requireCap('order.create'), h((req) => trips.cancelTrip(req.ctx, req.params.id, req.body.reason)));
  api.post('/trips/:id/stops/:sid/confirm', ...C, requireCap('receipt.confirm'), h((req) => {
    const s = q.get('SELECT s.* FROM trip_stops s JOIN trips t ON t.id = s.trip_id WHERE s.id = ? AND t.id = ? AND t.company_id = ?', req.params.sid, req.params.id, req.ctx.companyId);
    if (!s) throw new HttpError(404, 'نقطة التسليم غير موجودة');
    if (req.ctx.scopeSiteId && s.site_id !== req.ctx.scopeSiteId) throw new HttpError(403, 'خارج نطاق موقعك');
    return trips.confirmStop(req.ctx, s, req.body);
  }));
  api.get('/trips/:id/report', requireAuth, h((req, res) => { res.type('html').send(rep.tripReportHtml(req.ctx, req.params.id, req.ctx.token)); }));

  // رابط محدود الصلاحية لمستلم الموقع (بدون حساب)
  api.get('/public/receipt/:token', h((req) => {
    const s = q.get(`SELECT s.*, t.number trip_number, t.status trip_status, t.id trip_id, st.name site_name, ca.name_ar carrier_name, v.plate, d.name driver_name, o.product
        FROM trip_stops s JOIN trips t ON t.id = s.trip_id JOIN sites st ON st.id = s.site_id JOIN companies ca ON ca.id = t.carrier_id JOIN orders o ON o.id = t.order_id
        LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id WHERE s.receipt_token = ?`, req.params.token);
    if (!s) throw new HttpError(404, 'الرابط غير صالح');
    return { trip_number: s.trip_number, trip_status_ar: trips.TRIP_STATUS_AR[s.trip_status], site_name: s.site_name, carrier_name: s.carrier_name, plate: s.plate, driver_name: s.driver_name,
      product: docs.PRODUCTS[s.product], requested_ml: s.requested_ml, delivered_ml: s.delivered_ml, status: s.status, receiver_ack: s.receiver_ack, receiver_name: s.receiver_name };
  }));
  api.post('/public/receipt/:token', h((req) => {
    const s = q.get('SELECT * FROM trip_stops WHERE receipt_token = ?', req.params.token); if (!s) throw new HttpError(404, 'الرابط غير صالح');
    const { ack, note, name } = req.body; if (!name) throw new HttpError(400, 'اكتب اسم المستلم');
    return trips.confirmStop({ userId: null, userName: name, role: 'site_receiver_link', companyId: null }, s, { ack, note, actorName: name });
  }));

  /* ---------------- الموافقات والاستثناءات ---------------- */
  api.get('/exceptions', ...C, requireCap('exception.decide', 'fueling.view', 'order.view'), h((req) => q.all(`SELECT e.*, u.name decided_by_name FROM exceptions e LEFT JOIN users u ON u.id = e.decided_by
      WHERE e.company_id = ? ORDER BY CASE e.status WHEN 'open' THEN 0 ELSE 1 END, e.created_at DESC LIMIT 200`, req.ctx.companyId).map((e) => ({ ...e, details: JSON.parse(e.details_json || '{}'), details_json: undefined }))));
  api.post('/exceptions/:id/decide', ...C, requireCap('exception.decide'), h((req) => tx(() => {
    const e = q.get("SELECT * FROM exceptions WHERE id = ? AND company_id = ? AND status = 'open'", req.params.id, req.ctx.companyId);
    if (!e) throw new HttpError(404, 'الاستثناء غير موجود أو معالج');
    const { decision, reason, accepted_liters } = req.body;
    if (!['approved', 'rejected'].includes(decision) || !reason) throw new HttpError(400, 'حدد القرار والسبب');
    if (e.type === 'stock_variance' && decision === 'approved') inv.approveStockVariance(req.ctx, e.ref_id);
    if (e.type === 'stock_variance' && decision === 'rejected') q.run("UPDATE stock_counts SET status='rejected' WHERE id = ?", e.ref_id);
    if (e.type === 'quantity_variance' && e.ref_type === 'trip_stop') {
      const s = q.get('SELECT * FROM trip_stops WHERE id = ?', e.ref_id); const t = q.get('SELECT * FROM trips WHERE id = ?', s.trip_id);
      const qty = decision === 'approved' && accepted_liters ? ML(accepted_liters) : s.delivered_ml;
      if (qty !== s.delivered_ml) q.run('UPDATE trip_stops SET delivered_ml = ? WHERE id = ?', qty, s.id);
      q.run("UPDATE trip_stops SET status = 'confirmed' WHERE id = ?", s.id);
      inv.createReceiptForStop(req.ctx, t, { ...s, delivered_ml: qty }, qty);
    }
    q.run('UPDATE exceptions SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?', decision, req.ctx.userId, now(), reason, e.id);
    audit(req.ctx, 'exception.' + decision, 'exception', e.id, { reason, accepted_liters });
    const tripId = e.ref_type === 'trip' ? e.ref_id : e.ref_type === 'trip_stop' ? q.get('SELECT trip_id FROM trip_stops WHERE id = ?', e.ref_id)?.trip_id : null;
    if (tripId) trips.maybeCloseTrip(req.ctx, tripId);
    return { ok: true };
  })));

  /* ---------------- التقارير ---------------- */
  api.get('/dashboard', ...C, h((req) => rep.dashboard(req.ctx, req.query)));
  api.get('/reports/asset/:id', ...C, requireCap('asset.view'), h((req) => rep.assetReport(req.ctx, req.params.id, req.query)));
  api.get('/reports/cycle', ...C, requireCap('report.view', 'inventory.view'), h((req) => rep.cycleReport(req.ctx)));
  api.get('/reports/fuelings.csv', ...C, requireCap('fueling.view'), h((req, res) => {
    const rows = rep.fuelingRows(req.ctx, { ...req.query, limit: 5000 });
    audit(req.ctx, 'export.fuelings', 'report', null, { rows: rows.length, filters: req.query });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="fuelapp-fuelings.csv"');
    res.send(rep.toCsv(rows, rep.FUELING_CSV_COLS.filter((c) => req.ctx.can('price.view') || c[1] !== 'التكلفة (ر.س)')));
  }));
  // تصدير Excel فعلي (xlsx) لسجل التزويد، من اليمين لليسار
  api.get('/reports/fuelings.xlsx', ...C, requireCap('fueling.view'), h(async (req, res) => {
    const { default: ExcelJS } = await import('exceljs');
    const rows = rep.fuelingRows(req.ctx, { ...req.query, limit: 5000 });
    const cols = rep.FUELING_CSV_COLS.filter((c) => req.ctx.can('price.view') || c[1] !== 'التكلفة (ر.س)');
    const wb = new ExcelJS.Workbook(); wb.creator = 'فيول آب';
    const ws = wb.addWorksheet('سجل التزويد', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c[1], width: Math.max(12, c[1].length + 4) }));
    for (const r of rows) ws.addRow(cols.map((c) => (typeof c[0] === 'function' ? c[0](r) : r[c[0]])));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000098' } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    audit(req.ctx, 'export.fuelings.xlsx', 'report', null, { rows: rows.length });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fuelapp-fuelings.xlsx"');
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }));
  // مستند أرامكو تجريبي لتجربة الرفع (معلّم بأنه نموذج غير رسمي)
  api.get('/demo/sample-aramco.pdf', requireAuth, h((req, res) => {
    const liters = Math.min(Number(req.query.liters) || 20000, 100000);
    const no = 'SA-DEMO-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
    const lp = q.get('SELECT * FROM loading_points WHERE id = ?', req.query.lp || 'lp_ryd');
    const d = (o) => new Date(Date.now() + o * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${no}.pdf"`);
    res.send(sampleAramcoPdf({ docNumber: no, lpCode: lp.code, lpName: lp.city === 'الرياض' ? 'Riyadh Distribution Plant' : lp.code + ' Plant', liters, issue: d(0), valid: d(30) }));
  }));
  api.get('/audit', ...C, requireCap('org.manage'), h((req) => q.all('SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.company_id = ? ORDER BY a.id DESC LIMIT 200', req.ctx.companyId)));

  /* ---------------- العقود والباقات وحجز السعة ---------------- */
  const CK = [requireAuth, (req, _r, n) => (['client', 'carrier'].includes(req.ctx.companyType) && req.ctx.role !== 'driver' ? n() : n(new HttpError(403, 'غير مصرح')))];
  api.get('/contracts', ...CK, h((req) => ({ contracts: Con.listContracts(req.ctx), packages: Con.listPackages(req.ctx), reservations: Con.listReservations(req.ctx),
    carriers: req.ctx.companyType === 'client' ? q.all("SELECT id, name_ar FROM companies WHERE type='carrier' AND status='approved' ORDER BY name_ar") : [] })));
  api.post('/contracts', ...C, requireCap('order.create'), h((req) => Con.createContract(req.ctx, req.body)));
  api.post('/packages', ...C, requireCap('order.create'), h((req) => Con.createPackage(req.ctx, req.body)));
  api.post('/capacity', ...C, requireCap('order.create'), h((req) => Con.createReservation(req.ctx, req.body)));
  api.get('/capacity/check', ...C, requireCap('order.create'), h((req) => Con.carrierCapacity(req.query.carrier_id, req.query.product || 'diesel', req.query.period_start, req.query.period_end)));
  api.post('/carrier/:kind(contract|package|capacity)/:id/:decision(accept|reject)', requireAuth, requireCap('carrier.dispatch'),
    h((req) => Con.carrierDecide(req.ctx, req.params.kind, req.params.id, { decision: req.params.decision, reason: req.body.reason })));

  /* ---------------- الناقل ---------------- */
  const K = [requireAuth, (req, _r, n) => (req.ctx.companyType === 'carrier' && req.ctx.role !== 'driver' ? n() : n(new HttpError(403, 'هذه الشاشة للناقلين')))];
  api.get('/carrier/overview', ...K, h((req) => {
    const c = req.ctx.companyId;
    return {
      by_status: q.all('SELECT status, COUNT(*) n FROM trips WHERE carrier_id = ? GROUP BY status', c).map((r) => ({ ...r, label: trips.TRIP_STATUS_AR[r.status] })),
      revenue_halalas: q.get("SELECT COALESCE(SUM(o.transport_halalas),0) s FROM trips t JOIN orders o ON o.id = t.order_id WHERE t.carrier_id = ? AND t.status IN ('delivered','under_review','closed')", c).s,
      vehicles: q.get('SELECT COUNT(*) n FROM vehicles WHERE company_id = ?', c).n, drivers: q.get('SELECT COUNT(*) n FROM drivers WHERE company_id = ?', c).n,
      performance: trips.carrierPerformance(c, '', ''),
    };
  }));
  api.post('/carrier/trips/:id/accept', ...K, requireCap('carrier.dispatch'), h((req) => trips.acceptTrip(req.ctx, req.params.id)));
  api.post('/carrier/trips/:id/reject', ...K, requireCap('carrier.dispatch'), h((req) => trips.rejectTrip(req.ctx, req.params.id, req.body.reason)));
  api.post('/carrier/trips/:id/assign', ...K, requireCap('carrier.dispatch'), h((req) => trips.assignTrip(req.ctx, req.params.id, req.body)));
  api.get('/carrier/trips/:id/candidates', ...K, requireCap('carrier.dispatch'), h((req) => {
    const t = q.get('SELECT t.*, o.product, (SELECT COALESCE(SUM(requested_ml),0) FROM trip_stops WHERE trip_id = t.id) quantity_ml FROM trips t JOIN orders o ON o.id = t.order_id WHERE t.id = ? AND t.carrier_id = ?', req.params.id, req.ctx.companyId);
    if (!t) throw new HttpError(404, 'الرحلة غير موجودة');
    return { vehicles: trips.eligibleVehicles(req.ctx.companyId, t.product, t.quantity_ml, t.planned_start, t.planned_end, t.id), drivers: trips.eligibleDrivers(req.ctx.companyId, t.planned_start, t.planned_end, t.id) };
  }));
  api.get('/carrier/fleet', ...K, h((req) => ({
    vehicles: q.all('SELECT * FROM vehicles WHERE company_id = ? ORDER BY plate', req.ctx.companyId),
    drivers: q.all('SELECT d.*, u.email FROM drivers d LEFT JOIN users u ON u.id = d.user_id WHERE d.company_id = ? ORDER BY name', req.ctx.companyId),
    prices: q.all('SELECT rp.*, lp.name loading_point_name FROM route_prices rp JOIN loading_points lp ON lp.id = rp.loading_point_id WHERE carrier_id = ? ORDER BY lp.name, delivery_city', req.ctx.companyId),
    coverage: q.all('SELECT * FROM carrier_coverage WHERE carrier_id = ?', req.ctx.companyId),
  })));
  api.post('/carrier/vehicles', ...K, requireCap('carrier.fleet'), h((req) => {
    const b = req.body; if (!b.plate || !b.capacity_liters) throw new HttpError(400, 'اللوحة والسعة مطلوبتان');
    const id = uid('veh_'); q.run('INSERT INTO vehicles(id,company_id,plate,capacity_ml,products,docs_valid_until) VALUES (?,?,?,?,?,?)', id, req.ctx.companyId, b.plate, ML(b.capacity_liters), (b.products || ['diesel']).join(','), b.docs_valid_until || null); return { id };
  }));
  api.post('/carrier/drivers', ...K, requireCap('carrier.fleet'), h((req) => {
    const b = req.body; if (!b.name) throw new HttpError(400, 'الاسم مطلوب');
    const id = uid('drv_'); q.run('INSERT INTO drivers(id,company_id,name,phone,license_no,license_expiry) VALUES (?,?,?,?,?,?)', id, req.ctx.companyId, b.name, b.phone || null, b.license_no || null, b.license_expiry || null); return { id };
  }));
  api.post('/carrier/prices', ...K, requireCap('carrier.prices'), h((req) => {
    const b = req.body; if (!b.loading_point_id || !b.delivery_city || !b.price_sar) throw new HttpError(400, 'أكمل بيانات المسار والسعر');
    const id = uid('rp_');
    tx(() => {
      q.run(`INSERT INTO route_prices(id,carrier_id,loading_point_id,delivery_city,product,pricing_type,price_halalas,waiting_fee_halalas_per_hour,cancel_fee_halalas) VALUES (?,?,?,?,?,?,?,?,?)`,
        id, req.ctx.companyId, b.loading_point_id, b.delivery_city, b.product || 'diesel', b.pricing_type || 'fixed', Math.round(b.price_sar * 100), Math.round((b.waiting_fee_sar || 0) * 100), Math.round((b.cancel_fee_sar || 0) * 100));
      q.run("INSERT OR IGNORE INTO carrier_coverage(id,carrier_id,kind,ref) VALUES (?,?,'loading',?)", uid('cov_'), req.ctx.companyId, b.loading_point_id);
      q.run("INSERT OR IGNORE INTO carrier_coverage(id,carrier_id,kind,ref) VALUES (?,?,'delivery',?)", uid('cov_'), req.ctx.companyId, b.delivery_city);
    });
    return { id };
  }));
  api.post('/carrier/prices/:id/toggle', ...K, requireCap('carrier.prices'), h((req) => { q.run('UPDATE route_prices SET active = 1 - active WHERE id = ? AND carrier_id = ?', req.params.id, req.ctx.companyId); return { ok: true }; }));

  /* ---------------- السائق ---------------- */
  const D = [requireAuth, requireCap('driver.execute')];
  api.post('/driver/trips/:id/advance', ...D, h((req) => trips.driverAdvance(req.ctx, req.params.id, req.body)));
  api.post('/driver/trips/:id/stops/:sid/deliver', ...D, h((req) => trips.driverDeliverStop(req.ctx, req.params.id, req.params.sid, req.body)));
  api.post('/driver/trips/:id/photos', ...D, upload.single('photo'), h((req) => {
    const dup = req.body.client_op_id && q.get('SELECT id FROM trip_photos WHERE client_op_id = ?', req.body.client_op_id);
    if (dup) return { ok: true, duplicate: true, id: dup.id };
    trips.driverTrip(req.ctx, req.params.id);
    if (!req.file) throw new HttpError(400, 'أرفق الصورة');
    const f = docs.storeFile(req.ctx, req.file, 'trip_photo');
    return trips.addPhoto(req.ctx, req.params.id, { ...req.body, file_id: f.id, lat: req.body.lat ? Number(req.body.lat) : null, lng: req.body.lng ? Number(req.body.lng) : null });
  }));

  /* ---------------- مركز تشغيل فيول آب ---------------- */
  const V = [requireAuth, requireCap('platform.view')];
  const XP = [requireAuth, requireCap('platform.export')];
  const cell = (v, t) => (v == null || v === '' ? '' : t === 'l' ? L(v) : t === 'sar' ? v / 100 : t === 'dt' ? new Date(v).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }) : t === 'prod' ? (docs.PRODUCTS[v] || v) : v);
  const filterNote = (f) => [Adm.PERIOD_AR[f.period] + (f.period === 'custom' ? ` ${f.from_date || ''} ← ${f.to_date || ''}` : ''), f.company_id && 'الشركة: ' + (q.get('SELECT name_ar FROM companies WHERE id = ?', f.company_id)?.name_ar || ''), f.city && 'المدينة: ' + f.city, f.project_id && 'المشروع: ' + (q.get('SELECT code FROM projects WHERE id = ?', f.project_id)?.code || ''), f.product && 'المنتج: ' + docs.PRODUCTS[f.product]].filter(Boolean).join(' · ');
  async function sendXlsx(res, name, sheets) {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook(); wb.creator = 'فيول آب';
    for (const sh of sheets) {
      const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: sh.note ? 3 : 1 }] });
      if (sh.note) { ws.addRow([sh.title]).font = { bold: true, size: 13 }; ws.addRow([sh.note]); }
      const hr = ws.addRow(sh.columns.map((c) => c[1]));
      hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000098' } }; });
      for (const r of sh.rows) ws.addRow(sh.columns.map((c) => cell(r[c[0]], c[2])));
      sh.columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, c[1].length + 4); });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.xlsx"`);
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function sendPrintable(res, title, note, blocks) {
    res.type('html').send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
<style>@page{size:A4 landscape;margin:12mm}body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#151633;margin:0;padding:22px;font-size:11.5px}
header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #000098;box-shadow:0 3px 0 #c00000;padding-bottom:10px;margin-bottom:14px}header img{height:54px}
h1{font-size:19px;margin:0;color:#000098}.note{color:#555}.demo{background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:6px;font-weight:600;margin-inline-start:auto}
h2{font-size:14px;color:#000098;margin:16px 0 6px}.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}.kpi{border:1px solid #dcdff0;border-radius:8px;padding:6px 8px}.kpi b{display:block;font-size:16px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}th,td{border:1px solid #e3e5f2;padding:4px 6px;text-align:right}th{background:#f1f2fb}
footer{margin-top:16px;color:#777;font-size:10px}.print{position:fixed;left:16px;top:16px;background:#000098;color:#fff;border:0;padding:8px 14px;border-radius:6px;font-family:inherit}@media print{.print{display:none}}</style></head><body>
<button class="print" onclick="print()">طباعة / حفظ PDF</button><header><img src="/brand/logo-mark.png"><div><h1>${esc(title)}</h1><div class="note">${esc(note)}</div></div><span class="demo">بيانات تجريبية</span></header>
${blocks.map((b) => b.kpis ? `<h2>${esc(b.title)}</h2><div class="kpis">${b.kpis.map(([k, v, u]) => `<div class="kpi">${esc(k)}<b>${esc(v ?? 'بيانات غير كافية')} ${esc(u || '')}</b></div>`).join('')}</div>`
  : `<h2>${esc(b.title)} (${b.rows.length})</h2><table><tr>${b.columns.map((c) => `<th>${esc(c[1])}</th>`).join('')}</tr>${b.rows.map((r) => `<tr>${b.columns.map((c) => `<td>${esc(cell(r[c[0]], c[2]))}</td>`).join('')}</tr>`).join('')}</table>`).join('')}
<footer>أُنشئ في ${new Date().toLocaleString('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh' })} بتوقيت الرياض — فيول آب</footer></body></html>`);
  }

  api.get('/admin/home', ...V, h((req) => Adm.home(req.ctx, Adm.parseFilters(req.query))));
  api.get('/admin/filters', ...V, h(() => ({
    companies: q.all("SELECT id, name_ar, type FROM companies WHERE type <> 'platform' ORDER BY type, name_ar"),
    cities: q.all("SELECT DISTINCT city FROM sites UNION SELECT DISTINCT city FROM companies WHERE city IS NOT NULL AND type <> 'platform' ORDER BY 1").map((r) => r.city),
    projects: q.all('SELECT p.id, p.code, p.name, c.name_ar company_name FROM projects p JOIN companies c ON c.id = p.company_id ORDER BY c.name_ar, p.code'),
    products: docs.PRODUCTS, metrics: Object.fromEntries(Object.entries(Adm.METRICS).map(([k, m]) => [k, { label: m.label, def: m.def || null }])),
    staff: q.all("SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id JOIN companies c ON c.id = m.company_id WHERE c.type = 'platform'"),
    reports: Object.entries(Adm.REPORTS).map(([k, r]) => ({ key: k, title: r.title, finance: !!r.finance })),
  })));
  api.get('/admin/records', ...V, h(async (req, res) => {
    const f = Adm.parseFilters(req.query); const key = req.query.metric;
    if (Adm.METRICS[key]?.finance && !req.ctx.can('platform.finance')) throw new HttpError(403, 'يتطلب صلاحية المالية');
    const r = Adm.records(key, f, { limit: req.query.format ? 5000 : 500, finance: req.ctx.can('platform.finance') });
    if (req.query.format === 'xlsx') {
      if (!req.ctx.can('platform.export')) throw new HttpError(403, 'التصدير غير مسموح لدورك');
      audit(req.ctx, 'admin.export', 'metric', key, { filters: req.query, rows: r.rows.length });
      return sendXlsx(res, `fuelapp-${key}`, [{ name: r.label, title: r.label, note: filterNote(f), columns: r.columns, rows: r.rows }]);
    }
    return r;
  }));
  api.get('/admin/companies', ...V, h((req) => Adm.records('companies.all', Adm.parseFilters({ ...req.query, period: 'all' })).rows));
  api.get('/admin/companies/:id', ...V, h((req) => Adm.companyProfile(req.ctx, req.params.id, Adm.parseFilters(req.query))));
  api.get('/admin/companies/:id/export', ...XP, h(async (req, res) => {
    const f = Adm.parseFilters(req.query); const r = Adm.companyReport(req.ctx, req.params.id, f);
    const p = r.profile; const note = filterNote({ ...f, company_id: null });
    audit(req.ctx, 'admin.export.company', 'company', req.params.id, { filters: req.query, format: req.query.format });
    const kpiRows = p.groups.flatMap((g) => g.metrics.map((m) => ({ group: g.title, label: m.label, value: m.value ?? 'بيانات غير كافية', unit: m.unit || '' })));
    if (req.query.format === 'pdf') return sendPrintable(res, `تقرير ${p.company.name_ar}`, note, [...p.groups.map((g) => ({ title: g.title, kpis: g.metrics.map((m) => [m.label, m.value, m.unit]) })), ...r.lists.map((l) => ({ title: l.label, columns: l.columns, rows: l.rows }))]);
    return sendXlsx(res, `fuelapp-${p.company.name_ar}`, [{ name: 'الملخص', title: `تقرير ${p.company.name_ar}`, note, columns: [['group', 'القسم'], ['label', 'المؤشر'], ['value', 'القيمة'], ['unit', 'الوحدة']], rows: kpiRows },
      ...r.lists.map((l) => ({ name: l.label, columns: l.columns, rows: l.rows }))]);
  }));
  api.get('/admin/search', ...V, h((req) => Adm.search(req.query.q)));
  api.get('/admin/orders/:id', ...V, h((req) => Adm.orderDetail(req.ctx, req.params.id)));
  api.get('/admin/reports/:key', ...V, h(async (req, res) => {
    const f = Adm.parseFilters(req.query); const r = Adm.report(req.ctx, req.params.key, f);
    if (req.query.format) {
      if (!req.ctx.can('platform.export')) throw new HttpError(403, 'التصدير غير مسموح لدورك');
      audit(req.ctx, 'admin.export.report', 'report', req.params.key, { filters: req.query, format: req.query.format, rows: r.rows.length });
      if (req.query.format === 'pdf') return sendPrintable(res, r.title, filterNote(f), [...(r.summary ? [{ title: 'الملخص', kpis: r.summary.map(([k, v]) => [k, v, 'لتر']) }] : []), { title: r.title, columns: r.columns, rows: r.rows }]);
      return sendXlsx(res, `fuelapp-${req.params.key}`, [{ name: r.title, title: r.title, note: filterNote(f), columns: r.columns, rows: r.rows }]);
    }
    return { ...r, rows: r.rows.slice(0, 1000) };
  }));
  // إجراءات حساسة: تُسجّل في سجل التدقيق
  api.post('/admin/follow-ups', requireAuth, requireCap('platform.manage'), h((req) => {
    const { entity_type, entity_id, assignee_user_id, note } = req.body;
    if (!['order', 'trip', 'company', 'document'].includes(entity_type) || !entity_id) throw new HttpError(400, 'حدد السجل');
    const id = uid('fu_'); q.run('INSERT INTO follow_ups(id,entity_type,entity_id,assignee_user_id,note,created_by) VALUES (?,?,?,?,?,?)', id, entity_type, entity_id, assignee_user_id || req.ctx.userId, note || null, req.ctx.userId);
    audit(req.ctx, 'admin.follow_up.assign', entity_type, entity_id, { assignee_user_id, note }); return { id };
  }));
  api.post('/admin/follow-ups/:id/close', requireAuth, requireCap('platform.manage'), h((req) => {
    const r = q.run("UPDATE follow_ups SET status='done', closed_at=? WHERE id = ? AND status='open'", now(), req.params.id); if (!r.changes) throw new HttpError(404, 'غير موجود');
    audit(req.ctx, 'admin.follow_up.close', 'follow_up', req.params.id); return { ok: true };
  }));
  api.post('/admin/invoices/:id/pay', requireAuth, requireCap('platform.finance'), requireCap('platform.manage'), h((req) => Fin.payInvoice(req.ctx, req.params.id, req.body.amount_sar)));
  api.post('/admin/settlements/:id/pay', requireAuth, requireCap('platform.finance'), requireCap('platform.manage'), h((req) => Fin.paySettlement(req.ctx, req.params.id)));
  api.get('/admin/audit', ...V, h(() => q.all(`SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.action LIKE 'admin.%' OR a.action LIKE 'company.%' OR a.action LIKE 'company_doc.%' OR a.action = 'auth.demo_enter' ORDER BY a.id DESC LIMIT 300`)));

  /* ---------------- إدارة فيول آب ---------------- */
  const A = [requireAuth, requireCap('platform.view')];
  api.get('/admin/overview', ...A, h(() => ({
    companies: q.all(`SELECT c.*, (SELECT COUNT(*) FROM company_documents d WHERE d.company_id = c.id AND d.status='pending') pending_docs,
        (SELECT COUNT(*) FROM trips t WHERE t.company_id = c.id OR t.carrier_id = c.id) trips FROM companies c WHERE c.type <> 'platform' ORDER BY c.status, c.created_at`),
    documents: q.all('SELECT d.*, c.name_ar company_name FROM company_documents d JOIN companies c ON c.id = d.company_id ORDER BY d.status, d.expires_at'),
    trips_by_status: q.all('SELECT status, COUNT(*) n FROM trips GROUP BY status').map((r) => ({ ...r, label: trips.TRIP_STATUS_AR[r.status] })),
    gmv_halalas: q.get("SELECT COALESCE(SUM(transport_halalas),0) s FROM orders WHERE status NOT IN ('cancelled','rejected')").s,
    totals: { fuelings: q.get('SELECT COUNT(*) n FROM fuelings').n, assets: q.get('SELECT COUNT(*) n FROM assets').n, tags: q.get("SELECT COUNT(*) n FROM nfc_tags WHERE status='active'").n },
  })));
  api.post('/admin/companies/:id/:action(approve|suspend|reject)', requireAuth, requireCap('platform.admin'), h((req) => tx(() => {
    const map = { approve: 'approved', suspend: 'suspended', reject: 'rejected' }; const st = map[req.params.action]; if (!st) throw new HttpError(400, 'إجراء غير معروف');
    const c = q.get('SELECT * FROM companies WHERE id = ?', req.params.id); if (!c) throw new HttpError(404, 'الشركة غير موجودة');
    q.run('UPDATE companies SET status = ? WHERE id = ?', st, c.id);
    if (st === 'suspended' && c.type === 'carrier') {
      // تغير الأهلية لرحلات جارية: مراجعة تشغيلية فورية
      for (const t of q.all(`SELECT id, number, company_id FROM trips WHERE carrier_id = ? AND status IN (${trips.ACTIVE_TRIP.map(() => '?').join(',')})`, c.id, ...trips.ACTIVE_TRIP))
        trips.openException(t.company_id, 'eligibility_change', 'trip', t.id, `تغيرت أهلية الناقل للرحلة الجارية ${t.number}`, { carrier: c.name_ar, reason: req.body.reason });
    }
    audit(req.ctx, 'company.' + st, 'company', c.id, { reason: req.body.reason }); return { ok: true };
  })));
  api.post('/admin/documents/:id/:action(approve|reject)', requireAuth, requireCap('platform.admin'), h((req) => {
    const st = { approve: 'approved', reject: 'rejected' }[req.params.action]; if (!st) throw new HttpError(400, 'إجراء غير معروف');
    q.run('UPDATE company_documents SET status = ?, reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ?', st, req.ctx.userId, now(), req.body.note || null, req.params.id);
    audit(req.ctx, 'company_doc.' + st, 'company_document', req.params.id); return { ok: true };
  }));

  /* ---------------- معالجة الأخطاء ---------------- */
  api.use((_req, _res, next) => next(new HttpError(404, 'المسار غير موجود')));
  app.use((err, req, res, _next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'خطأ داخلي في الخادم' : err.message, details: err.details });
  });

  /* ---------------- واجهة الويب ---------------- */
  const dist = path.join(ROOT, 'web', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h', redirect: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
