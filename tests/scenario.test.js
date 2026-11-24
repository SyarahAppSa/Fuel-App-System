// سيناريو العميل من البداية إلى النهاية (كما طلبه المالك) — عبر HTTP على قاعدة بيانات فعلية
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelapp-scn-'));
process.env.FUELAPP_DB = path.join(tmp, 'scn.db');
process.env.FUELAPP_UPLOADS = path.join(tmp, 'uploads');
const { openDb, q } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../server/seed.js');
const { makePng } = await import('../server/samples.js');

let server, base; const tok = {};
const S = {}; // حالة السيناريو بين الخطوات
before(async () => {
  openDb(); await seedDemo({ history: false });
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, e] of Object.entries({ client: 'client1@fuelapp.demo', carrier: 'carrier1@fuelapp.demo', driver: 'driver1@fuelapp.demo', sup: 'fuel1@fuelapp.demo', admin: 'admin@fuelapp.demo', other: 'client2@fuelapp.demo', otherSup: 'fuel2@fuelapp.demo' }))
    tok[k] = (await call('POST', '/auth/login', { email: e, password: DEMO_PASSWORD })).body.token;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
async function call(method, url, body, who, form, raw) {
  const headers = {}; if (who) headers.Authorization = 'Bearer ' + tok[who];
  let payload; if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  if (raw) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const ok = (r, m = '') => { assert.ok(r.status < 300, `${m} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const op = () => 'op_' + crypto.randomUUID();
const day = (n) => new Date(Date.now() + n * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);

test('1. العميل يضيف مشروعًا وموقعًا وخزانًا ومعدة', async () => {
  ok(await call('POST', '/projects', { code: 'PRJ-900', name: 'مشروع تجربة المالك', budget_liters: 50000 }, 'client'));
  S.project = q.get("SELECT id FROM projects WHERE code='PRJ-900'").id;
  S.site = ok(await call('POST', '/sites', { name: 'موقع التجربة', city: 'الرياض', project_id: S.project, receiver_name: 'مستلم التجربة', receiver_phone: '0500000000' }, 'client')).id;
  S.tank = ok(await call('POST', '/tanks', { site_id: S.site, code: 'TNK-90', name: 'خزان التجربة', product: 'diesel', capacity_liters: 40000, reorder_liters: 5000 }, 'client')).id;
  S.asset = ok(await call('POST', '/assets', { code: 'EX-900', name: 'حفار التجربة', category: 'heavy_equipment', fuel_type: 'diesel', plate_or_serial: 'SN-900', site_id: S.site, project_id: S.project, cost_center_id: 'cc_1', meter_type: 'hours', per_tx_limit_liters: 600, daily_limit_liters: 1200 }, 'client')).id;
  assert.equal(ok(await call('GET', '/tanks/' + S.tank, undefined, 'client')).balance.book_ml, 0);
});

test('2. اختيار ناقل بسعر واضح، رفع PDF، وإرسال طلب 20,000 لتر', async () => {
  const pdf = await call('GET', '/demo/sample-aramco.pdf?liters=20000', undefined, 'client', null, true);
  assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 4).toString(), '%PDF');
  const fd = new FormData(); fd.append('file', new Blob([pdf.buf], { type: 'application/pdf' }), 'aramco.pdf');
  const doc = ok(await call('POST', '/documents', undefined, 'client', fd));
  assert.equal(doc.authorized_ml, 20_000_000); assert.equal(doc.product, 'diesel'); assert.ok(doc.doc_number.startsWith('SA-DEMO-'));
  ok(await call('POST', `/documents/${doc.id}/approve`, { doc_number: doc.doc_number, loading_point_id: doc.loading_point_id, product: 'diesel', quantity_liters: 20000 }, 'client'));
  const offers = ok(await call('GET', `/market/search?loading_point_id=lp_ryd&city=${encodeURIComponent('الرياض')}&product=diesel&quantity_liters=20000&date=${day(1)}`, undefined, 'client'));
  const o = offers.find((x) => x.carrier_id === 'co_car1');
  assert.ok(o.available);
  assert.equal(o.quote.base_halalas, 145000); // 1,450 ر.س أجرة ثابتة للمسار
  assert.equal(o.quote.total_halalas, o.quote.base_halalas + o.quote.platform_fee_halalas + o.quote.vat_halalas);
  const r = ok(await call('POST', '/orders', { route_price_id: o.route_price_id, aramco_document_id: doc.id, date: day(1), fuel_price_per_liter: 1.66,
    stops: [{ site_id: S.site, mode: 'tank', tank_id: S.tank, quantity_liters: 20000 }] }, 'client'));
  Object.assign(S, { trip: r.trip_id, order: r.order_number, tripNo: r.trip_number, doc: doc.doc_number });
});

test('3. الناقل يقبل ويسند سائقًا وصهريجًا', async () => {
  ok(await call('POST', `/carrier/trips/${S.trip}/accept`, {}, 'carrier'));
  const c = ok(await call('GET', `/carrier/trips/${S.trip}/candidates`, undefined, 'carrier'));
  assert.ok(c.vehicles.find((v) => v.id === 'veh_1').eligible);
  ok(await call('POST', `/carrier/trips/${S.trip}/assign`, { vehicle_id: 'veh_1', driver_id: 'drv_1' }, 'carrier'));
});

test('4. السائق يوثق الرحلة بالصور الأربع', async () => {
  const photo = async (kind, stop) => { const fd = new FormData(); fd.append('photo', new Blob([makePng(60, 40)], { type: 'image/png' }), kind + '.png'); fd.append('kind', kind); if (stop) fd.append('stop_id', stop); fd.append('client_op_id', op()); return ok(await call('POST', `/driver/trips/${S.trip}/photos`, undefined, 'driver', fd), kind); };
  for (const to of ['to_loading', 'at_loading']) ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to, client_op_id: op() }, 'driver'));
  await photo('before_loading');
  ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to: 'loaded', loaded_liters: 20000, client_op_id: op() }, 'driver'));
  await photo('after_loading');
  ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to: 'to_delivery', client_op_id: op() }, 'driver'));
  const arr = ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to: 'at_site', client_op_id: op() }, 'driver'));
  S.stop = arr.stop_id;
  await photo('before_unloading', S.stop);
  ok(await call('POST', `/driver/trips/${S.trip}/stops/${S.stop}/deliver`, { delivered_liters: 20000, client_op_id: op() }, 'driver'));
  await photo('after_unloading', S.stop);
  const t = ok(await call('GET', '/trips/' + S.trip, undefined, 'client'));
  assert.equal(t.photos.length, 4); assert.deepEqual(t.missing_proofs, []); assert.equal(t.status, 'delivered');
});

test('5. مستلم الموقع يؤكد الكمية (رابط محدود) ← 20,000 في الخزان', async () => {
  const token = q.get('SELECT receipt_token FROM trip_stops WHERE id = ?', S.stop).receipt_token;
  const view = ok(await call('GET', '/public/receipt/' + token));
  assert.equal(view.delivered_ml, 20_000_000);
  ok(await call('POST', '/public/receipt/' + token, { ack: 'confirmed', name: 'مستلم التجربة', note: 'مطابق' }));
  assert.equal(ok(await call('GET', '/tanks/' + S.tank, undefined, 'client')).balance.book_ml, 20_000_000);
  assert.equal(ok(await call('GET', '/trips/' + S.trip, undefined, 'client')).status, 'closed');
});

test('6. ربط شريحة NFC بالمعدة وتعبئة 200 لتر ← الخزان 19,800 والتقرير يتتبع المصدر', async () => {
  ok(await call('POST', '/nfc-tags/bind', { uid: '04A1B2C3D4E512', asset_id: S.asset, asset_code_confirm: 'EX-900', test_read_ok: true }, 'sup'));
  const auth = ok(await call('POST', '/fuelings/authorize', { uid: '04A1B2C3D4E512', source_type: 'tank', source_id: S.tank }, 'sup'));
  assert.equal(auth.asset.code, 'EX-900');
  S.fuelBody = { client_op_id: op(), uid: '04A1B2C3D4E512', verification: 'nfc', source_type: 'tank', source_id: S.tank, quantity_liters: 200, meter_value: 1250 };
  const f = ok(await call('POST', '/fuelings', S.fuelBody, 'sup')); S.fueling = f.id;
  assert.equal(ok(await call('GET', '/tanks/' + S.tank, undefined, 'client')).balance.book_ml, 19_800_000);
  const rep = ok(await call('GET', '/reports/asset/' + S.asset, undefined, 'client'));
  const row = rep.rows.find((r) => r.id === f.id);
  assert.equal(row.quantity_ml, 200_000);
  assert.equal(row.operator_name, 'أحمد الغامدي');
  assert.equal(row.project_code, 'PRJ-900');
  assert.equal(row.cost_halalas, Math.round(200 * (166 + 145000 / 20000))); // وقود 1.66 + نصيب أجرة النقل 7.25 هللة/لتر
  const chain = row.source_chain.find((c) => c.trip_id);
  assert.equal(chain.trip_id, S.trip); assert.equal(chain.trip_number, S.tripNo); assert.equal(chain.order_number, S.order); assert.equal(chain.doc_number, S.doc);
  // من شاشة العملية: الخزان ← الرحلة ← الطلب الأصلي
  const detail = ok(await call('GET', '/fuelings/' + f.id, undefined, 'client'));
  assert.equal(detail.tank_id, S.tank); assert.equal(detail.source_chain[0].order_number, S.order);
  const trip = ok(await call('GET', '/trips/' + chain.trip_id, undefined, 'client'));
  assert.equal(trip.order_number, S.order); assert.equal(trip.order_created_by, 'م. عبدالرحمن الراشد');
});

test('7. تقرير الرحلة PDF وسجل التزويد Excel ولوحة الشركة', async () => {
  const html = ok(await call('GET', `/trips/${S.trip}/report`, undefined, 'client'));
  for (const s of [S.tripNo, S.order, S.doc, 'قبل التحميل', 'بعد التفريغ', 'مؤكد', 'محمد القحطاني']) assert.ok(html.includes(s), s);
  const x = await call('GET', `/reports/fuelings.xlsx?asset_id=${S.asset}`, undefined, 'client', null, true);
  assert.equal(x.status, 200); assert.match(x.type, /spreadsheetml/); assert.equal(x.buf.subarray(0, 2).toString(), 'PK');
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf);
  const ws = wb.worksheets[0]; const vals = ws.getRow(2).values.map(String);
  assert.ok(vals.includes('EX-900') && vals.includes('200') && vals.includes(S.tripNo) && vals.includes(S.order));
  const d = ok(await call('GET', '/dashboard?project_id=' + S.project, undefined, 'client'));
  assert.equal(d.issued_ml, 200_000); assert.equal(d.received_ml, 20_000_000);
  const drill = ok(await call('GET', '/fuelings?project_id=' + S.project, undefined, 'client'));
  assert.equal(drill.length, 1); assert.equal(drill[0].id, S.fueling);
});

test('8. الشركة الثانية لا ترى بيانات الأولى، وإعادة إرسال التزويد لا تخصم مرتين', async () => {
  const file = q.get("SELECT file_id FROM aramco_documents WHERE doc_number = ?", S.doc).file_id;
  for (const u of [`/assets/${S.asset}`, `/reports/asset/${S.asset}`, `/fuelings/${S.fueling}`, `/trips/${S.trip}`, `/tanks/${S.tank}`, `/files/${file}`, `/trips/${S.trip}/report`])
    assert.equal((await call('GET', u, undefined, 'other')).status, 404, u);
  const x = await call('GET', '/reports/fuelings.xlsx', undefined, 'other', null, true);
  assert.ok(!x.buf.toString('latin1').includes('EX-900'));
  assert.equal((await call('POST', '/fuelings/authorize', { uid: '04A1B2C3D4E512', source_type: 'tank', source_id: S.tank }, 'otherSup')).status, 404);
  for (let i = 0; i < 3; i++) { const r = ok(await call('POST', '/fuelings', S.fuelBody, 'sup')); assert.equal(r.id, S.fueling); assert.equal(r.duplicate, true); }
  const both = await Promise.all([call('POST', '/fuelings', S.fuelBody, 'sup'), call('POST', '/fuelings', { ...S.fuelBody, offline: true }, 'sup')]);
  assert.ok(both.every((r) => r.body.id === S.fueling));
  assert.equal(ok(await call('GET', '/tanks/' + S.tank, undefined, 'client')).balance.book_ml, 19_800_000);
  assert.equal(q.get('SELECT COUNT(*) n FROM fuelings WHERE client_op_id = ?', S.fuelBody.client_op_id).n, 1);
});
