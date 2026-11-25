// الدفعة الأولى — تجربة الحجز: مشروع ← مقارنة ثلاثة ناقلين ← اختيار واحد ← قبول وإسناد ← تسليم ← تقرير الموقع ← أداء الناقل عند الأدمن والتصدير
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelapp-bk-'));
process.env.FUELAPP_DB = path.join(tmp, 'bk.db');
process.env.FUELAPP_UPLOADS = path.join(tmp, 'uploads');
const { openDb, q } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../server/seed.js');
const { sampleAramcoPdf, makePng } = await import('../server/samples.js');

let server, base; const tok = {}; const S = {};
const day = (n) => new Date(Date.now() + n * 864e5 + 3 * 3600e3).toISOString().slice(0, 10);
let opn = 0; const op = () => `op_bk_${++opn}`;
before(async () => {
  openDb(); await seedDemo({ history: false });
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, e] of Object.entries({ client: 'client1@fuelapp.demo', admin: 'admin@fuelapp.demo', other: 'client2@fuelapp.demo', car1: 'carrier1@fuelapp.demo', car2: 'carrier2@fuelapp.demo', driver: 'driver1@fuelapp.demo', reviewer: 'reviewer@fuelapp.demo' }))
    tok[k] = (await call('POST', '/auth/login', { email: e, password: DEMO_PASSWORD })).body.token;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
async function call(method, url, body, who, form, raw) {
  const headers = {}; if (who) headers.Authorization = 'Bearer ' + tok[who];
  let payload; if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  if (raw) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
const ok = (r, m = '') => { assert.ok(r.status < 300, `${m} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const params = (extra = {}) => new URLSearchParams({ loading_point_id: 'lp_ryd', site_id: 'sit_1', product: 'diesel', quantity_liters: 18000, date: day(4), window_start: '07:00', window_end: '15:00', ...extra }).toString();

test('دليل الناقلين وملف الناقل: المناطق والوقود والسعات والأداء والتقييم', async () => {
  const dir = ok(await call('GET', '/carriers', undefined, 'client'));
  assert.ok(dir.length >= 3); assert.ok(!dir.some((c) => c.id === 'co_car3'), 'غير المعتمد لا يظهر');
  const c1 = dir.find((c) => c.id === 'co_car1');
  assert.ok(c1.loading.length && c1.delivery.includes('الرياض') && c1.products.some((p) => p.key === 'diesel') && c1.capacities_l.length);
  assert.ok('on_time_pct' in c1 && 'trips_done' in c1 && 'rating' in c1 && c1.fees);
  assert.ok(ok(await call('GET', '/carriers?city=' + encodeURIComponent('الدمام'), undefined, 'client')).every((c) => c.delivery.includes('الدمام')));
  const p = ok(await call('GET', '/carriers/co_car1', undefined, 'client'));
  assert.ok(p.routes.length && p.routes[0].waiting_fee_halalas_per_hour != null && p.routes[0].cancel_fee_halalas != null);
  assert.ok(p.fleet.length); assert.ok(Array.isArray(p.reviews)); assert.ok(Array.isArray(p.my_trips));
  assert.equal((await call('GET', '/carriers/co_car3', undefined, 'client')).status, 404);
});

test('مفضلو المشروع بالترتيب يظهرون أولًا في «اختر شركة النقل»', async () => {
  ok(await call('PUT', '/projects/prj_1/preferred-carriers', { carrier_ids: ['co_car2', 'co_car1'] }, 'client'));
  const pv = ok(await call('GET', '/projects/prj_1', undefined, 'client'));
  assert.deepEqual(pv.preferred.map((x) => [x.carrier_id, x.priority]), [['co_car2', 1], ['co_car1', 2]]);
  const cards = ok(await call('GET', '/market/carriers?' + params({ sort: 'price' }), undefined, 'client')).cards;
  assert.deepEqual(cards.slice(0, 2).map((c) => c.carrier_id), ['co_car2', 'co_car1']);
  assert.equal((await call('GET', '/projects/prj_1', undefined, 'other')).status, 404, 'عزل الشركات');
  assert.equal((await call('PUT', '/projects/prj_1/preferred-carriers', { carrier_ids: ['co_car1'] }, 'other')).status, 404);
});

test('العميل يفتح المشروع ويقارن ثلاثة ناقلين: السعر الإجمالي وأقرب موعد ورسوم الانتظار وسياسة الإلغاء', async () => {
  const pv = ok(await call('GET', '/projects/prj_1', undefined, 'client'));
  assert.ok(pv.sites.some((s) => s.id === 'sit_1'));
  const all = ok(await call('GET', '/market/carriers?' + params(), undefined, 'client')).cards.filter((c) => c.price);
  assert.ok(all.length >= 3, 'ثلاثة ناقلين بأسعار');
  const three = all.slice(0, 3).map((c) => c.carrier_id);
  const cmp = ok(await call('GET', '/market/carriers?' + params({ only: three.join(',') }), undefined, 'client')).cards;
  assert.equal(cmp.length, 3);
  for (const c of cmp) {
    assert.ok(c.price.quote.total_halalas > 0); assert.ok(c.earliest_date);
    assert.ok(c.price.quote.terms.waiting_fee_halalas_per_hour != null && c.price.quote.terms.cancel_fee_halalas != null && c.price.quote.terms.accept_within_minutes > 0);
  }
  S.pick = cmp.find((c) => c.carrier_id === 'co_car1');
  assert.ok(S.pick, 'ناقلات الوسطى ضمن المقارنة');
  S.others = three.filter((x) => x !== 'co_car1');
});

test('إرسال الطلب للناقل المختار وحده مع مهلة رد ظاهرة', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([sampleAramcoPdf({ docNumber: 'SA-BK-0001', lpCode: 'RBP', lpName: 'Riyadh', liters: 40000, issue: day(0), valid: day(40) })], { type: 'application/pdf' }), 'd.pdf');
  const d = ok(await call('POST', '/documents', undefined, 'client', fd));
  ok(await call('POST', `/documents/${d.id}/approve`, { doc_number: 'SA-BK-0001', loading_point_id: 'lp_ryd', product: 'diesel', quantity_liters: 40000 }, 'client'));
  const o = ok(await call('POST', '/orders', { route_price_id: S.pick.price.route_price_id, aramco_document_id: d.id, project_id: 'prj_1', date: day(4), window_start: '07:00', window_end: '15:00', stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 18000 }] }, 'client'));
  Object.assign(S, { order: o.order_id, trip: o.trip_id, doc: d.id });
  assert.deepEqual(q.all('SELECT carrier_id FROM order_offers WHERE order_id = ?', o.order_id).map((x) => x.carrier_id), ['co_car1']);
  const t = ok(await call('GET', '/trips/' + o.trip_id, undefined, 'client'));
  const offer = t.offers.find((f) => f.carrier_id === 'co_car1');
  assert.equal(offer.status, 'pending'); assert.ok(offer.deadline > new Date().toISOString(), 'مهلة رد ظاهرة');
  assert.equal(ok(await call('GET', '/trips', undefined, 'car2')).some((x) => x.id === o.trip_id), false, 'لا يصل لناقل آخر');
});

test('عرض بديل من الناقل: العميل يقرر — الرفض لا يغير الطلب، والقبول يعدّل الموعد والسعر', async () => {
  // طلب ثانٍ لاختبار العرض البديل والرفض
  const o2 = ok(await call('POST', '/orders', { route_price_id: S.pick.price.route_price_id, aramco_document_id: S.doc, project_id: 'prj_1', date: day(5), stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 18000 }] }, 'client'));
  assert.equal((await call('POST', `/carrier/trips/${o2.trip_id}/counter`, { date: day(6), price_sar: 1700 }, 'car2')).status, 404, 'ناقل لم يصله الطلب');
  const c = ok(await call('POST', `/carrier/trips/${o2.trip_id}/counter`, { date: day(6), window_start: '08:00', window_end: '14:00', price_sar: 1700, note: 'الصهريج متاح بعد يوم' }, 'car1'));
  const seen = ok(await call('GET', '/trips/' + o2.trip_id, undefined, 'client'));
  assert.equal(seen.counter.id, c.id); assert.equal(seen.counter.status, 'pending'); assert.equal(seen.status, 'awaiting_acceptance');
  ok(await call('POST', `/counters/${c.id}/decline`, { note: 'نحتاج الموعد الأصلي' }, 'client'));
  const after = ok(await call('GET', '/trips/' + o2.trip_id, undefined, 'client'));
  assert.equal(after.counter.status, 'declined'); assert.equal(after.needs_carrier, true, 'يظهر «اختر ناقلًا آخر»');
  assert.equal(q.get('SELECT requested_date date FROM orders WHERE id = ?', o2.order_id).date, day(5), 'الرفض لا يغيّر الطلب');
  // طلب ثالث: القبول
  const o3 = ok(await call('POST', '/orders', { route_price_id: S.pick.price.route_price_id, aramco_document_id: S.doc, project_id: 'prj_1', date: day(5), stops: [{ site_id: 'sit_1', mode: 'tank', tank_id: 'tnk_1', quantity_liters: 4000 }] }, 'client'));
  const c3 = ok(await call('POST', `/carrier/trips/${o3.trip_id}/counter`, { date: day(7), price_sar: 1650 }, 'car1'));
  assert.equal((await call('POST', `/counters/${c3.id}/accept`, {}, 'other')).status, 404, 'عميل آخر لا يقرر');
  ok(await call('POST', `/counters/${c3.id}/accept`, {}, 'client'));
  const t3 = ok(await call('GET', '/trips/' + o3.trip_id, undefined, 'client'));
  assert.equal(t3.status, 'awaiting_assignment'); assert.equal(t3.price.base_halalas, 165000); assert.equal(q.get('SELECT requested_date date FROM orders WHERE id = ?', o3.order_id).date, day(7));
  ok(await call('POST', `/trips/${o3.trip_id}/cancel`, { reason: 'تنظيف الاختبار' }, 'client'));
});

test('الناقل المختار يقبل ويسند صهريجًا، والسائق يرى بطاقة دخول الموقع بآخر تحديث', async () => {
  ok(await call('PUT', '/sites/sit_1/access', { gate_lat: '24.30121', gate_lng: '47.18342', receiving_hours: '06:00 – 18:00', receiving_days: 'السبت – الخميس', access_notes: 'البوابة الشمالية، يلزم سترة سلامة' }, 'client'));
  assert.equal((await call('PUT', '/sites/sit_1/access', { gate_lat: '51.5', gate_lng: '0.1' }, 'client')).status, 400, 'إحداثيات خارج المملكة');
  assert.equal((await call('PUT', '/sites/sit_1/access', { receiving_hours: 'x' }, 'other')).status, 404);
  ok(await call('POST', `/carrier/trips/${S.trip}/accept`, {}, 'car1'));
  ok(await call('POST', `/carrier/trips/${S.trip}/assign`, { vehicle_id: 'veh_1', driver_id: 'drv_1' }, 'car1'));
  const dv = ok(await call('GET', '/trips/' + S.trip, undefined, 'driver'));
  const st = dv.stops[0];
  assert.equal(st.gate_lat, 24.30121); assert.equal(st.receiving_hours, '06:00 – 18:00'); assert.ok(st.access_updated_at); assert.match(st.access_notes, /البوابة الشمالية/);
});

test('التسليم ثم تقرير الموقع: الكمية والصور والمستلم', async () => {
  const photo = async (kind, stop) => { const fd = new FormData(); fd.append('photo', new Blob([makePng(60, 40)], { type: 'image/png' }), kind + '.png'); fd.append('kind', kind); if (stop) fd.append('stop_id', stop); fd.append('client_op_id', op()); return ok(await call('POST', `/driver/trips/${S.trip}/photos`, undefined, 'driver', fd), kind); };
  for (const to of ['to_loading', 'at_loading']) ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to, client_op_id: op() }, 'driver'));
  await photo('before_loading');
  ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to: 'loaded', loaded_liters: 18000, client_op_id: op() }, 'driver'));
  await photo('after_loading');
  ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to: 'to_delivery', client_op_id: op() }, 'driver'));
  S.stop = ok(await call('POST', `/driver/trips/${S.trip}/advance`, { to: 'at_site', client_op_id: op() }, 'driver')).stop_id;
  await photo('before_unloading', S.stop);
  ok(await call('POST', `/driver/trips/${S.trip}/stops/${S.stop}/deliver`, { delivered_liters: 17950, client_op_id: op() }, 'driver'));
  await photo('after_unloading', S.stop);
  assert.equal((await call('POST', `/trips/${S.trip}/rating`, { on_time: 5, communication: 5, documentation: 5 }, 'client')).status, 409, 'لا تقييم قبل تأكيد المستلم');
  const token = q.get('SELECT receipt_token FROM trip_stops WHERE id = ?', S.stop).receipt_token;
  ok(await call('POST', '/public/receipt/' + token, { ack: 'confirmed', name: 'ماجد السبيعي', note: 'مطابق للعداد' }));
  const site = ok(await call('GET', '/sites/sit_1', undefined, 'client'));
  const row = site.delivered.find((t) => t.id === S.trip);
  assert.ok(row, 'الرحلة في تقرير الموقع');
  assert.equal(row.requested_ml, 18_000_000); assert.equal(row.delivered_ml, 17_950_000);
  assert.equal(row.photos, 4); assert.equal(row.receiver_ack, 'confirmed'); assert.equal(row.receiver_ack_by, 'ماجد السبيعي');
  assert.equal(row.carrier_name, 'ناقلات الوسطى (تجريبي)'); assert.ok(row.plate && row.driver_name);
  assert.equal(site.totals.delivered_ml, site.delivered.reduce((a, t) => a + (t.delivered_ml || 0), 0));
  assert.ok(site.tanks[0].book_ml >= 17_950_000);
  assert.equal((await call('GET', '/sites/sit_1', undefined, 'other')).status, 404, 'عزل الشركات');
});

test('تقييم بعد رحلة موثقة — مرة واحدة، ويظهر في ملف الناقل', async () => {
  const before = ok(await call('GET', '/carriers/co_car1', undefined, 'client')).rating.count;
  ok(await call('POST', `/trips/${S.trip}/rating`, { on_time: 5, communication: 4, documentation: 5, comment: 'تسليم دقيق' }, 'client'));
  assert.equal((await call('POST', `/trips/${S.trip}/rating`, { on_time: 1, communication: 1, documentation: 1 }, 'client')).status, 409);
  const p = ok(await call('GET', '/carriers/co_car1', undefined, 'client'));
  assert.equal(p.rating.count, before + 1); assert.ok(p.reviews.some((r) => r.comment === 'تسليم دقيق'));
  assert.ok(p.my_trips.some((t) => t.id === S.trip));
  const t = ok(await call('GET', '/trips/' + S.trip, undefined, 'client'));
  assert.equal(t.can_rate, false); assert.equal(t.rating.on_time, 5);
});

test('الأدمن يرى الرحلة ضمن أداء الناقل، والتصدير بنفس الأرقام', async () => {
  const prof = ok(await call('GET', '/admin/companies/co_car1?period=all', undefined, 'admin'));
  const delivered = prof.groups.flatMap((g) => g.metrics).find((m) => m.key === 'trips.delivered');
  const recs = ok(await call('GET', '/admin/records?metric=trips.delivered&period=all&company_id=co_car1', undefined, 'admin'));
  assert.equal(recs.rows.length, delivered.value, 'المؤشر = السجلات');
  assert.ok(recs.rows.some((r) => r.id === S.trip || r.number === q.get('SELECT number FROM trips WHERE id = ?', S.trip).number), 'الرحلة ضمن رحلات الناقل');
  assert.ok(prof.rating.count >= 1); assert.ok(prof.performance.some(([l]) => l === 'متوسط التقييم'));
  const x = await call('GET', '/admin/companies/co_car1/export?format=xlsx&period=all', undefined, 'admin', undefined, true);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf);
  const sum = wb.worksheets[0]; const vals = {};
  sum.eachRow((r) => { const v = r.values; if (v[2]) vals[`${v[1]}|${v[2]}`] = v[3]; });
  for (const g of prof.groups) for (const m of g.metrics) assert.equal(String(vals[`${g.title}|${m.label}`]), String(m.value ?? 'بيانات غير كافية'), m.label);
  for (const [l, v] of prof.performance) assert.equal(String(vals[`الأداء|${l}`]), String(v), l);
  const tripsSheet = wb.worksheets.find((w) => w.name === recs.label || w.name.startsWith('كل الرحلات') || w.name.includes('الرحلات'));
  assert.ok(tripsSheet, 'ورقة الرحلات');
  let found = false; const no = q.get('SELECT number FROM trips WHERE id = ?', S.trip).number; tripsSheet.eachRow((r) => { if (r.values.includes(no)) found = true; });
  assert.ok(found, 'الرحلة في ورقة التصدير');
  const pdf = await call('GET', '/admin/companies/co_car1/export?format=pdf&period=all', undefined, 'admin', undefined, true);
  assert.equal(pdf.status, 200); assert.ok(pdf.buf.toString().includes('متوسط التقييم'));
});
