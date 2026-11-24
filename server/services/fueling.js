import crypto from 'node:crypto';
import { q, tx, uid, now, nextNumber, audit, notify, HttpError, L, ML } from '../db.js';
import { tankBalance, batchBalance } from './inventory.js';
import { openException } from './trips.js';

export const TAG_STATUS_AR = {
  in_custody: 'في العهدة', pending_activation: 'بانتظار التفعيل', active: 'نشطة', suspended: 'موقوفة',
  lost: 'مفقودة', damaged: 'تالفة', replaced: 'مستبدلة',
};

function companySettings(companyId) {
  const c = q.get('SELECT settings_json FROM companies WHERE id = ?', companyId);
  return { allow_qr: true, allow_manual: true, rapid_repeat_minutes: 15, cost_method: 'weighted_average', require_meter: true, ...JSON.parse(c?.settings_json || '{}') };
}

function tagEvent(companyId, tag, action, result, reason, userId, assetId) {
  q.run('INSERT INTO nfc_tag_events(tag_id,company_id,uid,asset_id,action,result,reason,by_user) VALUES (?,?,?,?,?,?,?,?)',
    tag?.id ?? null, companyId, tag?.uid ?? null, assetId ?? tag?.asset_id ?? null, action, result ?? null, reason ?? null, userId ?? null);
}

/* ------------------------------------------------------------------ */
/* دورة حياة الشريحة                                                     */
/* ------------------------------------------------------------------ */
export function issueTagBatch(ctx, { batch_no, uids, count, custodian_user_id }) {
  return tx(() => {
    const list = (uids && uids.length ? uids : Array.from({ length: Number(count) || 0 }, () => crypto.randomBytes(7).toString('hex').toUpperCase()))
      .map((u) => String(u).trim().toUpperCase()).filter(Boolean);
    if (!list.length) throw new HttpError(400, 'أدخل أرقام الشرائح أو العدد');
    const created = [];
    for (const u of list) {
      if (q.get('SELECT 1 FROM nfc_tags WHERE uid = ?', u)) throw new HttpError(409, `الشريحة ${u} مسجلة سابقًا`);
      const n = q.get("SELECT COUNT(*) n FROM nfc_tags WHERE company_id = ?", ctx.companyId).n + 1;
      const id = uid('tag_');
      q.run('INSERT INTO nfc_tags(id,company_id,uid,display_no,batch_no,status,custodian_user_id) VALUES (?,?,?,?,?,?,?)',
        id, ctx.companyId, u, `NFC-${String(n).padStart(5, '0')}`, batch_no || null, 'in_custody', custodian_user_id || ctx.userId);
      tagEvent(ctx.companyId, { id, uid: u }, 'issue', 'ok', batch_no ? `دفعة ${batch_no}` : null, ctx.userId);
      created.push(id);
    }
    audit(ctx, 'nfc.batch', 'nfc_tag', null, { count: created.length, batch_no });
    return { ok: true, created: created.length };
  });
}

function ownTag(ctx, where, val) {
  const t = q.get(`SELECT * FROM nfc_tags WHERE ${where} = ? AND company_id = ?`, val, ctx.companyId);
  if (!t) throw new HttpError(404, 'الشريحة غير مسجلة لدى الشركة');
  return t;
}

/** ربط: المشرف يختار الأصل ويقرأ الشريحة ويؤكد، ثم اختبار القراءة يفعّلها */
export function bindTag(ctx, { uid: tagUid, asset_id, asset_code_confirm, test_read_ok }) {
  return tx(() => {
    const tag = ownTag(ctx, 'uid', String(tagUid).toUpperCase());
    const asset = q.get('SELECT * FROM assets WHERE id = ? AND company_id = ?', asset_id, ctx.companyId);
    if (!asset) throw new HttpError(404, 'الأصل غير موجود');
    if (asset_code_confirm && asset_code_confirm.trim() !== asset.code && asset_code_confirm.trim() !== asset.plate_or_serial)
      throw new HttpError(409, 'الرقم المدخل لا يطابق الرقم الداخلي أو التسلسلي للأصل');
    if (!['in_custody', 'pending_activation'].includes(tag.status)) throw new HttpError(409, `لا يمكن ربط شريحة حالتها «${TAG_STATUS_AR[tag.status]}»`);
    if (tag.asset_id && tag.asset_id !== asset.id) throw new HttpError(409, 'الشريحة مرتبطة بأصل آخر');
    const active = q.get("SELECT display_no FROM nfc_tags WHERE asset_id = ? AND status = 'active'", asset.id);
    if (active) throw new HttpError(409, `للأصل شريحة نشطة (${active.display_no}). استخدم الاستبدال`);
    q.run("UPDATE nfc_tags SET asset_id = ?, status = 'pending_activation' WHERE id = ?", asset.id, tag.id);
    tagEvent(ctx.companyId, tag, 'bind', 'ok', `مشروع ${asset.project_id ?? '-'}`, ctx.userId, asset.id);
    if (test_read_ok) activate(ctx, tag.id, true);
    audit(ctx, 'nfc.bind', 'nfc_tag', tag.id, { asset: asset.id, test_read_ok: !!test_read_ok });
    return { ok: true, status: test_read_ok ? 'active' : 'pending_activation' };
  });
}

function activate(ctx, tagId, viaTest) {
  const tag = q.get('SELECT * FROM nfc_tags WHERE id = ?', tagId);
  if (tag.status !== 'pending_activation' || !tag.asset_id) throw new HttpError(409, 'الشريحة ليست بانتظار التفعيل');
  try {
    q.run("UPDATE nfc_tags SET status = 'active' WHERE id = ?", tagId);
  } catch (e) {
    throw new HttpError(409, 'للأصل شريحة نشطة أخرى');
  }
  tagEvent(ctx.companyId, tag, 'activate', 'ok', viaTest ? 'اختبار قراءة ناجح' : null, ctx.userId);
}

export function tagAction(ctx, tagId, action, { reason, new_uid } = {}) {
  return tx(() => {
    const tag = ownTag(ctx, 'id', tagId);
    switch (action) {
      case 'activate': activate(ctx, tag.id); break;
      case 'suspend':
        if (tag.status !== 'active') throw new HttpError(409, 'الشريحة ليست نشطة');
        q.run("UPDATE nfc_tags SET status='suspended' WHERE id = ?", tag.id); break;
      case 'reactivate':
        if (tag.status !== 'suspended') throw new HttpError(409, 'الشريحة ليست موقوفة');
        q.run("UPDATE nfc_tags SET status='active' WHERE id = ?", tag.id); break;
      case 'lost': case 'damaged':
        if (['replaced', 'lost', 'damaged'].includes(tag.status)) throw new HttpError(409, 'حالة الشريحة لا تسمح');
        q.run('UPDATE nfc_tags SET status = ? WHERE id = ?', action, tag.id); break;
      case 'replace': {
        if (!new_uid) throw new HttpError(400, 'اقرأ الشريحة الجديدة');
        if (!tag.asset_id) throw new HttpError(409, 'الشريحة غير مرتبطة بأصل');
        const nt = ownTag(ctx, 'uid', String(new_uid).toUpperCase());
        if (nt.status !== 'in_custody') throw new HttpError(409, 'الشريحة الجديدة يجب أن تكون في العهدة');
        q.run("UPDATE nfc_tags SET status='replaced' WHERE id = ?", tag.id);
        q.run("UPDATE nfc_tags SET asset_id = ?, status='active' WHERE id = ?", tag.asset_id, nt.id);
        tagEvent(ctx.companyId, nt, 'bind', 'ok', `بديل للشريحة ${tag.display_no}`, ctx.userId, tag.asset_id);
        tagEvent(ctx.companyId, nt, 'activate', 'ok', 'استبدال', ctx.userId, tag.asset_id);
        break;
      }
      default: throw new HttpError(400, 'إجراء غير معروف');
    }
    tagEvent(ctx.companyId, tag, action, 'ok', reason, ctx.userId);
    audit(ctx, 'nfc.' + action, 'nfc_tag', tag.id, { reason, new_uid });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* التحقق من التفويض قبل التزويد                                         */
/* ------------------------------------------------------------------ */
function riyadhDay(iso) { return new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 10); }

export function resolveSource(ctx, source_type, source_id) {
  if (source_type === 'tank') {
    const t = q.get('SELECT t.*, s.project_id FROM tanks t JOIN sites s ON s.id = t.site_id WHERE t.id = ? AND t.company_id = ?', source_id, ctx.companyId);
    if (!t) throw new HttpError(404, 'مصدر الوقود غير موجود');
    return { type: 'tank', id: t.id, site_id: t.site_id, project_id: t.project_id, product: t.product, label: t.code, balance_ml: tankBalance(t.id).available_ml };
  }
  if (source_type === 'batch') {
    const b = q.get(`SELECT b.*, s.project_id, t.id trip_id, t.number trip_number, t.status trip_status FROM fuel_batches b JOIN sites s ON s.id = b.site_id
        JOIN trip_stops ts ON ts.id = b.trip_stop_id JOIN trips t ON t.id = ts.trip_id WHERE b.id = ? AND b.company_id = ? AND b.mode = 'direct'`, source_id, ctx.companyId);
    if (!b) throw new HttpError(404, 'مصدر الوقود غير موجود');
    return { type: 'batch', id: b.id, site_id: b.site_id, project_id: b.project_id, product: b.product, label: b.trip_number, trip_id: b.trip_id, trip_status: b.trip_status, balance_ml: batchBalance(b.id).balance_ml };
  }
  throw new HttpError(400, 'حدد مصدر الوقود');
}

/**
 * يعيد بطاقة الأصل ونتيجة التحقق. لا يكشف بيانات الأصل لشريحة لا تخص الشركة.
 */
export function authorize(ctx, { uid: tagUid, asset_id, verification = 'nfc', source_type, source_id, quantity_liters, meter_value, at }) {
  const reasons = [], warnings = [];
  const settings = companySettings(ctx.companyId);
  let tag = null, asset = null;
  if (verification === 'nfc') {
    tag = q.get('SELECT * FROM nfc_tags WHERE uid = ? AND company_id = ?', String(tagUid || '').toUpperCase(), ctx.companyId);
    if (!tag) {
      q.run("INSERT INTO authorization_attempts(company_id,uid,operator_user_id,result,reasons_json) VALUES (?,?,?,'rejected',?)", ctx.companyId, tagUid, ctx.userId, JSON.stringify(['شريحة غير مسجلة']));
      tagEvent(ctx.companyId, { uid: tagUid }, 'rejected', 'unknown', 'شريحة غير مسجلة', ctx.userId);
      throw new HttpError(404, 'الشريحة غير مسجلة لدى الشركة');
    }
    if (tag.status !== 'active') reasons.push({ code: 'tag_' + tag.status, msg: `الشريحة ${TAG_STATUS_AR[tag.status]}` });
    asset = tag.asset_id ? q.get('SELECT * FROM assets WHERE id = ?', tag.asset_id) : null;
    if (!asset) reasons.push({ code: 'tag_unbound', msg: 'الشريحة غير مرتبطة بأصل' });
  } else {
    if (verification === 'qr' && !settings.allow_qr) reasons.push({ code: 'qr_disabled', msg: 'سياسة الشركة لا تسمح بـ QR' });
    if (verification === 'manual' && !settings.allow_manual) reasons.push({ code: 'manual_disabled', msg: 'سياسة الشركة لا تسمح بالإدخال اليدوي' });
    asset = q.get('SELECT * FROM assets WHERE (id = ? OR code = ?) AND company_id = ?', asset_id, asset_id, ctx.companyId);
    if (!asset) throw new HttpError(404, 'الأصل غير موجود');
    warnings.push({ code: 'alt_verification', msg: verification === 'qr' ? 'تحقق بديل عبر QR - يُسجل كاستثناء' : 'إدخال يدوي - يُسجل كاستثناء' });
  }
  if (!ctx.can('fueling.create')) reasons.push({ code: 'operator', msg: 'المشغّل غير مخول بالتزويد' });
  if (ctx.scopeProjectId && asset && asset.project_id !== ctx.scopeProjectId) reasons.push({ code: 'operator_scope', msg: 'الأصل خارج نطاق مشروع المشغّل' });
  let source = null;
  if (source_type && source_id) source = resolveSource(ctx, source_type, source_id);
  if (asset) {
    if (asset.status !== 'active') reasons.push({ code: 'asset_inactive', msg: 'الأصل غير نشط' });
    if (source) {
      if (source.product !== asset.fuel_type) reasons.push({ code: 'fuel_type', msg: `نوع الوقود مختلف: الأصل ${asset.fuel_type} والمصدر ${source.product}` });
      if (source.site_id !== asset.site_id && source.project_id !== asset.project_id) reasons.push({ code: 'site_project', msg: 'المصدر في موقع/مشروع مختلف عن الأصل' });
      if (source.type === 'batch' && !['at_site', 'delivered', 'under_review', 'closed', 'to_delivery'].includes(source.trip_status)) reasons.push({ code: 'batch_trip', msg: 'الصهريج لم يصل للموقع' });
    }
    const qty = quantity_liters != null && quantity_liters !== '' ? ML(quantity_liters) : null;
    if (qty != null) {
      if (!(qty > 0)) reasons.push({ code: 'qty', msg: 'الكمية غير صحيحة' });
      if (asset.per_tx_limit_ml && qty > asset.per_tx_limit_ml) reasons.push({ code: 'per_tx_limit', msg: `تتجاوز سقف العملية (${L(asset.per_tx_limit_ml)} لتر)` });
      if (asset.tank_capacity_ml && qty > asset.tank_capacity_ml) reasons.push({ code: 'capacity', msg: `تتجاوز سعة خزان الأصل (${L(asset.tank_capacity_ml)} لتر)` });
      const day = riyadhDay(at || now());
      const today = q.all("SELECT quantity_ml, created_at FROM fuelings WHERE asset_id = ? AND status IN ('approved','draft')", asset.id)
        .filter((f) => riyadhDay(f.created_at) === day).reduce((s, f) => s + f.quantity_ml, 0);
      if (asset.daily_limit_ml && today + qty > asset.daily_limit_ml) reasons.push({ code: 'daily_limit', msg: `تتجاوز السقف اليومي (${L(asset.daily_limit_ml)} لتر، المصروف اليوم ${L(today)})` });
      const month = day.slice(0, 7);
      const m = q.all("SELECT quantity_ml, created_at FROM fuelings WHERE asset_id = ? AND status IN ('approved','draft')", asset.id)
        .filter((f) => riyadhDay(f.created_at).slice(0, 7) === month).reduce((s, f) => s + f.quantity_ml, 0);
      if (asset.monthly_limit_ml && m + qty > asset.monthly_limit_ml) reasons.push({ code: 'monthly_limit', msg: `تتجاوز السقف الشهري (${L(asset.monthly_limit_ml)} لتر)` });
      if (source && qty > source.balance_ml) reasons.push({ code: 'source_balance', msg: `الكمية أكبر من المتاح في المصدر (${L(source.balance_ml)} لتر)` });
    }
    const last = q.get("SELECT created_at, meter_value FROM fuelings WHERE asset_id = ? AND status='approved' AND quantity_ml > 0 ORDER BY created_at DESC LIMIT 1", asset.id);
    if (last && (Date.now() - new Date(last.created_at).getTime()) / 60000 < settings.rapid_repeat_minutes)
      warnings.push({ code: 'rapid_repeat', msg: `عملية سابقة لنفس الأصل قبل أقل من ${settings.rapid_repeat_minutes} دقيقة` });
    if (asset.meter_type !== 'none' && meter_value != null && meter_value !== '') {
      const lastMeter = q.get("SELECT meter_value FROM fuelings WHERE asset_id = ? AND status='approved' AND meter_value IS NOT NULL ORDER BY created_at DESC LIMIT 1", asset.id);
      if (lastMeter && Number(meter_value) < lastMeter.meter_value) warnings.push({ code: 'meter_rollback', msg: `قراءة العداد أقل من السابقة (${lastMeter.meter_value})` });
    }
    if (asset.meter_type !== 'none' && settings.require_meter && quantity_liters != null && (meter_value == null || meter_value === ''))
      reasons.push({ code: 'meter_required', msg: asset.meter_type === 'km' ? 'قراءة عداد الكيلومترات مطلوبة' : 'قراءة ساعات التشغيل مطلوبة' });
  }
  const card = asset && (tag ? tag.status === 'active' || true : true) ? assetCard(asset) : null;
  return { authorized: reasons.length === 0, reasons, warnings, asset: card, tag: tag ? { id: tag.id, display_no: tag.display_no, status: tag.status, status_ar: TAG_STATUS_AR[tag.status] } : null, source };
}

function assetCard(a) {
  return q.get(`SELECT a.*, p.name project_name, p.code project_code, s.name site_name, cc.code cost_center_code, cc.name cost_center_name,
      (SELECT display_no FROM nfc_tags WHERE asset_id = a.id AND status='active') tag_display_no
    FROM assets a LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
    WHERE a.id = ?`, a.id);
}

/* ------------------------------------------------------------------ */
/* تسجيل عملية التزويد (مرة واحدة فقط لكل client_op_id)                    */
/* ------------------------------------------------------------------ */
export function createFueling(ctx, body) {
  const { client_op_id, offline, captured_at, measure_source, meter_value, meter_photo_file_id, source_type, source_id } = body;
  if (!client_op_id) throw new HttpError(400, 'معرف العملية مطلوب');
  const prior = q.get('SELECT id, number, status FROM fuelings WHERE client_op_id = ?', client_op_id);
  if (prior) return { ...prior, duplicate: true };
  return tx(() => {
    const again = q.get('SELECT id, number, status FROM fuelings WHERE client_op_id = ?', client_op_id);
    if (again) return { ...again, duplicate: true };
    const verification = body.verification || 'nfc';
    let res;
    try { res = authorize(ctx, { ...body, verification, at: captured_at }); }
    catch (e) { if (offline && e.status === 404) res = { authorized: false, reasons: [{ code: 'not_found', msg: e.message }], warnings: [], asset: null }; else throw e; }
    q.run('INSERT INTO authorization_attempts(company_id,uid,tag_id,asset_id,operator_user_id,result,reasons_json) VALUES (?,?,?,?,?,?,?)',
      ctx.companyId, body.uid ?? null, res.tag?.id ?? null, res.asset?.id ?? null, ctx.userId, res.authorized ? 'authorized' : 'rejected', JSON.stringify([...res.reasons, ...res.warnings]));
    if (!res.authorized) {
      if (res.tag) tagEvent(ctx.companyId, { id: res.tag.id, uid: body.uid }, 'rejected', 'denied', res.reasons.map((r) => r.msg).join('، '), ctx.userId, res.asset?.id);
      if (!offline || !res.asset) {
        if (offline) throw new HttpError(422, 'تعذر التحقق: ' + res.reasons.map((r) => r.msg).join('، '), { reasons: res.reasons });
        throw new HttpError(422, 'رُفض التفويض: ' + res.reasons.map((r) => r.msg).join('، '), { reasons: res.reasons });
      }
    }
    const asset = res.asset;
    const source = res.source || resolveSource(ctx, source_type, source_id);
    const qty = ML(body.quantity_liters);
    const id = uid('ful_');
    const number = nextNumber('fueling', 'HJ-FUL');
    const base = [id, number, ctx.companyId, asset.id, res.tag?.id ?? null, verification, source.type, source.type === 'tank' ? source.id : null,
      source.type === 'batch' ? source.id : null, source.trip_id ?? null, ctx.userId, qty, measure_source || 'manual',
      asset.meter_type === 'none' ? null : asset.meter_type, meter_value === '' || meter_value == null ? null : Number(meter_value),
      asset.meter_type === 'km' ? 'كم' : asset.meter_type === 'hours' ? 'ساعة' : null, meter_photo_file_id ?? null,
      asset.project_id, asset.site_id, asset.cost_center_id, source.product, client_op_id, captured_at || now()];
    const cols = `id,number,company_id,asset_id,tag_id,verification,source_type,tank_id,batch_id,trip_id,operator_user_id,quantity_ml,measure_source,
      meter_type,meter_value,meter_unit,meter_photo_file_id,project_id,site_id,cost_center_id,product,client_op_id,captured_at`;
    const flags = res.warnings.map((w) => w.code).join(',') || null;

    if (!res.authorized) {
      // عملية من وضع عدم الاتصال لم تجتز التحقق عند المزامنة: تُحفظ مرفوضة كتعارض للمراجعة، دون تغيير أي رصيد
      q.run(`INSERT INTO fuelings(${cols},status,exception_flag,reject_reason) VALUES (${cols.split(',').map(() => '?').join(',')},'rejected',?,?)`,
        ...base, 'offline_conflict', res.reasons.map((r) => r.msg).join('، '));
      openException(ctx.companyId, 'offline_conflict', 'fueling', id, `تعارض مزامنة في العملية ${number}`, { reasons: res.reasons });
      return { id, number, status: 'rejected', reasons: res.reasons };
    }

    const avg = source.type === 'tank' ? tankBalance(source.id).avg_cost_per_ml : batchBalance(source.id).avg_cost_per_ml;
    const cost = avg == null ? null : Math.round(avg * qty);
    const mid = uid('mov_');
    q.run(`INSERT INTO fuel_movements(id,company_id,kind,tank_id,batch_id,quantity_ml,cost_halalas,ref_type,ref_id,note,created_by,approved_by)
        VALUES (?,?,'issue',?,?,?,?,'fueling',?,?,?,?)`, mid, ctx.companyId, source.type === 'tank' ? source.id : null, source.type === 'batch' ? source.id : null,
      -qty, cost == null ? null : -cost, id, `صرف ${number} - ${asset.code}`, ctx.userId, ctx.userId);
    q.run(`INSERT INTO fuelings(${cols},status,cost_halalas,exception_flag,movement_id,approved_at) VALUES (${cols.split(',').map(() => '?').join(',')},'approved',?,?,?,?)`,
      ...base, cost, flags, mid, now());
    if (verification !== 'nfc') openException(ctx.companyId, 'alt_verification', 'fueling', id, `تحقق بديل (${verification === 'qr' ? 'QR' : 'يدوي'}) في ${number}`, { asset: asset.code });
    if (res.warnings.some((w) => w.code === 'meter_rollback' || w.code === 'rapid_repeat'))
      notify(ctx.companyId, 'project_manager', `تنبيه رقابي على ${asset.code}`, res.warnings.map((w) => w.msg).join('، '), `/fuelings/${id}`, `warn:${id}`);
    if (res.tag) tagEvent(ctx.companyId, { id: res.tag.id, uid: body.uid }, 'read', 'authorized', number, ctx.userId, asset.id);
    audit(ctx, 'fueling.create', 'fueling', id, { qty, source: source.id, offline: !!offline });
    return { id, number, status: 'approved', warnings: res.warnings, cost_halalas: cost };
  });
}

/** تصحيح عملية معتمدة: حركة تصحيح مرتبطة تحتفظ بالعملية الأصلية وتخصيصها التاريخي */
export function correctFueling(ctx, fuelingId, { new_quantity_liters, reason }) {
  if (!reason) throw new HttpError(400, 'سبب التصحيح مطلوب');
  return tx(() => {
    const f = q.get("SELECT * FROM fuelings WHERE id = ? AND company_id = ? AND status = 'approved' AND corrects_fueling_id IS NULL", fuelingId, ctx.companyId);
    if (!f) throw new HttpError(404, 'العملية غير موجودة أو ليست قابلة للتصحيح');
    if (f.operator_user_id === ctx.userId) throw new HttpError(403, 'يجب أن يعتمد التصحيح دور مختلف عن منفذ العملية');
    const prevCorr = q.get("SELECT COALESCE(SUM(quantity_ml),0) s FROM fuelings WHERE corrects_fueling_id = ? AND status='approved'", f.id).s;
    const current = f.quantity_ml + prevCorr;
    const target = ML(new_quantity_liters);
    const delta = target - current;
    if (delta === 0) throw new HttpError(400, 'لا يوجد تغيير');
    if (delta > 0) {
      const bal = f.source_type === 'tank' ? tankBalance(f.tank_id).available_ml : batchBalance(f.batch_id).balance_ml;
      if (delta > bal) throw new HttpError(409, 'رصيد المصدر لا يكفي للتصحيح');
    }
    const unit = f.cost_halalas == null ? null : f.cost_halalas / f.quantity_ml;
    const cost = unit == null ? null : Math.round(unit * delta);
    const id = uid('ful_'); const number = nextNumber('fueling', 'HJ-FUL'); const mid = uid('mov_');
    q.run(`INSERT INTO fuel_movements(id,company_id,kind,tank_id,batch_id,quantity_ml,cost_halalas,ref_type,ref_id,note,created_by,approved_by)
        VALUES (?,?,'reversal',?,?,?,?,'fueling',?,?,?,?)`, mid, ctx.companyId, f.tank_id, f.batch_id, -delta, cost == null ? null : -cost, id, `تصحيح ${f.number}: ${reason}`, ctx.userId, ctx.userId);
    q.run(`INSERT INTO fuelings(id,number,company_id,asset_id,tag_id,verification,source_type,tank_id,batch_id,trip_id,operator_user_id,quantity_ml,measure_source,
        project_id,site_id,cost_center_id,product,cost_halalas,status,exception_flag,movement_id,corrects_fueling_id,client_op_id,captured_at,approved_at,reject_reason)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'correction',?,?,?,?,?,'approved','correction',?,?,?,?,?,?)`,
      id, number, ctx.companyId, f.asset_id, f.tag_id, f.verification, f.source_type, f.tank_id, f.batch_id, f.trip_id, ctx.userId, delta,
      f.project_id, f.site_id, f.cost_center_id, f.product, cost, mid, f.id, 'corr:' + id, now(), now(), reason);
    audit(ctx, 'fueling.correct', 'fueling', f.id, { delta, reason, correction: id });
    return { ok: true, id, number, delta_ml: delta };
  });
}
