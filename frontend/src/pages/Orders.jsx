import { useEffect, useState } from 'react';
import { orders as api, agents as agentApi, settings as settingsApi } from '../api/index.js';
import { useApi, usePageTitle } from '../lib/useApi.js';
import { money, num, timeAgo, dateTime } from '../lib/format.js';
import { ORDER_STATUS, AGENT_STATUS } from '../lib/status.js';
import { useToast } from '../components/Toast.jsx';
import { PageHeader, Badge, Segmented, SearchInput, Modal, Loading, ErrorState, EmptyState, StatTile, Pagination, Field } from '../components/ui.jsx';
import { Bag, Flame, Clock, Check, XCircle, Refresh, Ticket, Wallet } from '../components/Icons.jsx';

const PAGE_SIZE = 20;
const AUTO_REFRESH_MS = 30000;
const LIVE = ['placed', 'preparing', 'out_for_delivery'];

// The next step for a live order, and the button that moves it there.
const NEXT_ACTION = {
  placed: 'Accept order',
  preparing: 'Send out for delivery',
  out_for_delivery: 'Mark delivered',
};


const RANGES = [
  { value: 1, label: 'Today' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'live', label: 'Live', match: o => LIVE.includes(o.status) },
  ...Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label, match: o => o.status === value })),
];

const itemsSummary = o => `${o.items[0].qty > 1 ? `${o.items[0].qty} × ` : ''}${o.items[0].name}`;
const itemCount = o => o.items.reduce((s, it) => s + it.qty, 0);
const minsAfter = (iso, mins) => new Date(Date.parse(iso) + mins * 60000).toISOString();

function Timeline({ order }) {
  const s = order.status;
  const reached = step => LIVE.indexOf(s) >= LIVE.indexOf(step) || s === 'delivered';
  const steps = [
    { label: 'Order placed', at: order.placedAt, done: true },
    { label: 'Accepted by the kitchen', at: minsAfter(order.placedAt, 2), done: s !== 'cancelled' && reached('preparing') },
    { label: 'Out for delivery', at: minsAfter(order.placedAt, 15), done: s !== 'cancelled' && reached('out_for_delivery') },
    s === 'cancelled'
      ? { label: `Cancelled${order.cancelReason ? `: ${order.cancelReason}` : ''}`, at: order.cancelledAt || minsAfter(order.placedAt, 10), done: true, bad: true }
      : { label: 'Delivered', at: order.deliveryMins ? minsAfter(order.placedAt, order.deliveryMins) : null, done: s === 'delivered' },
  ];
  return (
    <ol className="timeline">
      {steps.map(step => (
        <li key={step.label} className={`${step.done ? 'is-done' : ''}${step.bad ? ' is-bad' : ''}`}>
          <span className="timeline__dot">{step.bad ? <XCircle size={12} /> : step.done ? <Check size={12} /> : null}</span>
          <span className="timeline__label">{step.label}</span>
          {step.done && step.at && <span className="timeline__at">{dateTime(step.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

function CancelPanel({ order, reasons, onCancel, onBack, busy }) {
  const prepaid = order.paymentMethod !== 'Cash on delivery';
  const [reason, setReason] = useState(reasons[0]);
  const [refundTo, setRefundTo] = useState(prepaid ? 'wallet' : order.walletUsed ? 'wallet' : 'none');
  const paid = prepaid ? order.total : order.walletUsed;

  return (
    <div className="cancel-panel">
      <h3>Cancel order {order.orderNo}</h3>
      <Field label="Reason">
        <select className="input" value={reason} onChange={e => setReason(e.target.value)}>
          {reasons.map(r => <option key={r}>{r}</option>)}
        </select>
      </Field>
      {paid > 0 ? (
        <Field label={`Refund ${money(paid)}`}>
          <Segmented
            label="Refund to"
            value={refundTo}
            onChange={setRefundTo}
            options={[
              { value: 'wallet', label: 'BiteVo wallet (instant)' },
              ...(prepaid && order.paymentMethod !== 'Wallet' ? [{ value: 'source', label: `${order.paymentMethod} (3–5 days)` }] : []),
              { value: 'none', label: 'No refund' },
            ]}
          />
        </Field>
      ) : (
        <p className="muted">Cash on delivery and nothing was paid yet, so there’s nothing to refund.</p>
      )}
      <div className="cancel-panel__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack} disabled={busy}>Keep order</button>
        <button type="button" className="btn btn--danger" onClick={() => onCancel(reason, paid > 0 ? refundTo : 'none')} disabled={busy}>
          {busy ? 'Cancelling…' : 'Cancel order'}
        </button>
      </div>
    </div>
  );
}

function OrderDetails({ id, onChanged }) {
  const toast = useToast();
  const { data: order, loading, error, reload } = useApi(() => api.get(id), [id]);
  const { data: agentList } = useApi(() => agentApi.list());
  const { data: settings } = useApi(() => settingsApi.get());
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [agentId, setAgentId] = useState('');

  const currentAgent = order?.agentId || '';
  useEffect(() => setAgentId(currentAgent), [currentAgent]);

  if (loading) return <div className="modal__body"><Loading /></div>;
  if (error && !order) return <div className="modal__body"><ErrorState error={error} onRetry={reload} /></div>;

  const live = LIVE.includes(order.status);
  const st = ORDER_STATUS[order.status];
  const available = (agentList || []).filter(a => a.isActive && a.kycStatus === 'verified');

  const run = async (action, message) => {
    setBusy(true);
    try {
      await action();
      toast(message);
      await reload();
      onChanged();
      setCancelling(false);
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(false);
    }
  };

  const next = NEXT_ACTION[order.status];

  return (
    <>
      <div className="modal__body order-details">
        <div className="order-details__top">
          <Badge tone={st.tone}>{st.label}</Badge>
          <span className="muted">Placed {dateTime(order.placedAt)} · {timeAgo(order.placedAt)}</span>
        </div>

        <div className="order-details__grid">
          <section>
            <h3>Customer</h3>
            <p><strong>{order.customerName}</strong></p>
            <p className="muted">{order.customerPhone}</p>
          </section>
          <section>
            <h3>Payment</h3>
            <p><strong>{order.paymentMethod}</strong></p>
            {order.walletUsed > 0 && order.paymentMethod !== 'Wallet' && <p className="muted">{money(order.walletUsed)} paid from wallet</p>}
            {order.refund && <p className="muted">Refunded {money(order.refund.amount)} to {order.refund.to === 'wallet' ? 'BiteVo wallet' : 'original payment'}</p>}
          </section>
        </div>

        <section>
          <h3>Items ({itemCount(order)})</h3>
          <table className="bill">
            <tbody>
              {order.items.map(it => (
                <tr key={it.productId}>
                  <td>{it.qty} × {it.name}</td>
                  <td className="num">{money(it.price * it.qty)}</td>
                </tr>
              ))}
              <tr className="bill__sub"><td>Item total</td><td className="num">{money(order.subtotal)}</td></tr>
              <tr className="bill__sub"><td>Delivery fee</td><td className="num">{order.deliveryFee ? money(order.deliveryFee) : 'Free'}</td></tr>
              {(order.couponCode || order.discount > 0) && (
                <tr className="bill__sub">
                  {/* Without a coupon the discount is a website offer, e.g. the first order's free Cold Coffee. */}
                  <td><Ticket size={14} /> {order.couponCode ? <>Coupon <code className="code">{order.couponCode}</code></> : 'Offers'}</td>
                  <td className="num">{order.discount ? `− ${money(order.discount)}` : '—'}</td>
                </tr>
              )}
              <tr className="bill__total"><td>Total</td><td className="num">{money(order.total)}</td></tr>
              {/* Wallet money already paid part of the total; the rest is collected at the door (or was paid online). */}
              {order.walletUsed > 0 && order.paymentMethod !== 'Wallet' && (
                <>
                  <tr className="bill__sub"><td><Wallet size={14} /> Paid from wallet</td><td className="num">− {money(order.walletUsed)}</td></tr>
                  <tr className="bill__total">
                    <td>{order.paymentMethod === 'Cash on delivery' ? 'To collect on delivery' : `Paid online (${order.paymentMethod})`}</td>
                    <td className="num">{money(Math.max(0, order.total - order.walletUsed))}</td>
                  </tr>
                </>
              )}
              {order.cashback > 0 && (
                <tr className="bill__sub"><td><Wallet size={14} /> Wallet cashback {order.status === 'delivered' ? 'credited' : 'after delivery'}</td><td className="num">{money(order.cashback)}</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <div className="order-details__grid">
          <section>
            <h3>Delivery</h3>
            {live ? (
              <div className="assign">
                <select className="input" value={agentId} onChange={e => setAgentId(e.target.value)} aria-label="Delivery agent">
                  <option value="">Not assigned</option>
                  {available.map(a => (
                    <option key={a._id} value={a._id}>{a.name} · {AGENT_STATUS[a.status].label}</option>
                  ))}
                </select>
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy || !agentId || agentId === order.agentId}
                  onClick={() => run(() => api.assign(order._id, agentId), `Assigned to ${available.find(a => a._id === agentId)?.name}`)}>
                  {order.agentId ? 'Reassign' : 'Assign'}
                </button>
              </div>
            ) : (
              <p>{order.agentName ? <strong>{order.agentName}</strong> : <span className="muted">No agent</span>}</p>
            )}
            {order.status === 'delivered' && order.deliveryMins && <p className="muted">Delivered in {order.deliveryMins} min{order.rating ? ` · rated ${order.rating}★` : ''}</p>}
          </section>
          <section>
            <h3>Progress</h3>
            <Timeline order={order} />
          </section>
        </div>

        {order.history?.length > 0 && (
          <section>
            <h3>Admin activity</h3>
            <ul className="activity">
              {order.history.map((h, i) => (
                <li key={i}>
                  <span>{h.status === 'assigned' ? `Assigned to ${h.note}` : h.status === 'cancelled' ? `Cancelled: ${h.note}` : `Marked ${ORDER_STATUS[h.status]?.label.toLowerCase()}`}</span>
                  <span className="muted">{h.by} · {timeAgo(h.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {cancelling && settings && (
          <CancelPanel order={order} reasons={settings.cancelReasons} busy={busy} onBack={() => setCancelling(false)}
            onCancel={(reason, refundTo) => run(() => api.cancel(order._id, { reason, refundTo }), `Order ${order.orderNo} cancelled`)} />
        )}
      </div>

      {live && !cancelling && (
        <div className="modal__foot modal__foot--split">
          <button type="button" className="btn btn--ghost btn--ghost-danger" onClick={() => setCancelling(true)} disabled={busy}>Cancel order</button>
          <button type="button" className="btn btn--primary" disabled={busy}
            onClick={() => run(() => api.advance(order._id), `${order.orderNo}: ${ORDER_STATUS[{ placed: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered' }[order.status]].label.toLowerCase()}`)}>
            {busy ? 'Saving…' : next}
          </button>
        </div>
      )}
    </>
  );
}

export default function Orders() {
  usePageTitle('Orders');
  const toast = useToast();
  const [days, setDays] = useState(1);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [advancing, setAdvancing] = useState(null);
  const { data, loading, refreshing, error, reload } = useApi(() => api.list({ days }), [days]);

  useEffect(() => {
    const timer = setInterval(reload, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => setPage(1), [days, status, query]);

  const all = data || [];
  const q = query.trim().toLowerCase();
  const searched = all.filter(o => !q || `${o.orderNo} ${o.customerName} ${o.customerPhone} ${o.agentName || ''}`.toLowerCase().includes(q));
  const rows = searched.filter(STATUS_FILTERS.find(f => f.value === status).match);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const count = key => all.filter(o => o.status === key).length;

  // Quick action from the table; sending out without an agent opens the order instead.
  const quickAdvance = async o => {
    if (o.status === 'preparing' && !o.agentId) return setOpenId(o._id);
    setAdvancing(o._id);
    try {
      const updated = await api.advance(o._id);
      toast(`${o.orderNo}: ${ORDER_STATUS[updated.status].label.toLowerCase()}`);
      await reload();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setAdvancing(null);
    }
  };

  const openOrder = all.find(o => o._id === openId);

  return (
    <>
      <PageHeader eyebrow="Orders" title="Order management" subtitle="Accept, dispatch and track every order. New orders appear automatically.">
        <button className="btn btn--outline" onClick={reload} disabled={refreshing}><Refresh size={18} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </PageHeader>

      <div className="stats">
        <StatTile icon={<Clock size={18} />} label="New, waiting to accept" value={num(count('placed'))} hint="Accept them quickly" />
        <StatTile icon={<Flame size={18} />} label="In the kitchen or on the way" value={num(count('preparing') + count('out_for_delivery'))} hint={`${count('out_for_delivery')} out for delivery`} />
        <StatTile icon={<Check size={18} />} label="Delivered" value={num(count('delivered'))} hint={RANGES.find(r => r.value === days).label} />
        <StatTile icon={<XCircle size={18} />} label="Cancelled" value={num(count('cancelled'))} hint={RANGES.find(r => r.value === days).label} />
      </div>

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search order, customer or agent" />
        <select className="input input--auto" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Date range">
          {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <Segmented label="Status" value={status} onChange={setStatus}
          options={STATUS_FILTERS.map(f => ({ value: f.value, label: f.label, count: searched.filter(f.match).length }))} />
      </div>

      <section className={`card${refreshing ? ' is-refreshing' : ''}`}>
        {loading ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
          <EmptyState icon={<Bag />} title="No orders here" text="Try a different status, date range or search." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th className="num">Amount</th>
                    <th>Agent</th>
                    <th>Status</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(o => {
                    const st = ORDER_STATUS[o.status];
                    return (
                      <tr key={o._id} className={o.status === 'placed' ? 'is-new' : undefined}>
                        <td className="nowrap">
                          <button type="button" className="order-link mono" onClick={() => setOpenId(o._id)}>{o.orderNo}</button>
                          <div className="cell-sub" title={dateTime(o.placedAt)}>{timeAgo(o.placedAt)}</div>
                        </td>
                        <td className="nowrap">
                          <div className="cell-title">{o.customerName}</div>
                          <div className="cell-sub">{o.customerPhone}</div>
                        </td>
                        <td>
                          <div>{itemsSummary(o)}{o.items.length > 1 && <span className="muted"> + {o.items.length - 1} more</span>}</div>
                          <div className="cell-sub">{itemCount(o)} item{itemCount(o) > 1 ? 's' : ''}</div>
                        </td>
                        <td className="num nowrap">
                          <strong>{money(o.total)}</strong>
                          <div className="cell-sub">
                            {o.walletUsed > 0 && o.paymentMethod !== 'Wallet'
                              ? `${money(o.walletUsed)} wallet · ${money(Math.max(0, o.total - o.walletUsed))} ${o.paymentMethod === 'Cash on delivery' ? 'cash' : o.paymentMethod}`
                              : o.paymentMethod}
                            {o.couponCode ? ` · ${o.couponCode}` : ''}
                          </div>
                        </td>
                        <td className="nowrap">{o.agentName || <span className="muted">Not assigned</span>}</td>
                        <td className="nowrap">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {o.refund && <div className="cell-sub">Refunded to {o.refund.to === 'wallet' ? 'wallet' : 'source'}</div>}
                        </td>
                        <td className="actions-col">
                          <div className="row-actions">
                            {NEXT_ACTION[o.status] && (
                              <button type="button" className="btn btn--primary btn--sm" onClick={() => quickAdvance(o)} disabled={advancing === o._id}>
                                {advancing === o._id ? 'Saving…' : { placed: 'Accept', preparing: 'Send out', out_for_delivery: 'Delivered' }[o.status]}
                              </button>
                            )}
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpenId(o._id)} aria-label={`View order ${o.orderNo}`}>View</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} />
          </>
        )}
      </section>

      <Modal open={Boolean(openId)} onClose={() => setOpenId(null)} title={openOrder ? `Order ${openOrder.orderNo}` : 'Order'} wide>
        {openId && <OrderDetails id={openId} onChanged={reload} />}
      </Modal>
    </>
  );
}
