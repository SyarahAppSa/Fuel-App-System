import React from 'react';
import { Building2, Truck, Wallet, Nfc } from 'lucide-react';
import { api, useApi, sar, n, dOnly, fail, toast } from '../lib.js';
import { Card, Chip, Spinner, Kpi } from '../ui.jsx';
import { Title } from '../ctx.jsx';

const DOC = { cr: 'السجل التجاري', vat: 'شهادة الضريبة', transport_license: 'ترخيص النقل', insurance: 'التأمين' };
const ST = { pending: ['بانتظار الاعتماد', 'warn'], approved: ['معتمد', 'good'], suspended: ['موقوف', 'bad'], rejected: ['مرفوض', 'bad'] };

export default function Admin() {
  const r = useApi('/admin/overview');
  if (!r.data) return <Spinner />;
  const d = r.data;
  const act = async (path, body) => { try { await api(path, { method: 'POST', body }); toast('تم'); r.reload(); } catch (e) { fail(e); } };
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <Title sub="اعتماد الأطراف والوثائق ومتابعة السوق">إدارة فيول آب</Title>
      <div className="grid g4">
        <Kpi icon={Building2} label="الشركات" value={d.companies.length} foot={`${d.companies.filter((c) => c.status === 'pending').length} بانتظار الاعتماد`} />
        <Kpi icon={Wallet} label="قيمة النقل في السوق" value={sar(d.gmv_halalas)} unit="ر.س" />
        <Kpi icon={Truck} label="الرحلات" value={d.trips_by_status.reduce((s, x) => s + x.n, 0)} foot={d.trips_by_status.map((s) => `${s.label} ${s.n}`).join(' · ')} />
        <Kpi icon={Nfc} label="شرائح نشطة / عمليات تزويد" value={`${d.totals.tags} / ${n(d.totals.fuelings)}`} foot={`${d.totals.assets} أصل مسجل`} />
      </div>
      <Card className="mt" title="الشركات" flush><table className="t"><thead><tr><th>الشركة</th><th>النوع</th><th>المدينة</th><th>وثائق معلقة</th><th>الرحلات</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{d.companies.map((c) => <tr key={c.id}><td><b>{c.name_ar}</b><div className="tiny muted">س.ت {c.cr_number}</div></td><td>{{ client: 'عميل', carrier: 'ناقل', supplier: 'مورد' }[c.type]}</td><td>{c.city}</td><td>{c.pending_docs || '—'}</td><td>{c.trips}</td>
          <td><Chip tone={ST[c.status][1]}>{ST[c.status][0]}</Chip></td>
          <td><div className="row" style={{ gap: 4 }}>{c.status !== 'approved' && <button className="btn sm primary" onClick={() => act(`/admin/companies/${c.id}/approve`)}>اعتماد</button>}
            {c.status === 'approved' && <button className="btn sm danger" onClick={() => { const reason = prompt('سبب الإيقاف (تُحال الرحلات الجارية للمراجعة)'); if (reason) act(`/admin/companies/${c.id}/suspend`, { reason }); }}>إيقاف</button>}</div></td></tr>)}</tbody></table></Card>
      <Card className="mt" title="وثائق الأطراف وتواريخ الصلاحية" flush><table className="t"><thead><tr><th>الشركة</th><th>الوثيقة</th><th>الرقم</th><th>تنتهي</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{d.documents.map((x) => <tr key={x.id}><td>{x.company_name}</td><td>{DOC[x.doc_type] || x.doc_type}</td><td className="num">{x.number}</td>
          <td>{dOnly(x.expires_at)} {x.expires_at < soon && <Chip tone="warn">قريبًا</Chip>}</td><td><Chip tone={ST[x.status]?.[1]}>{ST[x.status]?.[0]}</Chip></td>
          <td>{x.status === 'pending' && <div className="row" style={{ gap: 4 }}><button className="btn sm primary" onClick={() => act(`/admin/documents/${x.id}/approve`)}>قبول</button><button className="btn sm danger" onClick={() => act(`/admin/documents/${x.id}/reject`)}>رفض</button></div>}</td></tr>)}</tbody></table></Card>
    </>
  );
}
