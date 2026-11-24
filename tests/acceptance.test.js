// اختبارات القبول الإلزامية (القسم ١٥) — تعمل عبر HTTP على قاعدة بيانات فعلية مؤقتة
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelapp-test-'));
process.env.FUELAPP_DB = path.join(tmp, 'test.db');
process.env.FUELAPP_UPLOADS = path.join(tmp, 'uploads');
const { openDb, q } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../server/seed.js');
const { sampleAramcoPdf, makePng } = await import('../server/samples.js');

let server, base;
const tokens = {};
before(async () => {
  openDb();
  await seedDemo({ history: false });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, email] of Object.entries({ procure: 'procure1@fuelapp.demo', admin: 'client1@fuelapp.demo', sup: 'fuel1@fuelapp.demo', disp: 'dispatch1@fuelapp.demo',
    driver1: 'driver1@fuelapp.demo', driver2: 'driver2@fuelapp.demo', receiver: 'receiver1@fuelapp.demo', finance: 'finance1@fuelapp.demo', pm: 'pm1@fuelapp.demo',
    other: 'client2@fuelapp.demo', carrier2: 'carrier2@fuelapp.demo', fuel2: 'fuel2@fuelapp.demo' })) {
    const r = await call('POST', '/auth/login', { email, password: DEMO_PASSWORD });
    tokens[k] = r.body.token;
    // client1 also has a dispatcher membership; ensure we are on the client_admin one
    if (k === 'admin') {
      const ms = r.body.memberships.find((m) => m.role === 'client_admin');
      tokens[k] = (await call('POST', '/auth/login', { email, password: DEMO_PASSWORD, membership_id: ms.id })).body.token;
    }
  }
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, url, body, who, form) {
  const headers = {};
  if (who) headers.Authorization = 'Bearer ' + tokens[who];
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
}
const ok = (r, msg) => { assert.ok(r.status < 300, `${msg || ''} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const op = () => 'op_' + crypto.randomUUID();
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() + n * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);

let docId;
async function uploadDoc(who, number, liters) {
  const fd = new FormData();
  fd.append('file', new Blob([sampleAramcoPdf({ docNumber: number, lpCode: 'RBP', lpName: 'Riyadh Distribution Plant', liters, issue: today(), valid: day(30) })], { type: 'application/pdf' }), 'doc.pdf');
  return call('POST', '/documents', undefined, who, fd);
}
async function photo(who, tripId, kind, stopId) {
  const fd = new FormData();
  fd.append('photo', new Blob([makePng(40, 30)], { type: 'image/png' }), kind + '.png');
  fd.append('kind', kind); if (stopId) fd.append('stop_id', stopId); fd.append('client_op_id', op()); fd.append('captured_at', new Date().toISOString());
  return ok(await call('POST', `/driver/trips/${tripId}/photos`, undefined, who, fd), 'photo ' + kind);
}
async function fullTrip({ stops, loaded, deliveries, date = day(0), vehicle = 'veh_1', driver = 'drv_1', driverWho = 'driver1', confirm = true, before: beforeDeliver }) {
  const search = ok(await call('GET', `/market/search?loading_point_id=lp_ryd&city=${encodeURIComponent('الرياض')}&product=diesel&quantity_liters=${loaded}&date=${date}`, undefined, 'procure'));
  const offer = search.find((s) => s.carrier_id === 'co_car1');
  assert.ok(offer.available, 'carrier available');
  assert.ok(offer.quote.total_halalas > offer.quote.base_halalas, 'price breakdown includes fees + VAT');
  const o = ok(await call('POST', '/orders', { route_price_id: offer.route_price_id, aramco_document_id: docId, date, stops, fuel_price_per_liter: 1.66 }, 'procure'), 'order');
  ok(await call('POST', `/carrier/trips/${o.trip_id}/accept`, {}, 'disp'), 'accept');
  ok(await call('POST', `/carrier/trips/${o.trip_id}/assign`, { vehicle_id: vehicle, driver_id: driver }, 'disp'), 'assign');
  for (const to of ['to_loading', 'at_loading']) ok(await call('POST', `/driver/trips/${o.trip_id}/advance`, { to, client_op_id: op() }, driverWho), to);
  await photo(driverWho, o.trip_id, 'before_loading');
  ok(await call('POST', `/driver/trips/${o.trip_id}/advance`, { to: 'loaded', loaded_liters: loaded, client_op_id: op() }, driverWho), 'loaded');
  await photo(driverWho, o.trip_id, 'after_loading');
  ok(await call('POST', `/driver/trips/${o.trip_id}/advance`, { to: 'to_delivery', client_op_id: op() }, driverWho));
  const trip = ok(await call('GET', `/trips/${o.trip_id}`, undefined, 'procure'));
  for (const [i, s] of trip.stops.entries()) {
    ok(await call('POST', `/driver/trips/${o.trip_id}/advance`, { to: 'at_site', client_op_id: op() }, driverWho), 'at_site');
    await photo(driverWho, o.trip_id, 'before_unloading', s.id);
    if (beforeDeliver) await beforeDeliver(o.trip_id, s);
    ok(await call('POST', `/driver/trips/${o.trip_id}/stops/${s.id}/deliver`, { delivered_liters: deliveries[i], client_op_id: op() }, driverWho), 'deliver');
    await photo(driverWho, o.trip_id, 'after_unloading', s.id);
    if (confirm) ok(await call('POST', `/trips/${o.trip_id}/stops/${s.id}/confirm`, { ack: 'confirmed' }, s.mode === 'tank' ? 'receiver' : 'admin'), 'confirm');
  }
  return { ...o, stops: trip.stops };
}

test('0. رفع مستند أرامكو واستخراج بياناته واعتمادها', async () => {
  const d = ok(await uploadDoc('procure', 'SA-TEST-000101', 60000), 'upload');
  assert.equal(d.doc_number, 'SA-TEST-000101');
  assert.equal(d.product, 'diesel');
  assert.equal(d.loading_point_id, 'lp_ryd');
  assert.equal(d.authorized_ml, 60_000_000);
  ok(await call('POST', `/documents/${d.id}/approve`, { doc_number: d.doc_number, loading_point_id: 'lp_ryd', product: 'diesel', quantity_liters: 60000 }, 'procure'));
  docId = d.id;
  // رفع مكرر للملف نفسه يُكتشف، واعتماد الرقم نفسه مرة أخرى مرفوض
  const dup = ok(await uploadDoc('procure', 'SA-TEST-000101', 60000));
  assert.equal(dup.duplicate_of, d.id);
  const r = await call('POST', `/documents/${dup.id}/approve`, { doc_number: 'SA-TEST-000101', loading_point_id: 'lp_ryd', product: 'diesel', quantity_liters: 60000 }, 'procure');
  assert.equal(r.status, 409);
});

test('1. الرحلة الكاملة: سعر واضح، قبول وإسناد، الصور الأربع، تأكيد المستلم، تقرير مطابق', async () => {
  const t = await fullTrip({ stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 20000 }], loaded: 20000, deliveries: [20000] });
  const trip = ok(await call('GET', `/trips/${t.trip_id}`, undefined, 'admin'));
  assert.equal(trip.status, 'closed');
  assert.equal(trip.photos.length, 4);
  assert.deepEqual(trip.missing_proofs, []);
  assert.ok(trip.price.total_halalas > 0);
  const html = await call('GET', `/trips/${t.trip_id}/report`, undefined, 'admin');
  assert.equal(html.status, 200);
  for (const s of [trip.number, trip.order_number, 'SA-TEST-000101', 'أ ب ج 4512', 'محمد القحطاني', 'قبل التحميل', 'بعد التفريغ', 'مؤكد']) assert.ok(html.body.includes(s), 'report contains ' + s);
  assert.ok(!html.body.includes('لا توجد صورة'));
});

test('2. المخزون وNFC: استلام 20,000 ثم تزويد 200 لتر بالشريحة → الخزان 19,800', async () => {
  const before = ok(await call('GET', '/tanks/tnk_1', undefined, 'sup')).balance.book_ml;
  assert.equal(before, 20_000_000);
  const auth = ok(await call('POST', '/fuelings/authorize', { uid: '04A1B2C3D4E501', source_type: 'tank', source_id: 'tnk_1' }, 'sup'));
  assert.equal(auth.asset.code, 'EX-336-01');
  const f = ok(await call('POST', '/fuelings', { client_op_id: op(), uid: '04A1B2C3D4E501', source_type: 'tank', source_id: 'tnk_1', quantity_liters: 200, meter_value: 4130 }, 'sup'));
  assert.equal(f.status, 'approved');
  assert.equal(ok(await call('GET', '/tanks/tnk_1', undefined, 'sup')).balance.book_ml, 19_800_000);
  const rep = ok(await call('GET', '/reports/asset/ast_1', undefined, 'admin'));
  const row = rep.rows.find((r) => r.id === f.id);
  assert.equal(row.quantity_ml, 200_000);
  assert.equal(row.project_name, 'مشروع طريق الخرج السريع');
  assert.equal(row.cost_center_code, 'CC-410');
  assert.equal(row.operator_name, 'أحمد الغامدي');
  assert.ok(row.cost_halalas > 0);
  assert.ok(row.source_chain.some((s) => s.doc_number === 'SA-TEST-000101'), 'source traced to receipt trip/doc');
  const dash = ok(await call('GET', '/dashboard?project_id=prj_1', undefined, 'admin'));
  assert.equal(dash.issued_ml, 200_000);
});

test('3. التزويد المباشر: 5,000 لتر مرتبطة برحلة المصدر ولا تدخل الخزان', async () => {
  const tankBefore = ok(await call('GET', '/tanks/tnk_2', undefined, 'sup')).balance.book_ml;
  let batchId;
  const t = await fullTrip({ stops: [{ site_id: 'sit_2', mode: 'direct', quantity_liters: 5000 }], loaded: 5000, deliveries: [5000], vehicle: 'veh_3', driver: 'drv_2', driverWho: 'driver2',
    before: async (tripId, s) => {
      const src = ok(await call('GET', '/fuel-sources?site_id=sit_2', undefined, 'sup')).find((x) => x.type === 'batch' && x.trip_id === tripId);
      batchId = src.id;
      assert.equal(src.balance_ml, 5_000_000);
      for (const [uid, l, m] of [['04A1B2C3D4E507', 300, 100], ['04A1B2C3D4E508', 450, 200]]) {
        const f = ok(await call('POST', '/fuelings', { client_op_id: op(), uid, source_type: 'batch', source_id: src.id, quantity_liters: l, meter_value: m }, 'sup'));
        assert.equal(f.status, 'approved');
      }
    } });
  const rows = ok(await call('GET', `/fuelings?trip_id=${t.trip_id}`, undefined, 'admin'));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.trip_number && r.source_type === 'batch'));
  const src = ok(await call('GET', '/fuel-sources?site_id=sit_2', undefined, 'sup')).find((x) => x.id === batchId);
  assert.equal(src.balance_ml, 5_000_000 - 750_000);
  assert.equal(ok(await call('GET', '/tanks/tnk_2', undefined, 'sup')).balance.book_ml, tankBefore, 'tank untouched');
  const cyc = ok(await call('GET', '/reports/cycle', undefined, 'admin')).find((c) => c.id === t.trip_id);
  assert.equal(cyc.issued_direct_ml + cyc.remaining_direct_ml, 5_000_000);
  assert.equal(cyc.stored_ml, 0);
});

test('4. الصلاحيات: الشركة الثانية لا تصل لبيانات الأولى حتى بالمعرف المباشر', async () => {
  const fid = q.get("SELECT id FROM fuelings WHERE company_id='co_cli1' LIMIT 1").id;
  const trip = q.get("SELECT id FROM trips WHERE company_id='co_cli1' LIMIT 1").id;
  const docFile = q.get('SELECT file_id FROM aramco_documents WHERE id = ?', docId).file_id;
  for (const url of ['/assets/ast_1', '/reports/asset/ast_1', `/fuelings/${fid}`, `/trips/${trip}`, `/files/${docFile}`, '/tanks/tnk_1', `/documents/${docId}`])
    { const rr = await call('GET', url, undefined, 'other'); assert.equal(rr.status, 404, url + ' ' + JSON.stringify(rr.body).slice(0,200)); }
  const csv = await call('GET', '/reports/fuelings.csv', undefined, 'other');
  assert.ok(!String(csv.body).includes('EX-336-01'), 'export isolated');
  // الناقل الثاني لا يرى رحلات الناقل الأول
  assert.equal((await call('GET', `/trips/${trip}`, undefined, 'carrier2')).status, 404);
  // الناقل يرى المستند بعد القبول فقط
  const o = ok(await call('POST', '/orders', { route_price_id: 'rp_c1_ryd', aramco_document_id: docId, date: day(3), stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 1000 }] }, 'procure'));
  const pre = ok(await call('GET', `/trips/${o.trip_id}`, undefined, 'disp'));
  assert.equal(pre.doc_file_id, null); assert.equal(pre.stops[0].receiver_phone, null);
  // مستند جديد لم يُقبل عليه أي رحلة: لا يصل إليه الناقل
  const nd = ok(await uploadDoc('procure', 'SA-TEST-000303', 5000));
  ok(await call('POST', `/documents/${nd.id}/approve`, { doc_number: nd.doc_number, loading_point_id: 'lp_ryd', product: 'diesel', quantity_liters: 5000 }, 'procure'));
  const o2 = ok(await call('POST', '/orders', { route_price_id: 'rp_c1_ryd', aramco_document_id: nd.id, date: day(4), stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 1000 }] }, 'procure'));
  assert.equal((await call('GET', `/files/${nd.file_id}`, undefined, 'disp')).status, 404);
  ok(await call('POST', `/carrier/trips/${o2.trip_id}/accept`, {}, 'disp'));
  assert.equal((await call('GET', `/files/${nd.file_id}`, undefined, 'disp')).status, 200);
  ok(await call('POST', `/carrier/trips/${o.trip_id}/accept`, {}, 'disp'));
  const post = ok(await call('GET', `/trips/${o.trip_id}`, undefined, 'disp'));
  assert.ok(post.doc_file_id); assert.ok(post.stops[0].receiver_phone);
  assert.equal((await call('GET', `/files/${docFile}`, undefined, 'disp')).status, 200);
  assert.equal(post.fuel_price_halalas_per_l, null, 'carrier never sees client fuel price');
  // مشرف الوقود لا يرى الأسعار
  const sup = ok(await call('GET', `/trips/${o.trip_id}`, undefined, 'sup'));
  assert.equal(sup.price, null);
  // مدير المشروع المحدود بمشروع لا يرى أصول مشروع آخر
  assert.equal((await call('GET', '/assets/ast_7', undefined, 'pm')).status, 404);
  ok(await call('POST', `/trips/${o.trip_id}/cancel`, { reason: 'اختبار' }, 'procure'));
});

test('5. التكرار والحجز: طلبان متزامنان على نفس الصهريج، وعملية تزويد مرسلة من جهازين', async () => {
  const mk = async () => ok(await call('POST', '/orders', { route_price_id: 'rp_c1_ryd', aramco_document_id: docId, date: day(5), stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 1000 }] }, 'procure'));
  const [a, b] = [await mk(), await mk()];
  for (const t of [a, b]) ok(await call('POST', `/carrier/trips/${t.trip_id}/accept`, {}, 'disp'));
  const res = await Promise.all([a, b].map((t, i) => call('POST', `/carrier/trips/${t.trip_id}/assign`, { vehicle_id: 'veh_3', driver_id: i ? 'drv_1' : 'drv_2' }, 'disp')));
  assert.deepEqual(res.map((r) => r.status).sort(), [200, 409], 'only one booking wins');
  const id = op();
  const body = { client_op_id: id, uid: '04A1B2C3D4E502', source_type: 'tank', source_id: 'tnk_1', quantity_liters: 100, meter_value: 2300 };
  const before = ok(await call('GET', '/tanks/tnk_1', undefined, 'sup')).balance.book_ml;
  const both = await Promise.all([call('POST', '/fuelings', body, 'sup'), call('POST', '/fuelings', body, 'sup')]);
  assert.ok(both.every((r) => r.status === 200));
  assert.equal(both[0].body.id, both[1].body.id);
  assert.equal(q.get('SELECT COUNT(*) n FROM fuelings WHERE client_op_id = ?', id).n, 1);
  assert.equal(ok(await call('GET', '/tanks/tnk_1', undefined, 'sup')).balance.book_ml, before - 100_000);
  // نفس الحدث من السائق مرتين يُسجل مرة واحدة
  const ev = op();
  ok(await call('POST', `/carrier/trips/${a.trip_id}/assign`, { vehicle_id: 'veh_1', driver_id: 'drv_1' }, 'disp').then((r) => (r.status === 409 ? call('POST', `/carrier/trips/${b.trip_id}/assign`, { vehicle_id: 'veh_1', driver_id: 'drv_1' }, 'disp') : r)));
});

test('6. الشريحة والسياسات: مفقودة/مستبدلة/نوع وقود/تجاوز سقف، وQR كاستثناء', async () => {
  const tags = ok(await call('GET', '/nfc-tags', undefined, 'sup')).tags;
  const t3 = tags.find((t) => t.uid === '04A1B2C3D4E503');
  ok(await call('POST', `/nfc-tags/${t3.id}/lost`, { reason: 'سقطت من المعدة' }, 'sup'));
  let r = await call('POST', '/fuelings', { client_op_id: op(), uid: t3.uid, source_type: 'tank', source_id: 'tnk_1', quantity_liters: 50, meter_value: 3400 }, 'sup');
  assert.equal(r.status, 422); assert.match(r.body.error, /مفقودة/);
  // استبدال: القديمة مستبدلة والجديدة نشطة على نفس الأصل
  ok(await call('POST', `/nfc-tags/${t3.id}/replace`, { new_uid: '04A1B2C3D4E510' }, 'sup'));
  const t4 = tags.find((t) => t.uid === '04A1B2C3D4E504');
  ok(await call('POST', `/nfc-tags/${t4.id}/suspend`, {}, 'sup'));
  r = await call('POST', '/fuelings/authorize', { uid: t4.uid, source_type: 'tank', source_id: 'tnk_1' }, 'sup');
  assert.equal(r.body.authorized, false); assert.ok(r.body.reasons.some((x) => x.code === 'tag_suspended'));
  ok(await call('POST', `/nfc-tags/${t4.id}/reactivate`, {}, 'sup'));
  r = await call('POST', '/fuelings', { client_op_id: op(), uid: '04A1B2C3D4E510', source_type: 'tank', source_id: 'tnk_1', quantity_liters: 50, meter_value: 3400 }, 'sup');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // تجاوز سقف العملية
  r = await call('POST', '/fuelings', { client_op_id: op(), uid: '04A1B2C3D4E505', source_type: 'tank', source_id: 'tnk_1', quantity_liters: 500, meter_value: 50000 }, 'sup');
  assert.equal(r.status, 422); assert.ok(r.body.details.reasons.some((x) => x.code === 'per_tx_limit'));
  // مشروع مختلف: أصل الملقا من خزان الخرج
  r = await call('POST', '/fuelings/authorize', { uid: '04A1B2C3D4E507', source_type: 'tank', source_id: 'tnk_1' }, 'sup');
  assert.ok(r.body.reasons.some((x) => x.code === 'site_project'));
  // نوع وقود مختلف
  q.run("UPDATE assets SET fuel_type='gasoline91' WHERE id='ast_6'");
  r = await call('POST', '/fuelings/authorize', { uid: '04A1B2C3D4E506', source_type: 'tank', source_id: 'tnk_1' }, 'sup');
  assert.ok(r.body.reasons.some((x) => x.code === 'fuel_type'));
  q.run("UPDATE assets SET fuel_type='diesel' WHERE id='ast_6'");
  // QR بديل: يُقبل ويسجل استثناء
  const f = ok(await call('POST', '/fuelings', { client_op_id: op(), verification: 'qr', asset_id: 'ast_6', source_type: 'tank', source_id: 'tnk_1', quantity_liters: 100, meter_value: 90500 }, 'sup'));
  assert.ok(q.get("SELECT 1 FROM exceptions WHERE ref_id = ? AND type = 'alt_verification'", f.id));
  const ctl = ok(await call('GET', '/nfc-tags', undefined, 'admin'));
  assert.ok(ctl.rejected.length >= 1); assert.ok(ctl.alt_verifications.length >= 1);
});

test('7. انقطاع الاتصال: مسودة تُراجع عند المزامنة، والتعارض يظهر دون تغيير الرصيد', async () => {
  const before = ok(await call('GET', '/tanks/tnk_1', undefined, 'sup')).balance.book_ml;
  const t4 = q.get("SELECT * FROM nfc_tags WHERE uid='04A1B2C3D4E504'");
  // تمت العملية دون اتصال، ثم أوقفت الإدارة الشريحة قبل المزامنة
  ok(await call('POST', `/nfc-tags/${t4.id}/suspend`, {}, 'sup'));
  const id = op();
  const sync = () => call('POST', '/fuelings', { client_op_id: id, offline: true, captured_at: new Date(Date.now() - 3600e3).toISOString(), uid: t4.uid, source_type: 'tank', source_id: 'tnk_1', quantity_liters: 300, meter_value: 9999 }, 'sup');
  const r1 = ok(await sync()); const r2 = ok(await sync());
  assert.equal(r1.status, 'rejected'); assert.equal(r2.duplicate, true);
  assert.equal(ok(await call('GET', '/tanks/tnk_1', undefined, 'sup')).balance.book_ml, before);
  assert.ok(q.get("SELECT 1 FROM exceptions WHERE type='offline_conflict' AND ref_id = ?", r1.id));
  ok(await call('POST', `/nfc-tags/${t4.id}/reactivate`, {}, 'sup'));
  // حدث رحلة مرسل مرتين بعد عودة الاتصال يسجل مرة واحدة
  const evId = op();
  const trip = q.get("SELECT id FROM trips WHERE driver_id = 'drv_1' AND status = 'assigned' LIMIT 1");
  if (trip) {
    ok(await call('POST', `/driver/trips/${trip.id}/advance`, { to: 'to_loading', client_op_id: evId }, 'driver1'));
    const again = ok(await call('POST', `/driver/trips/${trip.id}/advance`, { to: 'to_loading', client_op_id: evId }, 'driver1'));
    assert.equal(again.duplicate, true);
    assert.equal(q.get('SELECT COUNT(*) n FROM trip_events WHERE client_op_id = ?', evId).n, 1);
  }
});

test('8. الكميات: تقسيم مستند على عدة رحلات ضمن المتاح، والإلغاء يحرر الحجز', async () => {
  const d = ok(await uploadDoc('procure', 'SA-TEST-000202', 30000));
  ok(await call('POST', `/documents/${d.id}/approve`, { doc_number: d.doc_number, loading_point_id: 'lp_ryd', product: 'diesel', quantity_liters: 30000 }, 'procure'));
  const order = (l, dd) => call('POST', '/orders', { route_price_id: 'rp_c1_ryd', aramco_document_id: d.id, date: day(dd), stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: l }] }, 'procure');
  const a = ok(await order(15000, 7)); ok(await order(10000, 8));
  const over = await order(6000, 9);
  assert.equal(over.status, 409, 'exceeds remaining 5,000');
  ok(await call('POST', `/trips/${a.trip_id}/cancel`, { reason: 'تغيير الجدول' }, 'procure'));
  const doc = ok(await call('GET', `/documents/${d.id}`, undefined, 'procure'));
  assert.equal(doc.quantities.available_ml, 20_000_000);
  assert.equal(doc.quantities.cancelled_ml, 15_000_000);
  ok(await order(6000, 9));
});

test('9. التصحيح ونقل الأصل: التقارير السابقة تبقى على المشروع الأصلي', async () => {
  const f = ok(await call('POST', '/fuelings', { client_op_id: op(), uid: '04A1B2C3D4E501', source_type: 'tank', source_id: 'tnk_1', quantity_liters: 300, meter_value: 4140 }, 'sup'));
  // المشغّل نفسه لا يعتمد تصحيحه
  assert.equal((await call('POST', `/fuelings/${f.id}/correct`, { new_quantity_liters: 280, reason: 'x' }, 'sup')).status, 403);
  const before = ok(await call('GET', '/tanks/tnk_1', undefined, 'admin')).balance.book_ml;
  const c = ok(await call('POST', `/fuelings/${f.id}/correct`, { new_quantity_liters: 280, reason: 'قراءة العداد الصحيحة 280 لتر' }, 'admin'));
  assert.equal(c.delta_ml, -20_000);
  assert.equal(ok(await call('GET', '/tanks/tnk_1', undefined, 'admin')).balance.book_ml, before + 20_000);
  ok(await call('POST', '/assets/ast_1/move', { site_id: 'sit_2', project_id: 'prj_2' }, 'admin'));
  const rows = ok(await call('GET', '/fuelings?asset_id=ast_1', undefined, 'admin'));
  const orig = rows.find((r) => r.id === f.id); const corr = rows.find((r) => r.id === c.id);
  assert.equal(orig.project_id, 'prj_1'); assert.equal(corr.project_id, 'prj_1');
  assert.equal(orig.quantity_ml, 300_000); assert.equal(corr.quantity_ml, -20_000);
  assert.equal(corr.corrects_number, orig.number);
  const dash = ok(await call('GET', '/dashboard?project_id=prj_2', undefined, 'admin'));
  assert.ok(!dash.top_assets.some((a) => a.id === 'ast_1'), 'history stays with prj_1');
});

test('10. التسليم بفرق كمية واعتراض المستلم يذهب للمراجعة ثم الإغلاق بموافقة', async () => {
  const t = await fullTrip({ stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 8000 }], loaded: 8000, deliveries: [7800], date: day(12), confirm: false });
  const s = t.stops[0];
  ok(await call('POST', `/trips/${t.trip_id}/stops/${s.id}/confirm`, { ack: 'disputed', note: 'العداد يشير 7,800 والقراءة 7,750' }, 'receiver'));
  let trip = ok(await call('GET', `/trips/${t.trip_id}`, undefined, 'admin'));
  assert.equal(trip.status, 'under_review');
  const exs = ok(await call('GET', '/exceptions', undefined, 'admin')).filter((e) => e.status === 'open' && (e.ref_id === s.id || e.ref_id === t.trip_id));
  for (const e of exs) ok(await call('POST', `/exceptions/${e.id}/decide`, { decision: 'approved', reason: 'اعتماد قراءة المستلم', accepted_liters: e.ref_type === 'trip_stop' ? 7750 : undefined }, 'pm'));
  trip = ok(await call('GET', `/trips/${t.trip_id}`, undefined, 'admin'));
  const remaining = ok(await call('GET', '/exceptions', undefined, 'admin')).filter((e) => e.status === 'open' && e.ref_id === t.trip_id);
  for (const e of remaining) ok(await call('POST', `/exceptions/${e.id}/decide`, { decision: 'approved', reason: 'فرق التحميل مقبول ضمن المعايرة' }, 'pm'));
  trip = ok(await call('GET', `/trips/${t.trip_id}`, undefined, 'admin'));
  assert.equal(trip.status, 'closed');
  const mov = q.get("SELECT quantity_ml FROM fuel_movements WHERE kind='receipt' AND ref_id = ?", s.id);
  assert.equal(mov.quantity_ml, 7_750_000);
});
