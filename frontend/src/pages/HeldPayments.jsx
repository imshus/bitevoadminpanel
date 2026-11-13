// Payments without an order: online payments (UPI / card through Razorpay) whose BiteVo order wasn't placed, e.g.
// the bill changed after paying, or the customer closed the website or app before the order went through. The
// website never refunds these itself; an admin refunds each one here, back to UPI / card or to the BiteVo
// wallet, or marks it refunded if it was done in the Razorpay dashboard. The customer sees it on their Refunds page.
import { useState } from 'react';
import { heldPayments as api } from '../api/index.js';
import { useApi, usePageTitle } from '../lib/useApi.js';
import { timeAgo, dateTime, money } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import { PageHeader, Badge, Segmented, SearchInput, Loading, ErrorState, EmptyState, Modal, Field } from '../components/ui.jsx';
import { Wallet } from '../components/Icons.jsx';

const STATUS = {
  held: { label: 'To refund', tone: 'warning' },
  refunding: { label: 'Refund not confirmed', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'good' },
};
const isOpen = p => p.status === 'held' || p.status === 'refunding';
const FILTERS = [
  { value: 'open', label: 'To refund', match: isOpen },
  { value: 'refunded', label: 'Refunded', match: p => p.status === 'refunded' },
  { value: 'all', label: 'All', match: () => true },
];

function RefundPaymentForm({ payment, busy, onSubmit, onCancel }) {
  const [to, setTo] = useState('source');
  const [note, setNote] = useState('');
  return (
    <form className="refund-form" onSubmit={e => { e.preventDefault(); onSubmit({ to, note: note.trim() }); }}>
      <fieldset className="refund-form__to">
        <legend>Refund to</legend>
        <label className={`refund-form__opt${to === 'source' ? ' is-on' : ''}`}>
          <input type="radio" name="held-to" checked={to === 'source'} onChange={() => setTo('source')} />
          <span><strong>Back to {payment.method}</strong><small>Through Razorpay, 5–7 working days</small></span>
        </label>
        <label className={`refund-form__opt${to === 'wallet' ? ' is-on' : ''}`}>
          <input type="radio" name="held-to" checked={to === 'wallet'} onChange={() => setTo('wallet')} />
          <span><strong>BiteVo wallet</strong><small>Straight away</small></span>
        </label>
      </fieldset>
      <Field label="Note for the customer (optional)" hint="Shown on their Refunds page">
        <textarea className="input" rows={2} maxLength={300} value={note} onChange={e => setNote(e.target.value)} />
      </Field>
      <div className="refund-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Back</button>
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Refunding…' : `Refund ${money(payment.amount)}`}</button>
      </div>
    </form>
  );
}

export default function HeldPayments() {
  usePageTitle('Payments without an order');
  const toast = useToast();
  const { data, loading, refreshing, error, reload } = useApi(() => api.list());
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');
  const [acting, setActing] = useState(null); // { payment, kind: 'refund' | 'mark' }
  const [busy, setBusy] = useState(false);
  const [markNote, setMarkNote] = useState('');

  const all = data || [];
  const q = query.trim().toLowerCase();
  const searched = all.filter(p => !q || `${p.customerName} ${p.customerPhone} ${p.paymentId} ${p._id} ${p.reason}`.toLowerCase().includes(q));
  const rows = searched.filter(FILTERS.find(f => f.value === filter).match);

  const run = async (action, done) => {
    setBusy(true);
    try {
      await action();
      toast(done);
      setActing(null);
      setMarkNote('');
      reload();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  const p = acting?.payment;
  return (
    <>
      <PageHeader eyebrow="Customers" title="Payments without an order"
        subtitle="Online payments whose order wasn’t placed (the order failed after paying, or the customer closed the website or app). Nothing is refunded automatically: refund each one here." />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search customer, phone or payment ID" />
        <Segmented label="Status" value={filter} onChange={setFilter}
          options={FILTERS.map(f => ({ value: f.value, label: f.label, count: searched.filter(f.match).length }))} />
      </div>

      <section className={`card${refreshing ? ' is-refreshing' : ''}`}>
        {loading ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
          <EmptyState icon={<Wallet />} title={filter === 'open' ? 'No payments to refund' : 'No payments here'}
            text={all.length ? 'Try another filter or search.' : 'Online payments that didn’t become an order show up here.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Paid</th>
                  <th>Why no order</th>
                  <th>When</th>
                  <th>Status</th>
                  <th className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(pay => {
                  const st = STATUS[pay.status] || STATUS.held;
                  return (
                    <tr key={pay._id}>
                      <td>
                        <div className="cell-title">{pay.customerName || 'Customer'}</div>
                        <div className="cell-sub nowrap">{pay.customerPhone}</div>
                      </td>
                      <td className="nowrap">
                        <div>{money(pay.amount)}</div>
                        <div className="cell-sub" title={pay._id}>{pay.method}{pay.paymentId ? ` · ${pay.paymentId}` : ''}</div>
                      </td>
                      <td>
                        <div className="cell-sub" title={pay.reason}>{pay.reason ? (pay.reason.length > 90 ? `${pay.reason.slice(0, 90)}…` : pay.reason) : '—'}</div>
                      </td>
                      <td className="nowrap" title={dateTime(pay.heldAt || pay.createdAt)}>{timeAgo(pay.heldAt || pay.createdAt)}</td>
                      <td className="nowrap">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {pay.status === 'refunded' && <div className="cell-sub">to {pay.refundTo === 'wallet' ? 'BiteVo wallet' : pay.method}{pay.refundedBy ? ` · by ${pay.refundedBy}` : ''}</div>}
                        {pay.refundNote && <div className="cell-sub" title={pay.refundNote}>“{pay.refundNote.slice(0, 40)}{pay.refundNote.length > 40 ? '…' : ''}”</div>}
                      </td>
                      <td className="actions-col">
                        {isOpen(pay) && (
                          <div className="row-actions">
                            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setActing({ payment: pay, kind: 'refund' })}>Refund</button>
                            <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setMarkNote(''); setActing({ payment: pay, kind: 'mark' }); }}>Already refunded</button>
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
      <p className="footnote">Each payment is refunded once, in full. “Already refunded” is for a refund made in the Razorpay dashboard: it records it without sending money.</p>

      <Modal open={Boolean(acting)} onClose={() => !busy && setActing(null)}
        title={p ? `${acting.kind === 'refund' ? 'Refund payment' : 'Mark as refunded'} · ${money(p.amount)}` : ''}>
        {p && (
          <div className="modal__body">
            <p><strong>{p.customerName || 'Customer'}</strong> {p.customerPhone && <span className="muted">· {p.customerPhone}</span>}</p>
            <p className="muted">Paid {money(p.amount)} by {p.method} {timeAgo(p.heldAt || p.createdAt)}. {p.reason}</p>
            {acting.kind === 'refund' ? (
              <RefundPaymentForm payment={p} busy={busy} onCancel={() => setActing(null)}
                onSubmit={({ to, note }) => run(() => api.refund(p._id, { to, note }), `${money(p.amount)} refunded to ${to === 'wallet' ? 'the BiteVo wallet' : p.method}`)} />
            ) : (
              <form onSubmit={e => { e.preventDefault(); if (markNote.trim().length >= 3) run(() => api.markRefunded(p._id, markNote.trim()), 'Marked as refunded'); }}>
                <Field label="Where was it refunded?" hint="For the team only, e.g. Razorpay dashboard, rfnd_…">
                  <textarea className="input" rows={2} maxLength={300} value={markNote} onChange={e => setMarkNote(e.target.value)} data-autofocus required />
                </Field>
                <div className="refund-form__actions">
                  <button type="button" className="btn btn--ghost" onClick={() => setActing(null)} disabled={busy}>Back</button>
                  <button type="submit" className="btn btn--primary" disabled={busy || markNote.trim().length < 3}>{busy ? 'Saving…' : 'Mark as refunded'}</button>
                </div>
              </form>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
