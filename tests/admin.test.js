// مركز التشغيل: الأرقام = السجلات = التصدير، العد الصحيح، والصلاحيات
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelapp-adm-'));
process.env.FUELAPP_DB = path.join(tmp, 'a.db');
process.env.FUELAPP_UPLOADS = path.join(tmp, 'uploads');
const { openDb, q } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../server/seed.js');

let server, base; const tok = {};
before(async () => {
  openDb(); await seedDemo({ history: true });
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, e] of Object.entries({ admin: 'admin@fuelapp.demo', reviewer: 'reviewer@fuelapp.demo', ops: 'ops@fuelapp.demo', client: 'client1@fuelapp.demo', carrier: 'carrier1@fuelapp.demo' }))
    tok[k] = (await call('POST', '/auth/login', { email: e, password: DEMO_PASSWORD })).body.token;
});
after(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
async function call(method, url, body, who, raw) {
  const headers = {}; if (who) headers.Authorization = 'Bearer ' + tok[who];
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (raw) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
}
const ok = (r, m = '') => { assert.ok(r.status < 300, `${m} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const metric = (home, key) => home.sections.flatMap((s) => s.metrics).find((m) => m.key === key);

test('كل رقم في الصفحة الرئيسية يطابق عدد سجلاته بنفس الفلتر', async () => {
  for (const qs of ['period=month', 'period=all', 'period=7d', 'period=all&company_id=co_car1', 'period=all&city=' + encodeURIComponent('الرياض'), 'period=all&product=diesel', 'period=all&project_id=prj_2']) {
    const home = ok(await call('GET', '/admin/home?' + qs, undefined, 'admin'));
    for (const s of home.sections) for (const m of s.metrics) {
      const r = ok(await call('GET', `/admin/records?metric=${m.key}&${qs}`, undefined, 'admin'));
      assert.equal(r.value, m.value, `${m.key} ${qs}`);
      if (!['vehicles.capacity', 'offers.avg_response'].includes(m.key) && !m.unit) assert.equal(r.total, m.value, `count ${m.key} ${qs}`);
    }
  }
});

test('اختبار 1: شركة نقل — كم طلبًا استقبلت وكم قبلت وكم رحلة نفذت وكم سائقًا وصهريجًا', async () => {
  const p = ok(await call('GET', '/admin/companies/co_car1?period=all', undefined, 'admin'));
  const v = Object.fromEntries(p.groups.flatMap((g) => g.metrics).map((m) => [m.key, m.value]));
  const offers = q.all("SELECT * FROM order_offers WHERE carrier_id = 'co_car1'");
  assert.equal(v['offers.received'], offers.length);
  assert.equal(v['offers.accepted'], offers.filter((o) => o.status === 'accepted').length);
  assert.equal(v['trips.delivered'], q.get("SELECT COUNT(*) n FROM trips WHERE carrier_id = 'co_car1' AND accepted_at IS NOT NULL AND status IN ('delivered','under_review','closed')").n);
  assert.equal(v['drivers.total'], 4); assert.equal(v['vehicles.total'], 4);
  assert.equal(p.drivers.length, 4); assert.equal(p.vehicles.length, 4);
  const p2 = ok(await call('GET', '/admin/companies/co_car2?period=all', undefined, 'admin'));
  const v2 = Object.fromEntries(p2.groups.flatMap((g) => g.metrics).map((m) => [m.key, m.value]));
  assert.equal(v2['drivers.total'], 2); assert.equal(v2['vehicles.total'], 2);
  assert.ok(v2['offers.expired'] >= 1 && v2['offers.withdrawn'] >= 1);
});

test('العد: طلب لثلاثة/اثنين ناقلين يُحسب مرة في المنصة ومرة لكل ناقل؛ وطلب مقسّم = طلب واحد و3 رحلات', async () => {
  const bro = q.get("SELECT order_id FROM order_offers GROUP BY order_id HAVING COUNT(*) = 2 LIMIT 1").order_id;
  const all = ok(await call('GET', '/admin/records?metric=orders.total&period=all', undefined, 'admin'));
  assert.equal(all.rows.filter((r) => r.id === bro).length, 1);
  for (const c of ['co_car1', 'co_car2']) {
    const r = ok(await call('GET', `/admin/records?metric=offers.received&period=all&company_id=${c}`, undefined, 'admin'));
    assert.equal(r.rows.filter((x) => x.order_id === bro).length, 1, c);
  }
  const split = q.get('SELECT order_id, COUNT(*) n FROM trips GROUP BY order_id HAVING n = 3');
  assert.ok(split);
  const o = ok(await call('GET', '/admin/orders/' + split.order_id, undefined, 'admin'));
  assert.equal(o.trips.length, 3);
  assert.equal(all.rows.find((r) => r.id === split.order_id).trips_count, 3);
});

test('اختبار 2: الطلبات المتأخرة تفتح السجلات نفسها مع مكان التوقف والمسؤول', async () => {
  const home = ok(await call('GET', '/admin/home?period=all', undefined, 'admin'));
  const late = metric(home, 'orders.late');
  const r = ok(await call('GET', '/admin/records?metric=orders.late&period=all', undefined, 'admin'));
  assert.equal(r.rows.length, late.value); assert.ok(late.value >= 2);
  for (const row of r.rows) { assert.ok(row.stuck_at); assert.ok(row.responsible && row.responsible !== '—', row.number); assert.ok(row.late); }
  const noResp = r.rows.find((x) => x.stuck_at.includes('انتهت مهلة'));
  assert.ok(noResp.follow_up, 'متابع معيّن من العمليات');
  const exec = r.rows.find((x) => x.responsible.includes('السائق'));
  assert.ok(exec, 'تأخر تنفيذ ينسب للسائق والناقل');
  assert.ok(home.attention.some((a) => a.kind === 'no_response') && home.attention.some((a) => a.kind === 'late_trip') && home.attention.some((a) => a.kind === 'document'));
});

test('اختبار 3: تقرير الشركة المصدّر يطابق أرقام اللوحة لنفس الفترة', async () => {
  const { default: ExcelJS } = await import('exceljs');
  for (const period of ['all', 'month', '7d']) {
    const p = ok(await call('GET', `/admin/companies/co_car1?period=${period}`, undefined, 'admin'));
    const x = await call('GET', `/admin/companies/co_car1/export?period=${period}`, undefined, 'admin', true);
    assert.equal(x.status, 200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf);
    const sum = wb.worksheets[0]; const rows = [];
    sum.eachRow((r, i) => { if (i > 3) rows.push(r.values); });
    for (const m of p.groups.flatMap((g) => g.metrics)) {
      const row = rows.find((r) => r[2] === m.label);
      assert.ok(row, m.label);
      assert.equal(String(row[3]), String(m.value ?? 'بيانات غير كافية'), `${period} ${m.label}`);
    }
    const recSheet = wb.worksheets.find((w) => w.name === 'طلبات واردة');
    assert.equal(recSheet.rowCount - 1, p.groups[0].metrics.find((m) => m.key === 'offers.received').value);
  }
  const pdf = ok(await call('GET', '/admin/companies/co_car1/export?period=all&format=pdf', undefined, 'admin'));
  assert.ok(pdf.includes('تقرير ناقلات الوسطى') && pdf.includes('طلبات واردة'));
});

test('البحث الموحد: برقم اللوحة واسم السائق ورقم الرحلة', async () => {
  const a = ok(await call('GET', '/admin/search?q=' + encodeURIComponent('ك ل م 9031'), undefined, 'admin'));
  assert.ok(a.orders.length >= 1 && a.vehicles.length === 1);
  const b = ok(await call('GET', '/admin/search?q=' + encodeURIComponent('القحطاني'), undefined, 'admin'));
  assert.ok(b.orders.length >= 1 && b.drivers.length === 1);
  const t = q.get('SELECT number FROM trips LIMIT 1').number;
  assert.ok(ok(await call('GET', '/admin/search?q=' + t, undefined, 'admin')).orders.length === 1);
  const o = ok(await call('GET', '/admin/orders/' + a.orders[0].id, undefined, 'admin'));
  assert.ok(o.offers.length >= 1 && o.history.length >= 1 && o.client_name && o.loading_point_name);
});

test('الصلاحيات وسجل التدقيق', async () => {
  assert.equal((await call('GET', '/admin/home', undefined, 'client')).status, 403);
  assert.equal((await call('GET', '/admin/home', undefined, 'carrier')).status, 403);
  // العمليات: بلا مالية
  const ops = ok(await call('GET', '/admin/home?period=all', undefined, 'ops'));
  assert.equal(ops.sections.find((s) => s.key === 'finance').restricted, true);
  assert.equal((await call('GET', '/admin/records?metric=finance.invoiced', undefined, 'ops')).status, 403);
  assert.equal((await call('GET', '/admin/reports/invoices', undefined, 'ops')).status, 403);
  const ord = ok(await call('GET', '/admin/records?metric=orders.total&period=all', undefined, 'ops'));
  assert.ok(!ord.columns.some((c) => c[0] === 'transport_halalas'));
  // المراجعة: تعرض وتصدّر لكن لا تنفذ إجراءات حساسة
  const inv = q.get("SELECT id FROM invoices WHERE status = 'issued' LIMIT 1").id;
  assert.equal((await call('POST', `/admin/invoices/${inv}/pay`, {}, 'reviewer')).status, 403);
  assert.equal((await call('POST', '/admin/companies/co_car3/approve', {}, 'reviewer')).status, 403);
  assert.equal((await call('GET', '/admin/reports/orders?period=all&format=xlsx', undefined, 'reviewer', true)).status, 200);
  // الأدمن: الإجراء ينجح ويُسجل
  ok(await call('POST', `/admin/invoices/${inv}/pay`, {}, 'admin'));
  ok(await call('POST', '/admin/follow-ups', { entity_type: 'trip', entity_id: q.get('SELECT id FROM trips LIMIT 1').id, note: 'اختبار' }, 'ops'));
  const audit = ok(await call('GET', '/admin/audit', undefined, 'reviewer'));
  for (const a of ['admin.invoice.payment', 'admin.follow_up.assign', 'admin.export.report']) assert.ok(audit.some((x) => x.action === a), a);
});

test('كل التقارير تعمل وتصدّر Excel وPDF', async () => {
  for (const r of ok(await call('GET', '/admin/filters', undefined, 'admin')).reports) {
    const v = ok(await call('GET', `/admin/reports/${r.key}?period=all`, undefined, 'admin'), r.key);
    assert.ok(Array.isArray(v.rows) && v.columns.length, r.key);
    const x = await call('GET', `/admin/reports/${r.key}?period=all&format=xlsx`, undefined, 'admin', true);
    assert.equal(x.buf.subarray(0, 2).toString(), 'PK', r.key);
    const p = await call('GET', `/admin/reports/${r.key}?period=all&format=pdf`, undefined, 'admin');
    assert.ok(String(p.body).includes(v.title));
  }
});
