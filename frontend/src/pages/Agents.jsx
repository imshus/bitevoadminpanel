import { useState } from 'react';
import { agents as api, settings as settingsApi } from '../api/index.js';
import { useApi, usePatch, usePageTitle } from '../lib/useApi.js';
import { mins, pct, dateOnly } from '../lib/format.js';
import { AGENT_STATUS, KYC_STATUS } from '../lib/status.js';
import { useToast } from '../components/Toast.jsx';
import { PageHeader, Badge, Switch, Field, Segmented, SearchInput, Modal, useConfirm, Loading, ErrorState, EmptyState, StatTile, Avatar } from '../components/ui.jsx';
import { Plus, Pencil, Trash, Bike, Star, Activity, Moon, Shield } from '../components/Icons.jsx';

const EMPTY = { name: '', phone: '+91 ', email: '', vehicleType: '', vehicleNumber: '', kycStatus: 'pending', status: 'offline', isActive: true };

function validate(f) {
  const e = {};
  if (!f.name.trim()) e.name = 'Enter the agent’s name.';
  if (f.phone.replace(/\D/g, '').replace(/^91/, '').length !== 10) e.phone = 'Enter a 10-digit mobile number.';
  if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email, or leave it empty.';
  if (f.vehicleType !== 'Bicycle' && !f.vehicleNumber.trim()) e.vehicleNumber = 'Enter the vehicle registration number.';
  return e;
}

function AgentForm({ agent, vehicleTypes, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...EMPTY, vehicleType: vehicleTypes[0], ...agent }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const submit = async e => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFormError(null);
    const doc = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      vehicleType: form.vehicleType,
      vehicleNumber: form.vehicleType === 'Bicycle' ? '' : form.vehicleNumber.trim().toUpperCase(),
      kycStatus: form.kycStatus,
      isActive: form.isActive,
      status: agent?._id ? form.status : 'offline',
    };
    try {
      if (agent?._id) await api.update(agent._id, doc);
      else await api.create(doc);
      toast(agent?._id ? `${doc.name} updated` : `${doc.name} added`);
      onDone(true);
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="modal__body">
        {formError && <div className="notice notice--error" role="alert">{formError}</div>}
        <div className="form-grid">
          <Field label="Full name" error={errors.name}>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} data-autofocus />
          </Field>
          <Field label="Mobile number" error={errors.phone} hint="Used to sign in to the delivery app.">
            <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" error={errors.email} hint="Optional.">
            <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </Field>
          <Field label="Vehicle">
            <select className="input" value={form.vehicleType} onChange={e => set('vehicleType', e.target.value)}>
              {vehicleTypes.map(v => <option key={v}>{v}</option>)}
            </select>
          </Field>
          {form.vehicleType !== 'Bicycle' && (
            <Field label="Vehicle number" error={errors.vehicleNumber}>
              <input className="input input--code" value={form.vehicleNumber} onChange={e => set('vehicleNumber', e.target.value)} />
            </Field>
          )}
          <Field label="ID verification (KYC)" span>
            <Segmented label="ID verification" value={form.kycStatus} onChange={v => set('kycStatus', v)}
              options={Object.entries(KYC_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          </Field>
          <div className="field field--span switch-row">
            <Switch checked={form.isActive} onChange={v => set('isActive', v)} label="Account active (can take orders)" hideLabel={false} />
          </div>
        </div>
      </div>
      <div className="modal__foot">
        <button type="button" className="btn btn--ghost" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : agent?._id ? 'Save changes' : 'Add agent'}</button>
      </div>
    </form>
  );
}

export default function Agents() {
  usePageTitle('Delivery agents');
  const toast = useToast();
  const { data, loading, refreshing, error, reload } = useApi(() => api.list());
  const { data: settings } = useApi(() => settingsApi.get());
  const [view, patch] = usePatch(reload);
  const [confirm, confirmDialog] = useConfirm();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null);

  const all = (data || []).map(view);
  const active = all.filter(a => a.isActive);
  const scoped = all
    .filter(a => !query || `${a.name} ${a.phone} ${a.vehicleNumber}`.toLowerCase().includes(query.trim().toLowerCase()));
  const STATUS_FILTERS = [
    { value: 'all', label: 'All', match: () => true },
    { value: 'online', label: 'Online', match: a => a.isActive && a.status === 'online' },
    { value: 'busy', label: 'On delivery', match: a => a.isActive && a.status === 'busy' },
    { value: 'offline', label: 'Offline', match: a => a.isActive && a.status === 'offline' },
    { value: 'attention', label: 'Needs review', match: a => a.kycStatus !== 'verified' || !a.isActive },
  ];
  const rows = scoped.filter(STATUS_FILTERS.find(f => f.value === status).match);

  const update = (a, changes, message) =>
    patch(a._id, changes, api.update).then(() => toast(message)).catch(err => toast(err.message, 'critical'));

  const toggleActive = async (a, value) => {
    if (!value) {
      const ok = await confirm({
        title: `Suspend ${a.name}?`,
        message: 'They won’t be able to go online or receive orders until you turn their account back on.',
        confirmLabel: 'Suspend',
        danger: true,
      });
      if (!ok) return;
    }
    update(a, value ? { isActive: true } : { isActive: false, status: 'offline' }, value ? `${a.name} can take orders again` : `${a.name} suspended`);
  };

  const remove = async a => {
    const ok = await confirm({ title: `Remove ${a.name}?`, message: 'Their account will be deleted. To keep their delivery history, suspend them instead.', confirmLabel: 'Remove agent', danger: true });
    if (!ok) return;
    try {
      await api.remove(a._id);
      await reload();
      toast(`${a.name} removed`);
    } catch (err) {
      toast(err.message, 'critical');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Delivery team" title="Delivery agents" subtitle="Your delivery team, live status and performance over the last 30 days">
        <button className="btn btn--primary" onClick={() => setEditing({})}><Plus size={18} />Add agent</button>
      </PageHeader>

      <div className="stats">
        <StatTile icon={<Activity size={18} />} label="Online now" value={active.filter(a => a.status === 'online').length} hint="Ready for a new order" />
        <StatTile icon={<Bike size={18} />} label="On delivery" value={active.filter(a => a.status === 'busy').length} hint="Carrying an order right now" />
        <StatTile icon={<Moon size={18} />} label="Offline" value={active.filter(a => a.status === 'offline').length} hint="Active accounts not signed in" />
        <StatTile icon={<Shield size={18} />} label="Needs review" value={all.filter(a => a.kycStatus === 'pending').length} hint="Waiting for ID verification" />
      </div>

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, phone or vehicle" />
        <Segmented label="Status" value={status} onChange={setStatus}
          options={STATUS_FILTERS.map(f => ({ value: f.value, label: f.label, count: scoped.filter(f.match).length }))} />
      </div>

      <section className={`card${refreshing ? ' is-refreshing' : ''}`}>
        {loading ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
          <EmptyState icon={<Bike />} title="No agents found" text={all.length ? 'Try a different search or filter.' : 'Add your first delivery agent.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Vehicle</th>
                  <th>Status</th>
                  <th>ID check</th>
                  <th className="num">Deliveries</th>
                  <th>Account</th>
                  <th className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(a => {
                  const st = a.isActive ? AGENT_STATUS[a.status] : { label: 'Suspended', tone: 'critical' };
                  const kyc = KYC_STATUS[a.kycStatus];
                  return (
                    <tr key={a._id} className={a.isActive ? undefined : 'is-muted'}>
                      <td>
                        <div className="cell-person">
                          <Avatar name={a.name} />
                          <div>
                            <div className="cell-title">{a.name}</div>
                            <div className="cell-sub nowrap" title={`Joined ${dateOnly(a.createdAt)}`}>{a.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">
                        <div>{a.vehicleType}</div>
                        {a.vehicleNumber && <div className="cell-sub mono">{a.vehicleNumber}</div>}
                      </td>
                      <td><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td>
                        {a.kycStatus === 'pending' ? (
                          <div className="kyc-actions">
                            <Badge tone={kyc.tone}>{kyc.label}</Badge>
                            <div>
                              <button className="btn btn--sm btn--ghost" onClick={() => update(a, { kycStatus: 'verified' }, `${a.name} verified`)} aria-label={`Approve ${a.name}`}>Approve</button>
                              <button className="btn btn--sm btn--ghost btn--ghost-danger" onClick={() => update(a, { kycStatus: 'rejected', isActive: false }, `${a.name} rejected`)} aria-label={`Reject ${a.name}`}>Reject</button>
                            </div>
                          </div>
                        ) : <Badge tone={kyc.tone}>{kyc.label}</Badge>}
                      </td>
                      <td className="num nowrap" title={a.stats ? `${pct(a.stats.onTimeRate)} delivered within 35 min` : undefined}>
                        {a.stats ? a.stats.deliveries : '—'}
                        {a.stats && (
                          <div className="cell-sub">
                            {mins(a.stats.avgMins)}
                            {a.stats.rating && <> · <span className="rating"><Star size={12} />{a.stats.rating.toFixed(1)}</span></>}
                          </div>
                        )}
                      </td>
                      <td>
                        <Switch checked={a.isActive} onChange={v => toggleActive(a, v)} label={`${a.name} account active`} disabled={a.kycStatus === 'rejected'} />
                      </td>
                      <td className="actions-col">
                        <button className="icon-btn" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`} title="Edit"><Pencil size={18} /></button>
                        <button className="icon-btn icon-btn--danger" onClick={() => remove(a)} aria-label={`Remove ${a.name}`} title="Remove"><Trash size={18} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="footnote">Online / on-delivery status comes from the delivery app. Deliveries, average delivery time and rating cover the last 30 days.</p>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?._id ? `Edit ${editing.name}` : 'Add delivery agent'} wide>
        {editing && settings && <AgentForm agent={editing} vehicleTypes={settings.vehicleTypes} onDone={saved => { setEditing(null); if (saved) reload(); }} />}
      </Modal>
      {confirmDialog}
    </>
  );
}
