// The refund form: how much, and where it goes (BiteVo wallet at once, or back to the customer's UPI / card
// through Razorpay for orders paid online). Used to approve a customer's refund request (pages/RefundRequests.jsx)
// and to refund a delivered or cancelled order from its page (pages/Orders.jsx).
import { useState } from 'react';
import { Field } from './ui.jsx';
import { money } from '../lib/format.js';

/**
 * paid         { online, wallet, cash, total } what the customer paid, by how (from the API)
 * amount, to   the starting amount and destination (a request's)
 * noteLabel    the text box's label; noteRequired: it can't be empty
 * onSubmit({ amount, to, note }), busy, submitLabel, onCancel
 */
export default function RefundForm({ paid, amount: startAmount, to: startTo, noteLabel, noteHint, noteRequired, onSubmit, onCancel, busy, submitLabel }) {
  const canSource = paid.online > 0;
  const [amount, setAmount] = useState(String(startAmount ?? paid.total));
  const [to, setTo] = useState(canSource && startTo === 'source' ? 'source' : canSource && startTo === undefined ? 'source' : 'wallet');
  const [note, setNote] = useState('');
  const value = Number(amount);
  const amountOk = value >= 1 && value <= paid.total;
  const sourcePart = to === 'source' ? Math.min(value || 0, paid.online) : 0;
  const walletPart = Math.max(0, (value || 0) - sourcePart);

  return (
    <form className="refund-form" onSubmit={e => { e.preventDefault(); if (amountOk && (!noteRequired || note.trim().length >= 3)) onSubmit({ amount: value, to, note: note.trim() }); }}>
      <p className="muted">
        Paid {money(paid.total)}: {[paid.online > 0 && `${money(paid.online)} online`, paid.wallet > 0 && `${money(paid.wallet)} from wallet`, paid.cash > 0 && `${money(paid.cash)} in cash`].filter(Boolean).join(', ')}.
      </p>
      <Field label={`Amount (up to ${money(paid.total)})`} error={amount && !amountOk ? `Enter ₹1 to ${money(paid.total)}` : null}>
        <input className="input" type="number" min={1} max={paid.total} step="1" value={amount} onChange={e => setAmount(e.target.value)} data-autofocus required />
      </Field>
      <fieldset className="refund-form__to">
        <legend>Refund to</legend>
        <label className={`refund-form__opt${to === 'wallet' ? ' is-on' : ''}`}>
          <input type="radio" name="refund-to" checked={to === 'wallet'} onChange={() => setTo('wallet')} />
          <span><strong>BiteVo wallet</strong><small>Straight away</small></span>
        </label>
        <label className={`refund-form__opt${to === 'source' ? ' is-on' : ''}${canSource ? '' : ' is-off'}`}>
          <input type="radio" name="refund-to" checked={to === 'source'} disabled={!canSource} onChange={() => setTo('source')} />
          <span><strong>Original payment (UPI / card)</strong><small>{canSource ? 'Through Razorpay, 5–7 working days' : 'Not paid online: cash and wallet refunds go to the wallet'}</small></span>
        </label>
      </fieldset>
      {to === 'source' && amountOk && walletPart > 0 && (
        <p className="muted">{money(sourcePart)} goes back to UPI / card and {money(walletPart)} (paid from the wallet{paid.cash > 0 ? ' or in cash' : ''}) to the BiteVo wallet.</p>
      )}
      <Field label={noteLabel} hint={noteHint}>
        <textarea className="input" rows={2} maxLength={300} value={note} onChange={e => setNote(e.target.value)} required={noteRequired} />
      </Field>
      <div className="refund-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Back</button>
        <button type="submit" className="btn btn--primary" disabled={busy || !amountOk || (noteRequired && note.trim().length < 3)}>
          {busy ? 'Refunding…' : `${submitLabel} ${amountOk ? money(value) : ''}`}
        </button>
      </div>
    </form>
  );
}
