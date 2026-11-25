import fs from 'node:fs';
import path from 'node:path';
import { openDb, q, getDb, uid } from './db.js';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';
import { hashPassword } from './auth.js';

const dbFile = process.env.FUELAPP_DB || path.join(process.cwd(), 'data', 'fuelapp.db');
openDb(dbFile);

if (!q.get('SELECT 1 FROM companies LIMIT 1')) {
  if (process.env.FUELAPP_SEED_DEMO === '0') {
    // تشغيل فعلي: قاعدة فارغة + حساب إدارة واحد من متغيرات البيئة
    const email = (process.env.FUELAPP_ADMIN_EMAIL || '').toLowerCase().trim();
    const pw = process.env.FUELAPP_ADMIN_PASSWORD || '';
    if (!email || pw.length < 10) { console.error('للتشغيل الفعلي اضبط FUELAPP_ADMIN_EMAIL وFUELAPP_ADMIN_PASSWORD (10 أحرف على الأقل)'); process.exit(1); }
    const u = uid('usr_');
    q.run("INSERT INTO companies(id,type,name_ar,name_en,city,status,is_demo,settings_json) VALUES ('co_fuelapp','platform','فيول آب','Fuel App','الرياض','approved',0,'{\"commission_pct\":3}')");
    q.run('INSERT INTO users(id,name,email,password_hash) VALUES (?,?,?,?)', u, 'إدارة فيول آب', email, hashPassword(pw));
    q.run("INSERT INTO memberships(id,user_id,company_id,role) VALUES (?,?,'co_fuelapp','platform_admin')", uid('mem_'), u);
    for (const l of [['lp_ryd', 'RBP', 'محطة توزيع الرياض', 'الرياض'], ['lp_dmm', 'DBP', 'محطة توزيع الدمام', 'الدمام'], ['lp_jed', 'JBP', 'محطة توزيع جدة', 'جدة'], ['lp_qsm', 'QBP', 'محطة توزيع القصيم', 'بريدة']])
      q.run('INSERT INTO loading_points(id,code,name,city) VALUES (?,?,?,?)', ...l);
    console.log('قاعدة تشغيل فعلي جديدة — حساب الإدارة:', email);
  } else {
    console.log('قاعدة بيانات فارغة — إنشاء البيانات التجريبية...');
    await seedDemo();
    q.run('DELETE FROM sessions');
  }
}

// نسخة احتياطية يومية متسقة (VACUUM INTO) بجانب قاعدة البيانات، مع الاحتفاظ بآخر 14 نسخة
const backupDir = process.env.FUELAPP_BACKUPS || path.join(path.dirname(dbFile), 'backups');
function backup() {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const name = `fuelapp-${new Date().toISOString().slice(0, 10)}.db`;
    const target = path.join(backupDir, name);
    if (fs.existsSync(target)) return;
    getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(backupDir).filter((f) => f.startsWith('fuelapp-') && f.endsWith('.db')).sort().reverse().slice(14);
    for (const f of old) fs.rmSync(path.join(backupDir, f), { force: true });
    console.log('نسخة احتياطية:', name);
  } catch (e) { console.error('فشل النسخ الاحتياطي:', e.message); }
}
if (process.env.FUELAPP_BACKUPS !== 'off') { setTimeout(backup, 60_000); setInterval(backup, 6 * 3600_000); }

const port = Number(process.env.PORT || 3000);
createApp().listen(port, () => console.log(`فيول آب يعمل على http://localhost:${port} — البيانات: ${dbFile}`));
