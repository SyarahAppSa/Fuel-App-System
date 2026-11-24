import React, { useState } from 'react';
import { Plus, Link2, ShieldAlert } from 'lucide-react';
import { api, useApi, liters, dt, fail, toast, TAG_TONE, VERIFY } from '../lib.js';
import { Card, Chip, Spinner, Empty, Modal, Field, NfcReader, Alert } from '../ui.jsx';
import { Title, useMe } from '../ctx.jsx';

const ST = { in_custody: 'في العهدة', pending_activation: 'بانتظار التفعيل', active: 'نشطة', suspended: 'موقوفة', lost: 'مفقودة', damaged: 'تالفة', replaced: 'مستبدلة' };

export default function NfcTags() {
  const me = useMe();
  const r = useApi('/nfc-tags');
  const assets = useApi('/assets');
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('');
  if (!r.data) return <Spinner />;
  const { tags, counts, rejected, alt_verifications } = r.data;
  const act = async (t, action, body = {}) => {
    try { await api(`/nfc-tags/${t.id}/${action}`, { method: 'POST', body }); toast('تم'); setModal(null); r.reload(); assets.reload(); } catch (e) { fail(e); }
  };
  const list = filter ? tags.filter((t) => t.status === filter) : tags;
  const demoTags = tags.map((t) => ({ ...t, status_ar: ST[t.status] }));
  return (
    <>
      <Title sub="إصدار، ربط، تفعيل، إيقاف، استبدال — مع سجل كامل">شرائح NFC</Title>
      <div className="filters">
        <button className={'chip ' + (!filter ? 'dark' : '')} onClick={() => setFilter('')}>الكل {tags.length}</button>
        {Object.entries(ST).map(([k, l]) => counts[k] ? <button key={k} className={'chip ' + (filter === k ? 'dark' : TAG_TONE[k])} onClick={() => setFilter(k)}>{l} {counts[k]}</button> : null)}
        <div className="grow" />
        <button className="btn" onClick={() => setModal({ type: 'batch' })}><Plus size={15} /> دفعة شرائح</button>
        <button className="btn primary" onClick={() => setModal({ type: 'bind' })}><Link2 size={15} /> ربط شريحة بأصل</button>
      </div>
      <Card flush><div className="tscroll"><table className="t">
        <thead><tr><th>الرقم الإداري</th><th>المعرف التقني</th><th>الدفعة</th><th>الأصل</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{list.map((t) => (
          <tr key={t.id}><td><b>{t.display_no}</b></td><td className="num small">{t.uid}</td><td className="small">{t.batch_no || '—'}</td>
            <td>{t.asset_code ? <><b>{t.asset_code}</b> <span className="small muted">{t.asset_name}</span></> : <span className="muted">—</span>}</td>
            <td><Chip tone={TAG_TONE[t.status]}>{ST[t.status]}</Chip></td>
            <td><div className="row" style={{ gap: 4 }}>
              {t.status === 'pending_activation' && <button className="btn sm" onClick={() => act(t, 'activate')}>تفعيل</button>}
              {t.status === 'active' && <><button className="btn sm" onClick={() => act(t, 'suspend')}>إيقاف</button><button className="btn sm" onClick={() => setModal({ type: 'replace', tag: t })}>استبدال</button></>}
              {t.status === 'suspended' && <button className="btn sm" onClick={() => act(t, 'reactivate')}>إعادة تفعيل</button>}
              {['active', 'suspended', 'pending_activation', 'in_custody'].includes(t.status) && <><button className="btn sm danger" onClick={() => { const reason = prompt('سبب الإبلاغ عن الفقد'); if (reason !== null) act(t, 'lost', { reason }); }}>مفقودة</button><button className="btn sm danger" onClick={() => act(t, 'damaged')}>تالفة</button></>}
            </div></td></tr>))}</tbody></table></div></Card>

      <div className="grid g2 mt">
        <Card title="محاولات تفويض مرفوضة" icon={<ShieldAlert size={16} color="var(--bad)" />} flush>
          {rejected.length ? <table className="t"><tbody>{rejected.map((e) => <tr key={e.id}><td className="small">{dt(e.at)}</td><td>{e.display_no || <span className="num small">{e.uid}</span>}<div className="tiny muted">{e.asset_code}</div></td><td className="small" style={{ color: 'var(--bad)' }}>{e.reason}</td><td className="small muted">{e.by_name}</td></tr>)}</tbody></table> : <Empty />}
        </Card>
        <Card title="عمليات بتحقق بديل (QR / يدوي)" flush>
          {alt_verifications.length ? <table className="t"><tbody>{alt_verifications.map((e) => <tr key={e.number}><td className="num">{e.number}</td><td>{e.asset_code}</td><td><Chip tone="warn">{VERIFY[e.verification]}</Chip></td><td className="small">{dt(e.created_at)}</td><td className="small muted">{e.operator_name}</td></tr>)}</tbody></table> : <Empty />}
        </Card>
      </div>

      {modal?.type === 'batch' && <BatchModal onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); }} />}
      {modal?.type === 'bind' && <BindModal assets={assets.data || []} demoTags={demoTags.filter((t) => ['in_custody', 'pending_activation'].includes(t.status))} onClose={() => setModal(null)} onDone={() => { setModal(null); r.reload(); assets.reload(); }} />}
      {modal?.type === 'replace' && (
        <Modal title={`استبدال ${modal.tag.display_no} (${modal.tag.asset_code})`} onClose={() => setModal(null)}>
          <Alert tone="info">تُعطَّل الشريحة القديمة وتُفعَّل الجديدة على نفس الأصل، ويبقى سجل الأصل كاملًا.</Alert>
          <div className="mt"><NfcReader label="اقرأ الشريحة الجديدة" demoTags={demoTags.filter((t) => t.status === 'in_custody')} onRead={(uid) => act(modal.tag, 'replace', { new_uid: uid })} /></div>
        </Modal>
      )}
    </>
  );
}

function BatchModal({ onClose, onDone }) {
  const [v, setV] = useState({ batch_no: 'B-' + new Date().toISOString().slice(0, 7), count: 10, uids: '' });
  const save = async () => { try { const r = await api('/nfc-tags/batch', { method: 'POST', body: { batch_no: v.batch_no, count: v.count, uids: v.uids.split(/[\s,]+/).filter(Boolean) } }); toast(`أُضيفت ${r.created} شريحة للعهدة`); onDone(); } catch (e) { fail(e); } };
  return (
    <Modal title="إنشاء دفعة شرائح" onClose={onClose} footer={<button className="btn primary" onClick={save}>إنشاء</button>}>
      <div className="stack">
        <Field label="رقم الدفعة"><input className="input" value={v.batch_no} onChange={(e) => setV({ ...v, batch_no: e.target.value })} /></Field>
        <Field label="أرقام الشرائح (UID) من المورد" hint="سطر لكل شريحة. اتركه فارغًا لإنشاء معرفات تجريبية بالعدد أدناه"><textarea className="input" rows={4} style={{ direction: 'ltr' }} value={v.uids} onChange={(e) => setV({ ...v, uids: e.target.value })} /></Field>
        {!v.uids && <Field label="العدد"><input type="number" className="input" value={v.count} onChange={(e) => setV({ ...v, count: e.target.value })} /></Field>}
        <div className="small muted">تُسجّل الشرائح «في العهدة» باسمك. المعرف التقني لا يحمل أي بيانات عن العميل أو المعدة.</div>
      </div>
    </Modal>
  );
}

function BindModal({ assets, demoTags, onClose, onDone }) {
  const [asset, setAsset] = useState(''); const [confirm, setConfirm] = useState(''); const [uid, setUid] = useState(''); const [test, setTest] = useState(true);
  const a = assets.find((x) => x.id === asset);
  const save = async () => { try { const r = await api('/nfc-tags/bind', { method: 'POST', body: { uid, asset_id: asset, asset_code_confirm: confirm, test_read_ok: test } }); toast(r.status === 'active' ? 'رُبطت الشريحة وفُعّلت بعد اختبار القراءة' : 'رُبطت الشريحة بانتظار التفعيل'); onDone(); } catch (e) { fail(e); } };
  return (
    <Modal title="ربط شريحة بأصل" onClose={onClose} wide footer={<button className="btn primary" disabled={!asset || !uid} onClick={save}>تأكيد الربط</button>}>
      <div className="grid g2">
        <div className="stack">
          <Field label="1. اختر الأصل"><select className="input" value={asset} onChange={(e) => setAsset(e.target.value)}><option value="">—</option>{assets.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}{x.tag_display_no ? ' (لها شريحة)' : ''}</option>)}</select></Field>
          {a && <Field label="2. تحقق من الرقم الداخلي أو التسلسلي المكتوب على المعدة" hint={`المتوقع: ${a.code} أو ${a.plate_or_serial}`}><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>}
          <label className="row small"><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> نجح اختبار القراءة بعد التركيب (تفعيل فوري)</label>
          {uid && <Alert tone="good">الشريحة المقروءة: <b className="num">{uid}</b></Alert>}
        </div>
        <NfcReader label="3. اقرأ الشريحة المركبة" demoTags={demoTags} onRead={setUid} compact />
      </div>
    </Modal>
  );
}
