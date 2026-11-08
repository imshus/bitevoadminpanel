// Refund requests from customers on the website (an order's "Request a refund": food quality, missing or wrong
// items…). Nothing is refunded until an admin approves a request here, choosing the amount and where it goes
// (BiteVo wallet, or back to UPI / card for orders paid online). Rejecting needs a note, which the customer sees.
// Refunds made from an order's page show here too, as approved. The website emails the customer the outcome.
import { useState } from 'react';
import { refundRequests as api } from '../api/index.js';
import { useApi, usePageTitle } from '../lib/useApi.js';
import { timeAgo, dateTime, money } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import { PageHeader, Badge, Segmented, SearchInput, Loading, ErrorState, EmptyState, Modal, Field } from '../components/ui.jsx';
import RefundForm from '../components/RefundForm.jsx';
import { Rupee } from '../components/Icons.jsx';

const STATUS = {
  pending: { label: 'To review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};
const FILTERS = [
  { value: 'pending', label: 'To review', match: r => r.status === 'pending' },
  { value: 'approved', label: 'Approved', match: r => r.status === 'approved' },
  { value: 'rejected', label: 'Rejected', match: r => r.status === 'rejected' },
  { value: 'all', label: 'All', match: () => true },
];
const whereTo = to => (to === 'source' ? 'UPI / card' : 'BiteVo wallet');

export default function RefundRequests() {
  usePageTitle('Refund requests');
  const toast = useToast();
  const { data, loading, refreshing, error, reload } = useApi(() => api.list());
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [deciding, setDeciding] = useState(null); // { request, kind: 'approve' | 'reject' }
  const [busy, setBusy] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const all = data || [];
  const q = query.trim().toLowerCase();
  const searched = all.filter(r => !q || `${r.orderNo} ${r.customerName} ${r.customerPhone} ${r.reasonLabel} ${r.details}`.toLowerCase().includes(q));
  const rows = searched.filter(FILTERS.find(f => f.value === filter).match);

  const decide = async action => {
    setBusy(true);
    try {
      await action();
      toast(deciding.kind === 'approve' ? `Refund for order ${deciding.request.orderNo} approved` : `Request for order ${deciding.request.orderNo} rejected`);
      setDeciding(null);
      setRejectNote('');
      reload();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  const r = deciding?.request;
  return (
    <>
      <PageHeader eyebrow="Customers" title="Refund requests"
        subtitle="From the website’s “Request a refund” on an order. Approve with the amount and where it goes, or reject with a note for the customer. Nothing is refunded until you approve." />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search order, customer or reason" />
        <Segmented label="Status" value={filter} onChange={setFilter}
          options={FILTERS.map(f => ({ value: f.value, label: f.label, count: searched.filter(f.match).length }))} />
      </div>

      <section className={`card${refreshing ? ' is-refreshing' : ''}`}>
        {loading ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
          <EmptyState icon={<Rupee />} title={filter === 'pending' ? 'No refund requests to review' : 'No refund requests here'}
            text={all.length ? 'Try another filter or search.' : 'Requests from customers’ order pages show up here.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>What went wrong</th>
                  <th>Asked for</th>
                  <th>Paid</th>
                  <th>Asked</th>
                  <th>Status</th>
                  <th className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(req => {
                  const st = STATUS[req.status] || STATUS.pending;
                  const paid = req.order?.paid;
                  return (
                    <tr key={req._id}>
                      <td className="nowrap">
                        <div className="cell-title">{req.orderNo}</div>
                        <div className="cell-sub">{req.order ? req.order.status : 'order deleted'}</div>
                      </td>
                      <td>
                        <div className="cell-title">{req.customerName}</div>
                        <div className="cell-sub nowrap">{req.customerPhone}</div>
                      </td>
                      <td>
                        <div>{req.reasonLabel}</div>
                        <div className="cell-sub" title={req.details}>{req.details?.length > 90 ? `${req.details.slice(0, 90)}…` : req.details}</div>
                      </td>
                      <td className="nowrap">
                        <div>{money(req.amount)}</div>
                        <div className="cell-sub">to {whereTo(req.to)}</div>
                      </td>
                      <td className="nowrap">
                        {paid ? (
                          <>
                            <div>{money(paid.total)}</div>
                            <div className="cell-sub">{[paid.online > 0 && `${money(paid.online)} online`, paid.wallet > 0 && `${money(paid.wallet)} wallet`, paid.cash > 0 && `${money(paid.cash)} cash`].filter(Boolean).join(' · ')}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td className="nowrap" title={dateTime(req.createdAt)}>{timeAgo(req.createdAt)}</td>
                      <td className="nowrap">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {req.decision && <div className="cell-sub">{money(req.decision.amount)} to {whereTo(req.decision.to)}</div>}
                        {req.decidedBy && <div className="cell-sub">by {req.decidedBy}</div>}
                        {req.status === 'rejected' && req.note && <div className="cell-sub" title={req.note}>“{req.note.slice(0, 40)}{req.note.length > 40 ? '…' : ''}”</div>}
                      </td>
                      <td className="actions-col">
                        {req.status === 'pending' && (
                          <div className="row-actions">
                            <button type="button" className="btn btn--sm btn--ghost" disabled={!req.order || Boolean(req.order.refund)} onClick={() => setDeciding({ request: req, kind: 'approve' })}>Approve</button>
                            <button type="button" className="btn btn--sm btn--ghost btn--ghost-danger" onClick={() => { setRejectNote(''); setDeciding({ request: req, kind: 'reject' }); }}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="footnote">Approving refunds straight away: to the customer’s BiteVo wallet, or back to UPI / card through Razorpay for orders paid online (the part paid from the wallet or in cash goes to the wallet). Each order can be refunded once.</p>

      <Modal open={Boolean(deciding)} onClose={() => !busy && setDeciding(null)}
        title={r ? `${deciding.kind === 'approve' ? 'Approve refund' : 'Reject refund'} · order ${r.orderNo}` : ''}>
        {r && (
          <div className="modal__body">
            <p><strong>{r.customerName}</strong>: {r.reasonLabel}. <span className="muted">“{r.details}”</span></p>
            <p className="muted">Asked for {money(r.amount)} to {whereTo(r.to)}.</p>
            {deciding.kind === 'approve' ? (
              <RefundForm paid={r.order.paid} amount={r.amount} to={r.to} noteLabel="Note for the customer (optional)" busy={busy} submitLabel="Refund"
                onCancel={() => setDeciding(null)}
                onSubmit={({ amount, to, note }) => decide(() => api.approve(r._id, { amount, to, note }))} />
            ) : (
              <form onSubmit={e => { e.preventDefault(); if (rejectNote.trim().length >= 5) decide(() => api.reject(r._id, rejectNote.trim())); }}>
                <Field label="Why? (the customer sees this)">
                  <textarea className="input" rows={3} maxLength={300} value={rejectNote} onChange={e => setRejectNote(e.target.value)} data-autofocus required />
                </Field>
                <div className="refund-form__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setDeciding(null)} disabled={busy}>Back</button>
                  <button type="submit" className="btn btn--danger" disabled={busy || rejectNote.trim().length < 5}>{busy ? 'Saving…' : 'Reject request'}</button>
                </div>
              </form>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
