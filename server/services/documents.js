import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, tx, uid, now, audit, HttpError, UPLOAD_DIR, ML, L } from '../db.js';
import { documentQuantities } from './trips.js';

let pdfjs;
/** استخراج نص PDF بمكتبة pdf.js (تحافظ على ترتيب الأسطر) */
async function pdfText(buffer) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    let lastY;
    for (const it of c.items) { if (lastY !== undefined && Math.abs(it.transform[5] - lastY) > 2) text += '\n'; text += it.str; lastY = it.transform[5]; }
    text += '\n';
  }
  const pages = doc.numPages; await doc.destroy();
  return { text, pages };
}

export const PRODUCTS = { diesel: 'ديزل', gasoline91: 'بنزين 91', gasoline95: 'بنزين 95' };

const ALLOWED = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

/** حفظ ملف في التخزين الخاص بعد فحص نوعه الفعلي (التوقيع) */
export function storeFile(ctx, { buffer, originalname, mimetype }, kind, companyId = ctx.companyId) {
  const sig = ALLOWED[mimetype];
  if (!sig || !sig.every((b, i) => buffer[i] === b)) throw new HttpError(415, 'نوع الملف غير مسموح أو لا يطابق محتواه');
  if (buffer.length > 15 * 1024 * 1024) throw new HttpError(413, 'حجم الملف كبير');
  const id = uid('fil_');
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mimetype];
  const rel = path.join(companyId, id + ext);
  fs.mkdirSync(path.join(UPLOAD_DIR, companyId), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, rel), buffer);
  q.run('INSERT INTO files(id,company_id,kind,original_name,mime,size,storage_path,sha256,created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    id, companyId, kind, originalname, mimetype, buffer.length, rel, sha, ctx.userId);
  return { id, sha256: sha };
}

/** استخراج الحقول من نص المستند مع درجة ثقة لكل حقل */
export function extractFields(text) {
  const t = (text || '').replace(/ /g, ' ');
  const out = {};
  const put = (k, v, conf) => { if (v != null && out[k] == null) out[k] = { value: v, confidence: conf }; };
  let m = t.match(/(?:Document|Delivery\s*Order|Order|DO|Ref(?:erence)?)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/i)
       || t.match(/رقم\s*(?:المستند|الأمر|الطلب)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/i);
  if (m) put('doc_number', m[1].trim(), 'high');
  else if ((m = t.match(/\b([A-Z]{2,4}-[A-Z0-9]{2,}-\d{3,}[\-\d]*)\b/))) put('doc_number', m[1], 'low');

  m = t.match(/(?:Quantity|Qty|الكمية)\s*[:\-]?\s*([\d][\d,\.]*)\s*(?:Liters|Litres|L\b|لتر)?/i);
  if (m) put('quantity_liters', Number(m[1].replace(/,/g, '')), 'high');
  else if ((m = t.match(/([\d][\d,]{2,})\s*(?:Liters|Litres|لتر)/i))) put('quantity_liters', Number(m[1].replace(/,/g, '')), 'low');

  if (/diesel|ديزل/i.test(t)) put('product', 'diesel', /Product\s*:?\s*Diesel/i.test(t) ? 'high' : 'low');
  else if (/(gasoline|petrol|بنزين)\s*95/i.test(t)) put('product', 'gasoline95', 'high');
  else if (/(gasoline|petrol|بنزين)\s*91/i.test(t)) put('product', 'gasoline91', 'high');

  for (const lp of q.all('SELECT id, code, name FROM loading_points')) {
    if (new RegExp(`\\b${lp.code}\\b`).test(t)) { put('loading_point_id', lp.id, 'high'); break; }
    if (t.includes(lp.name)) { put('loading_point_id', lp.id, 'low'); break; }
  }
  m = t.match(/Issue\s*Date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i) || t.match(/تاريخ\s*الإصدار\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/);
  if (m) put('issue_date', m[1], 'high');
  m = t.match(/(?:Valid\s*Until|Expiry(?:\s*Date)?|Expires)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i) || t.match(/(?:صالح\s*حتى|تاريخ\s*الانتهاء)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/);
  if (m) put('expiry_date', m[1], 'high');
  return out;
}

export async function uploadAramcoDocument(ctx, file) {
  if (!file) throw new HttpError(400, 'أرفق ملف PDF');
  if (file.mimetype !== 'application/pdf') throw new HttpError(415, 'يقبل المستند بصيغة PDF فقط');
  const stored = storeFile(ctx, file, 'aramco_doc');
  let text = '', pages = 0, status = 'text';
  try { const r = await pdfText(file.buffer); text = r.text || ''; pages = r.pages; } catch { status = 'unreadable'; }
  if (status === 'text' && text.replace(/\s/g, '').length < 20) status = 'scanned'; // ممسوح ضوئيًا: يتطلب إدخالًا يدويًا (OCR مؤجل)
  const fields = extractFields(text);
  const dupFile = q.get(`SELECT d.id FROM aramco_documents d JOIN files f ON f.id = d.file_id WHERE d.company_id = ? AND f.sha256 = ? AND d.id IS NOT NULL ORDER BY d.created_at LIMIT 1`, ctx.companyId, stored.sha256);
  const id = uid('doc_');
  const v = (k) => fields[k]?.value ?? null;
  q.run(`INSERT INTO aramco_documents(id,company_id,file_id,doc_number,loading_point_id,product,authorized_ml,issue_date,expiry_date,extraction_json,duplicate_of,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, ctx.companyId, stored.id, v('doc_number'), v('loading_point_id'), v('product'),
    v('quantity_liters') != null ? ML(v('quantity_liters')) : null, v('issue_date'), v('expiry_date'),
    JSON.stringify({ status, pages, fields, text_preview: text.slice(0, 1500) }), dupFile?.id ?? null, ctx.userId);
  audit(ctx, 'doc.upload', 'aramco_document', id, { sha256: stored.sha256, status });
  return getDocument(ctx, id);
}

export function getDocument(ctx, id) {
  const d = q.get(`SELECT d.*, lp.name loading_point_name, u.name approved_by_name, f.original_name FROM aramco_documents d
      LEFT JOIN loading_points lp ON lp.id = d.loading_point_id LEFT JOIN users u ON u.id = d.approved_by JOIN files f ON f.id = d.file_id
      WHERE d.id = ? AND d.company_id = ?`, id, ctx.companyId);
  if (!d) throw new HttpError(404, 'المستند غير موجود');
  const sameNumber = d.doc_number ? q.get("SELECT id FROM aramco_documents WHERE company_id = ? AND doc_number = ? AND status='approved' AND id <> ?", ctx.companyId, d.doc_number, d.id) : null;
  return { ...d, extraction: JSON.parse(d.extraction_json || '{}'), extraction_json: undefined, same_number_approved_id: sameNumber?.id ?? null,
    quantities: d.status === 'approved' ? documentQuantities(d.id) : null };
}

export function approveDocument(ctx, id, body) {
  return tx(() => {
    const d = q.get("SELECT * FROM aramco_documents WHERE id = ? AND company_id = ?", id, ctx.companyId);
    if (!d) throw new HttpError(404, 'المستند غير موجود');
    if (d.status === 'approved') throw new HttpError(409, 'المستند معتمد مسبقًا');
    const { doc_number, loading_point_id, product, quantity_liters, issue_date, expiry_date } = body;
    if (!doc_number || !loading_point_id || !product || !(Number(quantity_liters) > 0)) throw new HttpError(400, 'أكمل رقم المستند ونقطة التحميل والمنتج والكمية');
    if (!PRODUCTS[product]) throw new HttpError(400, 'منتج غير معروف');
    const existing = q.get("SELECT id FROM aramco_documents WHERE company_id = ? AND doc_number = ? AND status='approved'", ctx.companyId, doc_number);
    if (existing) throw new HttpError(409, 'هذا الرقم معتمد سابقًا. لتوزيعه على عدة رحلات اختر المستند المعتمد نفسه في كل طلب، ولا ترفعه مرة أخرى', { existing_id: existing.id });
    const version = q.get('SELECT COUNT(*) n FROM aramco_documents WHERE company_id = ? AND doc_number = ?', ctx.companyId, doc_number).n + 1;
    q.run(`UPDATE aramco_documents SET doc_number=?, loading_point_id=?, product=?, authorized_ml=?, issue_date=?, expiry_date=?, status='approved',
        approved_by=?, approved_at=?, version=? WHERE id = ?`, doc_number, loading_point_id, product, ML(quantity_liters), issue_date || null, expiry_date || null,
      ctx.userId, now(), version, id);
    const ext = JSON.parse(d.extraction_json || '{}');
    const changed = Object.entries({ doc_number, loading_point_id, product, quantity_liters: Number(quantity_liters) })
      .filter(([k, v]) => ext.fields?.[k] && ext.fields[k].value !== v).map(([k]) => k);
    audit(ctx, 'doc.approve', 'aramco_document', id, { doc_number, manual_overrides: changed });
    return getDocument(ctx, id);
  });
}

export function listDocuments(ctx) {
  return q.all(`SELECT d.id, d.doc_number, d.product, d.authorized_ml, d.status, d.created_at, d.approved_at, d.duplicate_of, d.expiry_date,
      lp.name loading_point_name, d.loading_point_id FROM aramco_documents d LEFT JOIN loading_points lp ON lp.id = d.loading_point_id
      WHERE d.company_id = ? ORDER BY d.created_at DESC`, ctx.companyId)
    .map((d) => ({ ...d, quantities: d.status === 'approved' ? documentQuantities(d.id) : null }))
    .map((d) => ({ ...d, quantities: d.quantities && { ...d.quantities, trips: undefined } }));
}

/** فحص صلاحية الوصول للملف وتسجيل الاطلاع */
export function authorizeFile(ctx, fileId, action = 'view') {
  const f = q.get('SELECT * FROM files WHERE id = ?', fileId);
  if (!f) throw new HttpError(404, 'الملف غير موجود');
  let ok = false;
  if (f.company_id === ctx.companyId && ctx.companyType === 'client') {
    ok = f.kind !== 'aramco_doc' || ctx.can('doc.view') || ctx.can('fueling.create');
  }
  if (ctx.can('platform.admin')) ok = true;
  if (!ok && f.kind === 'aramco_doc') {
    // الناقل/السائق يرى المستند بعد قبول الرحلة فقط
    const t = q.get(`SELECT t.carrier_id, t.driver_id, t.status FROM trips t JOIN orders o ON o.id = t.order_id JOIN aramco_documents d ON d.id = o.aramco_document_id
        WHERE d.file_id = ? AND (t.carrier_id = ? OR t.driver_id = ?) AND t.status NOT IN ('awaiting_acceptance','rejected','cancelled') LIMIT 1`, fileId, ctx.companyId, ctx.driverId || '-');
    ok = !!t && (ctx.can('carrier.dispatch') || (ctx.role === 'driver' && t.driver_id === ctx.driverId));
  }
  if (!ok && f.kind === 'trip_photo') {
    const t = q.get(`SELECT t.company_id, t.carrier_id, t.driver_id FROM trip_photos p JOIN trips t ON t.id = p.trip_id WHERE p.file_id = ?`, fileId);
    ok = !!t && (t.company_id === ctx.companyId || t.carrier_id === ctx.companyId);
  }
  if (!ok) throw new HttpError(404, 'الملف غير موجود');
  q.run('INSERT INTO file_access_log(file_id,user_id,company_id,action) VALUES (?,?,?,?)', f.id, ctx.userId, ctx.companyId, action);
  return { ...f, abs: path.join(UPLOAD_DIR, f.storage_path) };
}
