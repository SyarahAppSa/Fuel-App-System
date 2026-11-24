import { openDb, q } from './db.js';
import { createApp } from './app.js';
import { seedDemo } from './seed.js';

openDb();
if (!q.get('SELECT 1 FROM companies LIMIT 1')) {
  console.log('قاعدة بيانات فارغة — إنشاء البيانات التجريبية...');
  await seedDemo();
  q.run('DELETE FROM sessions');
}
const port = Number(process.env.PORT || 3000);
createApp().listen(port, () => console.log(`فيول آب يعمل على http://localhost:${port}`));
