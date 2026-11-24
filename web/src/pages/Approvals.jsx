import React, { useState } from 'react';
import { api, useApi, navigate, liters, dt, fail, toast, EXC_TYPE } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, Alert } from '../ui.jsx';
import { Title, useMe, can } from '../ctx.jsx';

export default function Approvals() {
  const me = useMe();
  const r = useApi('/exceptions');
  const [sel, setSel] = useState(null);
  const [v, setV] = useState({ decision: 'approved', reason: '', accepted_liters: '' });
  if (!r.data) return <Spinner />;
  const open = r.data.filter((e) => e.status === 'open'), closed = r.data.filter((e) => e.status !== 'open');
  const link = (e) => e.ref_type === 'trip' ? '/trips/' + e.ref_id : e.ref_type === 'fueling' ? '/fuelings/' + e.ref_id : e.details?.trip_id ? '/trips/' + e.details.trip_id : e.details?.tank_id ? '/tanks/' + e.details.tank_id : null;
  const decide = async () => { try { await api(`/exceptions/${sel.id}/decide`, { method: 'POST', body: v }); toast('سُجّل القرار'); setSel(null); r.reload(); } catch (e) { fail(e); } };
  const row = (e) => (
    <tr key={e.id}>
      <td><Chip tone={e.status === 'open' ? 'warn' : e.status === 'approved' ? 'good' : 'bad'}>{EXC_TYPE[e.type] || e.type}</Chip></td>
      <td><b>{e.title}</b>{e.details?.note && <div className="small muted">{e.details.note}</div>}{e.details?.reasons && <div className="small" style={{ color: 'var(--bad)' }}>{e.details.reasons.map((x) => x.msg).join('، ')}</div>}
        {e.details?.missing && <div className="small muted">ناقص: {e.details.missing.length} صورة</div>}</td>
      <td className="small">{dt(e.created_at)}</td>
      <td className="small">{e.status === 'open' ? '—' : <>{e.decided_by_name} · {dt(e.decided_at)}<div className="muted">{e.decision_reason}</div></>}</td>
      <td><div className="row" style={{ gap: 4 }}>{link(e) && <button className="btn sm" onClick={() => navigate(link(e))}>فتح</button>}
        {e.status === 'open' && can(me, 'exception.decide') && <button className="btn sm primary" onClick={() => { setSel(e); setV({ decision: 'approved', reason: '', accepted_liters: e.details?.delivered_ml ? e.details.delivered_ml / 1000 : '' }); }}>قرار</button>}</div></td>
    </tr>
  );
  return (
    <>
      <Title sub="فروقات الكمية والمخزون، الإثباتات الناقصة، التحقق البديل، وتعارضات المزامنة">الموافقات والاستثناءات</Title>
      <Card title={`معلّقة (${open.length})`} flush>{open.length ? <div className="tscroll"><table className="t"><tbody>{open.map(row)}</tbody></table></div> : <Empty>لا توجد استثناءات معلقة</Empty>}</Card>
      <Card className="mt" title="المعالجة" flush>{closed.length ? <div className="tscroll"><table className="t"><tbody>{closed.map(row)}</tbody></table></div> : <Empty />}</Card>
      {sel && (
        <Modal title={sel.title} onClose={() => setSel(null)} footer={<button className="btn primary" onClick={decide}>تسجيل القرار</button>}>
          <div className="stack">
            {sel.type === 'stock_variance' && <Alert tone="info">الدفتري {liters(sel.details.book_ml, 1)} · الفعلي {liters(sel.details.measured_ml, 1)}. الموافقة تنشئ حركة تسوية بالفرق.</Alert>}
            <div className="row"><label className="row"><input type="radio" checked={v.decision === 'approved'} onChange={() => setV({ ...v, decision: 'approved' })} /> اعتماد</label><label className="row"><input type="radio" checked={v.decision === 'rejected'} onChange={() => setV({ ...v, decision: 'rejected' })} /> رفض</label></div>
            {sel.type === 'quantity_variance' && sel.ref_type === 'trip_stop' && v.decision === 'approved' && <Field label="الكمية المعتمدة للاستلام (لتر)" hint="تُسجل في المخزون بهذه الكمية"><input type="number" className="input" value={v.accepted_liters} onChange={(e) => setV({ ...v, accepted_liters: e.target.value })} /></Field>}
            <Field label="السبب (إلزامي، يُحفظ في سجل التدقيق)"><textarea className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
