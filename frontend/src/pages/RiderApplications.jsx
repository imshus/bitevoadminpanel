// Rider applications from the customer website's "Become a delivery partner" page. Call the applicant, then
// approve the application, which adds them as a delivery agent with the ID check still to do, or turn it down.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { riderApplications as api } from '../api/index.js';
import { useApi, usePageTitle } from '../lib/useApi.js';
import { timeAgo, dateTime } from '../lib/format.js';
import { useToast } from '../components/Toast.jsx';
import { PageHeader, Badge, Segmented, SearchInput, Loading, ErrorState, EmptyState, Avatar, useConfirm } from '../components/ui.jsx';
import { UserPlus, Phone } from '../components/Icons.jsx';

const STATUS = {
  new: { label: 'New', tone: 'info' },
  contacted: { label: 'Called', tone: 'warning' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Turned down', tone: 'neutral' },
};
const FILTERS = [
  { value: 'open', label: 'To review', match: a => a.status === 'new' || a.status === 'contacted' },
  { value: 'approved', label: 'Approved', match: a => a.status === 'approved' },
  { value: 'rejected', label: 'Turned down', match: a => a.status === 'rejected' },
  { value: 'all', label: 'All', match: () => true },
];
const telHref = phone => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

export default function RiderApplications() {
  usePageTitle('Rider applications');
  const toast = useToast();
  const { data, loading, refreshing, error, reload } = useApi(() => api.list());
  const [confirm, confirmDialog] = useConfirm();
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);

  const all = data || [];
  const q = query.trim().toLowerCase();
  const searched = all.filter(a => !q || `${a.name} ${a.phone} ${a.email || ''} ${a.vehicleNumber || ''} ${a.area || ''}`.toLowerCase().includes(q));
  const rows = searched.filter(FILTERS.find(f => f.value === filter).match);

  const act = async (a, kind) => {
    if (kind === 'approve' && !(await confirm({
      title: `Approve ${a.name}?`,
      message: `${a.name} is added as a delivery agent, with the ID check still to do. They sign in to the BiteVo rider app with ${a.phone}. Verify their ID on the Delivery agents page before they can take orders.`,
      confirmLabel: 'Approve',
    }))) return;
    if (kind === 'reject' && !(await confirm({
      title: `Turn down ${a.name}?`,
      message: 'The application is marked as turned down. This can’t be undone here.',
      confirmLabel: 'Turn down', danger: true,
    }))) return;
    setBusy(a._id);
    try {
      if (kind === 'contacted') await api.contacted(a._id);
      if (kind === 'approve') await api.approve(a._id);
      if (kind === 'reject') await api.reject(a._id, '');
      toast(kind === 'approve' ? `${a.name} added as a delivery agent` : kind === 'reject' ? `${a.name}’s application turned down` : `Marked ${a.name} as called`);
      reload();
    } catch (err) {
      toast(err.message, 'critical');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Team" title="Rider applications" subtitle="From the website’s “Become a delivery partner” page. Call the applicant, then approve them as a delivery agent or turn the application down." />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search name, phone or vehicle" />
        <Segmented label="Status" value={filter} onChange={setFilter}
          options={FILTERS.map(f => ({ value: f.value, label: f.label, count: searched.filter(f.match).length }))} />
      </div>

      <section className={`card${refreshing ? ' is-refreshing' : ''}`}>
        {loading ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
          <EmptyState icon={<UserPlus />} title={filter === 'open' ? 'No applications to review' : 'No applications here'}
            text={all.length ? 'Try another filter or search.' : 'Applications from the website’s “Become a delivery partner” page show up here.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Vehicle</th>
                  <th>Area &amp; hours</th>
                  <th>Experience</th>
                  <th>Applied</th>
                  <th>Status</th>
                  <th className="actions-col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(a => {
                  const st = STATUS[a.status] || STATUS.new;
                  const open = a.status === 'new' || a.status === 'contacted';
                  return (
                    <tr key={a._id}>
                      <td>
                        <div className="cell-person">
                          <Avatar name={a.name} />
                          <div>
                            <div className="cell-title">{a.name}</div>
                            <div className="cell-sub nowrap"><a className="link-inline" href={telHref(a.phone)}>{a.phone}</a>{a.email ? ` · ${a.email}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">
                        <div>{a.vehicleType}</div>
                        <div className="cell-sub">{a.vehicleNumber || 'No number'}{a.hasLicence ? ' · Licence' : ''}</div>
                      </td>
                      <td>
                        <div>{a.area || '—'}</div>
                        <div className="cell-sub">{a.shift}</div>
                      </td>
                      <td><div className="cell-sub" title={a.experience || ''}>{a.experience ? (a.experience.length > 70 ? `${a.experience.slice(0, 70)}…` : a.experience) : '—'}</div></td>
                      <td className="nowrap" title={dateTime(a.createdAt)}>{timeAgo(a.createdAt)}</td>
                      <td className="nowrap">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {a.decidedBy && <div className="cell-sub">by {a.decidedBy}</div>}
                        {!a.decidedBy && a.contactedBy && <div className="cell-sub">by {a.contactedBy}</div>}
                      </td>
                      <td className="actions-col">
                        <div className="row-actions">
                          <a className="btn btn--sm btn--ghost" href={telHref(a.phone)} aria-label={`Call ${a.name}`}><Phone size={15} />Call</a>
                          {open && a.status === 'new' && (
                            <button className="btn btn--sm btn--ghost" disabled={busy === a._id} onClick={() => act(a, 'contacted')}>Mark called</button>
                          )}
                          {open && (
                            <>
                              <button className="btn btn--sm btn--ghost" disabled={busy === a._id} onClick={() => act(a, 'approve')} aria-label={`Approve ${a.name}`}>Approve</button>
                              <button className="btn btn--sm btn--ghost btn--ghost-danger" disabled={busy === a._id} onClick={() => act(a, 'reject')} aria-label={`Turn down ${a.name}`}>Turn down</button>
                            </>
                          )}
                          {a.status === 'approved' && <Link className="btn btn--sm btn--ghost" to="/agents">View agents</Link>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="footnote">Approving adds the applicant as a delivery agent with the ID check pending. They can take orders once you verify their ID on the Delivery agents page.</p>
      {confirmDialog}
    </>
  );
}
