// «اختر شركة النقل»: ثلاثة ناقلين جدد يخدمون المسار — يختار العميل الثاني فيصله الطلب وحده
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelapp-cc-'));
process.env.FUELAPP_DB = path.join(tmp, 'cc.db');
process.env.FUELAPP_UPLOADS = path.join(tmp, 'uploads');
const { openDb, q } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../server/seed.js');
const { sampleAramcoPdf, makePng } = await import('../server/samples.js');

let server, base; const tok = {}; const S = {};
const day = (n) => new Date(Date.now() + n * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);
before(async () => {
  openDb(); await seedDemo({ history: false });
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, e] of Object.entries({ client: 'client1@fuelapp.demo', admin: 'admin@fuelapp.demo', other: 'client2@fuelapp.demo' }))
    tok[k] = (await call('POST', '/auth/login', { email: e, password: DEMO_PASSWORD })).body.token;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
async function call(method, url, body, who, form) {
  const headers = {}; if (who) headers.Authorization = 'Bearer ' + tok[who];
  let payload; if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
const ok = (r, m = '') => { assert.ok(r.status < 300, `${m} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const CARRIERS = [['ناقلات الأفق (اختبار)', 'afaq', 1500, '0001'], ['ناقلات الريادة (اختبار)', 'riyada', 1380, '0002'], ['ناقلات الوفاء (اختبار)', 'wafa', 1620, '0003']];
const params = (extra = {}) => new URLSearchParams({ loading_point_id: 'lp_ryd', site_id: 'sit_1', product: 'diesel', quantity_liters: 20000, date: day(3), window_start: '07:00', window_end: '15:00', ...extra }).toString();

test('تسجيل ثلاثة ناقلين جدد، اعتمادهم، وإعداد أسطولهم وأسعارهم وتغطيتهم', async () => {
  for (const [name, key, price, plate] of CARRIERS) {
    const r = ok(await call('POST', '/public/register', { company_name: name, admin_name: 'مدير ' + key, email: `${key}@test.demo`, password: 'Carrier@2026', city: 'الرياض', cr_number: '10' + plate }), name);
    assert.equal(r.status, 'pending');
    tok[key] = (await call('POST', '/auth/login', { email: `${key}@test.demo`, password: 'Carrier@2026' })).body.token;
    ok(await call('POST', `/admin/companies/${r.company_id}/approve`, {}, 'admin'));
    ok(await call('POST', '/carrier/vehicles', { plate: 'ت س ت ' + plate, capacity_liters: 32000, products: ['diesel'], docs_valid_until: '2028-01-01' }, key));
    ok(await call('POST', '/carrier/drivers', { name: 'سائق ' + key, phone: '0599' + plate, license_expiry: '2028-01-01' }, key));
    ok(await call('POST', '/carrier/prices', { loading_point_id: 'lp_ryd', delivery_city: 'الرياض', product: 'diesel', pricing_type: 'fixed', price_sar: price }, key));
    const fd = new FormData(); fd.append('logo', new Blob([makePng(64, 64, [20, 60, 160])], { type: 'image/png' }), 'logo.png');
    ok(await call('POST', '/carrier/logo', undefined, key, fd));
    S[key] = r.company_id;
  }
});

test('بطاقات الناقلين: كل ناقل معتمد يخدم المسار، بسعره وأقرب موعد وسعة الصهريج والأداء', async () => {
  const r = ok(await call('GET', '/market/carriers?' + params(), undefined, 'client'));
  for (const [name, key, price] of CARRIERS) {
    const c = r.cards.find((x) => x.carrier_id === S[key]);
    assert.ok(c, name); assert.equal(c.name, name);
    assert.ok(c.logo_url); assert.ok(c.loading.includes('محطة توزيع الرياض') && c.delivery.includes('الرياض'));
    assert.equal(c.price.source, 'public'); assert.equal(c.price.quote.base_halalas, price * 100);
    assert.equal(c.earliest_date, day(3)); assert.equal(c.suitable_capacity_l, 32000);
    assert.equal(c.trips_done, 0); assert.equal(c.on_time_pct, null); assert.equal(c.sample, 0);
  }
  assert.ok(!r.cards.some((c) => c.carrier_id === 'co_car3'), 'الناقل غير المعتمد لا يظهر');
  assert.ok(r.cards.some((c) => c.carrier_id === 'co_car4' && !c.price), 'ناقل يغطي المسار بلا سعر ← اطلب عرض سعر');
  // الفرز
  const byPrice = ok(await call('GET', '/market/carriers?' + params({ sort: 'price' }), undefined, 'client')).cards.filter((c) => c.price).map((c) => c.price.quote.total_halalas);
  assert.deepEqual(byPrice, [...byPrice].sort((a, b) => a - b));
  const byPerf = ok(await call('GET', '/market/carriers?' + params({ sort: 'performance' }), undefined, 'client')).cards;
  assert.ok(byPerf.findIndex((c) => c.carrier_id === 'co_car1') < byPerf.findIndex((c) => c.carrier_id === S.afaq) || byPerf.find((c) => c.carrier_id === 'co_car1').on_time_pct == null);
});

test('اختيار الناقل الثاني: الطلب يصل إليه وحده ويظهر اسمه وحالة رده للعميل', async () => {
  const card = ok(await call('GET', '/market/carriers?' + params(), undefined, 'client')).cards.find((c) => c.carrier_id === S.riyada);
  const fd = new FormData();
  fd.append('file', new Blob([sampleAramcoPdf({ docNumber: 'SA-CC-0001', lpCode: 'RBP', lpName: 'Riyadh', liters: 60000, issue: day(0), valid: day(40) })], { type: 'application/pdf' }), 'd.pdf');
  const d = ok(await call('POST', '/documents', undefined, 'client', fd));
  ok(await call('POST', `/documents/${d.id}/approve`, { doc_number: 'SA-CC-0001', loading_point_id: 'lp_ryd', product: 'diesel', quantity_liters: 60000 }, 'client'));
  S.doc = d.id;
  const o = ok(await call('POST', '/orders', { route_price_id: card.price.route_price_id, aramco_document_id: d.id, date: day(3), window_start: '07:00', window_end: '15:00', stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 20000 }] }, 'client'));
  Object.assign(S, { order: o.order_id, trip: o.trip_id });
  assert.deepEqual(q.all('SELECT carrier_id FROM order_offers WHERE order_id = ?', o.order_id).map((x) => x.carrier_id), [S.riyada]);
  const seen = async (key) => ok(await call('GET', '/trips', undefined, key)).some((t) => t.id === o.trip_id);
  assert.equal(await seen('riyada'), true, 'يظهر في لوحة الناقل الثاني');
  assert.equal(await seen('afaq'), false, 'لا يظهر للأول'); assert.equal(await seen('wafa'), false, 'لا يظهر للثالث');
  assert.equal((await call('GET', '/trips/' + o.trip_id, undefined, 'afaq')).status, 404);
  assert.equal((await call('POST', `/carrier/trips/${o.trip_id}/accept`, {}, 'wafa')).status, 404, 'ناقل آخر لا يستطيع قبوله');
  const mine = ok(await call('GET', '/trips', undefined, 'client')).find((t) => t.id === o.trip_id);
  assert.equal(mine.carrier_name, 'ناقلات الريادة (اختبار)'); assert.equal(mine.offer_status, 'pending');
});

test('اعتذر الناقل ← «اختر ناقلًا آخر» بنفس بيانات الطلب؛ الجديد يصله والمعتذر يُستبعد', async () => {
  ok(await call('POST', `/carrier/trips/${S.trip}/reject`, { reason: 'لا توجد سعة في هذا اليوم' }, 'riyada'));
  const t = ok(await call('GET', '/trips/' + S.trip, undefined, 'client'));
  assert.equal(t.needs_carrier, true); assert.equal(t.offers[0].status, 'rejected');
  const ctxo = ok(await call('GET', `/orders/${S.order}/context`, undefined, 'client'));
  assert.equal(ctxo.stops[0].quantity_liters, 20000); assert.equal(ctxo.aramco_document_id, S.doc);
  const cards = ok(await call('GET', '/market/carriers?' + params({ order_id: S.order }), undefined, 'client')).cards;
  assert.ok(!cards.some((c) => c.carrier_id === S.riyada), 'المعتذر لا يظهر');
  const wafa = cards.find((c) => c.carrier_id === S.wafa);
  assert.equal((await call('POST', `/orders/${S.order}/reoffer`, { route_price_id: wafa.price.route_price_id }, 'client')).status, 200);
  assert.equal(ok(await call('GET', '/trips', undefined, 'wafa')).some((x) => x.id === S.trip), true);
  assert.equal(ok(await call('GET', '/trips', undefined, 'riyada')).some((x) => x.id === S.trip), false);
  const t2 = ok(await call('GET', '/trips/' + S.trip, undefined, 'client'));
  assert.equal(t2.carrier_name, 'ناقلات الوفاء (اختبار)'); assert.equal(t2.needs_carrier, false); assert.equal(t2.price.base_halalas, 162000);
  // انتهت مهلة الرد ← يحتاج ناقلًا آخر
  q.run("UPDATE order_offers SET deadline = '2000-01-01T00:00:00.000Z' WHERE order_id = ? AND status = 'pending'", S.order);
  assert.equal(ok(await call('GET', '/trips/' + S.trip, undefined, 'client')).needs_carrier, true);
  assert.equal((await call('POST', `/carrier/trips/${S.trip}/accept`, {}, 'wafa')).status, 409, 'لا قبول بعد انتهاء المهلة');
  ok(await call('POST', `/orders/${S.order}/reoffer`, { route_price_id: cards.find((c) => c.carrier_id === S.afaq).price.route_price_id }, 'client'));
  ok(await call('POST', `/carrier/trips/${S.trip}/accept`, {}, 'afaq'));
  assert.equal(ok(await call('GET', '/trips/' + S.trip, undefined, 'client')).status, 'awaiting_assignment');
});

test('لا ناقل متاح في الموعد ← أقرب موعد متاح', async () => {
  // الأفق لديه صهريج وسائق واحد: بعد إسناد رحلة يوم +3 يصبح أقرب موعد له +4
  const veh = q.get('SELECT id FROM vehicles WHERE company_id = ?', S.afaq).id; const drv = q.get('SELECT id FROM drivers WHERE company_id = ?', S.afaq).id;
  ok(await call('POST', `/carrier/trips/${S.trip}/assign`, { vehicle_id: veh, driver_id: drv }, 'afaq'));
  const c = ok(await call('GET', '/market/carriers?' + params(), undefined, 'client')).cards.find((x) => x.carrier_id === S.afaq);
  assert.equal(c.available, false); assert.equal(c.earliest_date, day(4));
});

test('طلب عرض سعر من ناقل بلا سعر منشور، ثم الطلب بالسعر المعروض', async () => {
  const qr = ok(await call('POST', '/quote-requests', { carrier_id: 'co_car4', loading_point_id: 'lp_ryd', site_id: 'sit_1', product: 'diesel', quantity_liters: 20000, date: day(5) }, 'client'));
  assert.equal((await call('POST', '/quote-requests', { carrier_id: 'co_car4', loading_point_id: 'lp_ryd', site_id: 'sit_1', product: 'diesel', quantity_liters: 20000, date: day(5) }, 'client')).status, 409);
  tok.car4 = (await call('POST', '/auth/login', { email: 'carrier4@fuelapp.demo', password: DEMO_PASSWORD })).body.token;
  assert.ok(ok(await call('GET', '/quote-requests', undefined, 'car4')).some((x) => x.id === qr.id));
  ok(await call('POST', `/carrier/quote-requests/${qr.id}/respond`, { price_sar: 1490, valid_hours: 24, earliest_date: day(5) }, 'car4'));
  const c = ok(await call('GET', '/market/carriers?' + params({ date: day(5) }), undefined, 'client')).cards.find((x) => x.carrier_id === 'co_car4');
  assert.equal(c.price.source, 'quote'); assert.equal(c.price.quote.base_halalas, 149000);
  const o = ok(await call('POST', '/orders', { quote_request_id: c.price.quote_request_id, aramco_document_id: S.doc, date: day(5), stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 20000 }] }, 'client'));
  assert.ok(ok(await call('GET', '/trips', undefined, 'car4')).some((t) => t.id === o.trip_id));
  assert.equal(q.get('SELECT status FROM quote_requests WHERE id = ?', qr.id).status, 'used');
});

test('المفضلون، والعزل بين العملاء', async () => {
  ok(await call('POST', `/favorites/${S.wafa}`, {}, 'client'));
  assert.equal(ok(await call('GET', '/market/carriers?' + params(), undefined, 'client')).cards.find((c) => c.carrier_id === S.wafa).favorite, true);
  ok(await call('DELETE', `/favorites/${S.wafa}`, undefined, 'client'));
  assert.equal(ok(await call('GET', '/market/carriers?' + params(), undefined, 'client')).cards.find((c) => c.carrier_id === S.wafa).favorite, false);
  assert.equal((await call('GET', `/orders/${S.order}/context`, undefined, 'other')).status, 404);
  assert.equal((await call('POST', `/orders/${S.order}/reoffer`, { route_price_id: 'rp_c1_ryd' }, 'other')).status, 404);
  assert.equal((await call('GET', '/market/carriers?' + params(), undefined, 'other')).status, 400, 'موقع ليس للشركة الثانية');
});
