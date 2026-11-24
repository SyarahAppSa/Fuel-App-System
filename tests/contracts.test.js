// العقود الشهرية والسنوية، باقات الرحلات، وحجز السعة — على نفس الطلب والرحلة
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelapp-con-'));
process.env.FUELAPP_DB = path.join(tmp, 'c.db');
process.env.FUELAPP_UPLOADS = path.join(tmp, 'uploads');
const { openDb, q } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../server/seed.js');
const { sampleAramcoPdf } = await import('../server/samples.js');
const K = await import('../server/services/contracts.js');

let server, base; const tok = {}; const S = {};
before(async () => {
  openDb(); await seedDemo({ history: false });
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, e] of Object.entries({ client: 'client1@fuelapp.demo', carrier: 'carrier1@fuelapp.demo', carrier2: 'carrier2@fuelapp.demo', driver: 'driver1@fuelapp.demo', other: 'client2@fuelapp.demo' }))
    tok[k] = (await call('POST', '/auth/login', { email: e, password: DEMO_PASSWORD })).body.token;
  const fd = new FormData();
  fd.append('file', new Blob([sampleAramcoPdf({ docNumber: 'SA-CON-0001', lpCode: 'RBP', lpName: 'Riyadh', liters: 300000, issue: day(0), valid: day(60) })], { type: 'application/pdf' }), 'd.pdf');
  const d = (await call('POST', '/documents', undefined, 'client', fd)).body;
  await call('POST', `/documents/${d.id}/approve`, { doc_number: 'SA-CON-0001', loading_point_id: 'lp_ryd', product: 'diesel', quantity_liters: 300000 }, 'client');
  S.doc = d.id;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
async function call(method, url, body, who, form) {
  const headers = {}; if (who) headers.Authorization = 'Bearer ' + tok[who];
  let payload; if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
const ok = (r, m = '') => { assert.ok(r.status < 300, `${m} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const day = (n) => new Date(Date.now() + n * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);
const search = (date, project = 'prj_1', qty = 10000) => call('GET', `/market/search?loading_point_id=lp_ryd&city=${encodeURIComponent('الرياض')}&product=diesel&quantity_liters=${qty}&date=${date}&project_id=${project}`, undefined, 'client').then((r) => ok(r));
const order = (extra, date, site = 'sit_1', tank = 'tnk_1', qty = 10000) => call('POST', '/orders', { aramco_document_id: S.doc, date, stops: [{ site_id: site, mode: 'tank', tank_id: tank, quantity_liters: qty }], ...extra }, 'client');

test('عقد شهري: يظهر سعر العقد بعد قبول الناقل فقط، ويُستخدم في الطلب', async () => {
  const c = ok(await call('POST', '/contracts', { carrier_id: 'co_car1', type: 'monthly', start_date: day(0), guaranteed_trips_per_month: 1, sla_on_time_pct: 95,
    rates: [{ loading_point_id: 'lp_ryd', delivery_city: 'الرياض', product: 'diesel', pricing_type: 'fixed', price_sar: 1200, cancel_fee_sar: 200 }] }, 'client'));
  assert.ok(!(await search(day(2))).some((o) => o.kind === 'contract'), 'لا يظهر قبل موافقة الناقل');
  assert.equal((await call('POST', `/carrier/contract/${c.id}/accept`, {}, 'carrier2')).status, 404, 'ناقل آخر لا يقبل عقدًا ليس له');
  ok(await call('POST', `/carrier/contract/${c.id}/accept`, {}, 'carrier'));
  const off = (await search(day(2))).find((o) => o.kind === 'contract');
  assert.equal(off.quote.base_halalas, 120000); assert.equal(off.contract_number, c.number);
  const r = ok(await order({ contract_rate_id: off.contract_rate_id }, day(2)));
  const o = q.get('SELECT * FROM orders WHERE id = ?', r.order_id);
  assert.equal(o.contract_id, c.id); assert.equal(o.transport_halalas, 120000);
  ok(await order({ contract_rate_id: off.contract_rate_id }, day(3)));
  const list = ok(await call('GET', '/contracts', undefined, 'client')).contracts.find((x) => x.id === c.id);
  assert.equal(list.state, 'active'); assert.equal(list.usage.this_month_trips >= 1, true);
  assert.equal(list.usage.over_guarantee, list.usage.this_month_trips > 1, 'تجاوز السعة المضمونة يظهر');
  // خارج مدة العقد
  assert.equal((await order({ contract_rate_id: off.contract_rate_id }, day(45))).status, 409);
  S.contract = c.id;
});

test('عقد سنوي: تاريخ النهاية سنة ناقص يوم', async () => {
  const c = ok(await call('POST', '/contracts', { carrier_id: 'co_car2', type: 'annual', start_date: '2027-01-01', rates: [{ loading_point_id: 'lp_dmm', delivery_city: 'الدمام', price_sar: 900 }] }, 'client'));
  assert.equal(q.get('SELECT end_date FROM contracts WHERE id = ?', c.id).end_date, '2027-12-31');
});

test('باقة رحلات: حجز عند الطلب، إعادة عند الإلغاء، خصم عند التسليم أو الإلغاء المتأخر، وتوزيع على المشاريع', async () => {
  const p = ok(await call('POST', '/packages', { carrier_id: 'co_car1', loading_point_id: 'lp_ryd', delivery_city: 'الرياض', product: 'diesel', total_trips: 3, price_sar: 3600,
    max_liters_per_trip: 20000, expiry_date: day(30), allocations: [{ project_id: 'prj_1', trips: 2 }, { project_id: 'prj_2', trips: 1 }] }, 'client'));
  ok(await call('POST', `/carrier/package/${p.id}/accept`, {}, 'carrier'));
  const bal = () => K.packageBalance(p.id);
  const off = (await search(day(5), 'prj_2')).find((o) => o.kind === 'package');
  assert.equal(off.quote.total_halalas, 120000); assert.equal(off.package_balance.project_available, 1);
  // مشروع الملقا: رحلة واحدة مخصصة
  const a = ok(await order({ package_id: p.id, project_id: 'prj_2' }, day(5), 'sit_2', 'tnk_2'));
  assert.deepEqual([bal().reserved, bal().available], [1, 2]);
  assert.equal((await order({ package_id: p.id, project_id: 'prj_2' }, day(6), 'sit_2', 'tnk_2')).status, 409, 'حصة المشروع نفدت');
  // إلغاء قبل القبول ← يعود الرصيد
  ok(await call('POST', `/trips/${a.trip_id}/cancel`, { reason: 'تغيير' }, 'client'));
  assert.deepEqual([bal().reserved, bal().consumed, bal().available], [0, 0, 3]);
  // إلغاء بعد قبول الناقل ← يُخصم حسب شروط الباقة
  const b = ok(await order({ package_id: p.id, project_id: 'prj_2' }, day(6), 'sit_2', 'tnk_2'));
  ok(await call('POST', `/carrier/trips/${b.trip_id}/accept`, {}, 'carrier'));
  ok(await call('POST', `/trips/${b.trip_id}/cancel`, { reason: 'تأخر الموقع' }, 'client'));
  assert.deepEqual([bal().reserved, bal().consumed, bal().available], [0, 1, 2]);
  // تسليم رحلة لمشروع الخرج ← خصم مرة واحدة
  const c = ok(await order({ package_id: p.id, project_id: 'prj_1' }, day(7)));
  ok(await call('POST', `/carrier/trips/${c.trip_id}/accept`, {}, 'carrier'));
  ok(await call('POST', `/carrier/trips/${c.trip_id}/assign`, { vehicle_id: 'veh_1', driver_id: 'drv_1' }, 'carrier'));
  for (const [to, x] of [['to_loading'], ['at_loading'], ['loaded', { loaded_liters: 10000 }], ['to_delivery'], ['at_site']]) ok(await call('POST', `/driver/trips/${c.trip_id}/advance`, { to, ...x }, 'driver'), to);
  const stop = q.get('SELECT id FROM trip_stops WHERE trip_id = ?', c.trip_id).id;
  ok(await call('POST', `/driver/trips/${c.trip_id}/stops/${stop}/deliver`, { delivered_liters: 10000 }, 'driver'));
  assert.deepEqual([bal().reserved, bal().consumed, bal().available], [0, 2, 1]);
  K.onTripDelivered(q.get('SELECT * FROM trips WHERE id = ?', c.trip_id)); // إعادة استدعاء لا تخصم مرتين
  assert.equal(bal().consumed, 2);
  assert.equal(bal().allocations.find((x) => x.project_id === 'prj_1').consumed, 1);
  // تجاوز حد الرحلة في الباقة
  assert.equal((await order({ package_id: p.id, project_id: 'prj_1' }, day(8), 'sit_1', 'tnk_1', 25000)).status, 409);
  const listed = ok(await call('GET', '/contracts', undefined, 'client')).packages.find((x) => x.id === p.id);
  assert.equal(listed.balance.available, 1); assert.ok(listed.ledger.length >= 5);
});

test('حجز السعة: فحص سعة الناقل، كشف التعارض مبكرًا، وربط الطلبات تلقائيًا', async () => {
  const cap = ok(await call('GET', `/capacity/check?carrier_id=co_car1&period_start=${day(20)}&period_end=${day(21)}`, undefined, 'client'));
  assert.equal(cap.vehicles, 3); assert.equal(cap.total, 6);
  const r1 = ok(await call('POST', '/capacity', { carrier_id: 'co_car1', delivery_city: 'الرياض', period_start: day(20), period_end: day(21), trips: 5, allocations: [{ project_id: 'prj_1', trips: 1 }, { project_id: 'prj_2', trips: 4 }] }, 'client'));
  assert.equal(r1.conflict, false);
  assert.equal((await call('POST', '/capacity', { carrier_id: 'co_car1', delivery_city: 'الرياض', period_start: day(20), period_end: day(21), trips: 2, allocations: [{ project_id: 'prj_1', trips: 3 }] }, 'client')).status, 400, 'توزيع أكبر من الحجز');
  ok(await call('POST', `/carrier/capacity/${r1.id}/accept`, {}, 'carrier'));
  const r2 = ok(await call('POST', '/capacity', { carrier_id: 'co_car1', delivery_city: 'الرياض', period_start: day(21), period_end: day(21), trips: 3 }, 'client'));
  assert.equal(r2.conflict, true, 'التعارض يظهر عند الطلب');
  const dec = await call('POST', `/carrier/capacity/${r2.id}/accept`, {}, 'carrier');
  assert.equal(dec.status, 409); assert.match(dec.body.error, /السعة غير كافية/);
  // طلبان في الفترة لمشروع الخرج ← يرتبطان بالحجز، والثاني يتجاوز حصة المشروع
  ok(await order({ route_price_id: 'rp_c1_ryd' }, day(20)));
  ok(await order({ route_price_id: 'rp_c1_ryd' }, day(21)));
  const res = ok(await call('GET', '/contracts', undefined, 'client')).reservations.find((x) => x.id === r1.id);
  assert.equal(res.usage.used, 2); assert.equal(res.usage.remaining, 3);
  assert.equal(res.usage.allocations.find((a) => a.project_id === 'prj_1').over, true);
});

test('العزل: الشركة الثانية والناقل الآخر لا يرون عقود الشركة الأولى', async () => {
  const other = ok(await call('GET', '/contracts', undefined, 'other'));
  assert.equal(other.contracts.length + other.packages.length + other.reservations.length, 0);
  const c2 = ok(await call('GET', '/contracts', undefined, 'carrier2'));
  assert.ok(!c2.contracts.some((c) => c.id === S.contract));
  assert.equal((await call('POST', '/contracts', { carrier_id: 'co_car1', type: 'monthly', start_date: day(0), rates: [] }, 'carrier')).status, 403);
});
