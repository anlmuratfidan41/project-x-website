import { useEffect, useState, type FormEvent } from 'react';

type StaffUser = { email: string; role: string };
type ProjectRequest = {
  id: string;
  name: string;
  email: string;
  phone: string;
  projectType: string;
  propertyAddress: string;
  preferredMeeting: string;
  idealStart: string;
  message: string;
  status: 'new' | 'contacted' | 'scheduled' | 'in_progress' | 'declined';
  createdAt: string;
};

// Dev talks to the API on :4000; a production build calls the same origin it is served from unless VITE_API_URL is set.
const apiBase = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');
const statuses: ProjectRequest['status'][] = ['new', 'contacted', 'scheduled', 'in_progress', 'declined'];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw new Error(data?.error ?? 'Something went wrong. Please try again.');
  return data as T;
}

export default function App() {
  const [view, setView] = useState<'request' | 'staff'>('request');
  const [user, setUser] = useState<StaffUser | null>(null);
  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadRequests() {
    const result = await api<{ requests: ProjectRequest[] }>('/api/admin/requests');
    setRequests(result.requests);
  }

  useEffect(() => {
    let active = true;
    api<{ user: StaffUser | null }>('/api/auth/me')
      .then((result) => {
        if (active && result.user) {
          setUser(result.user);
          setView('staff');
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    loadRequests().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load requests.'));
  }, [user]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const payload = { ...Object.fromEntries(form.entries()), smsConsent: form.get('smsConsent') === 'on' };
    try {
      const result = await api<{ message: string }>('/api/requests', { method: 'POST', body: JSON.stringify(payload) });
      setNotice(result.message);
      formElement.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send your request.');
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: StaffUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      setUser(result.user);
      setNotice('Signed in.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await api<void>('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setRequests([]);
    setNotice('Signed out.');
  }

  async function changeStatus(id: string, status: ProjectRequest['status']) {
    setError('');
    try {
      await api(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await loadRequests();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update request.');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#request" onClick={() => setView('request')} aria-label="Project X home">
          <span className="brand-mark">PX</span>
          <span>PROJECT X <small>CONTRACTORS</small></span>
        </a>
        <nav aria-label="Main navigation">
          <button className={view === 'request' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('request'); setError(''); }}>Request a quote</button>
          <button className={view === 'staff' ? 'nav-link active' : 'nav-link'} onClick={() => { setView('staff'); setError(''); }}>Staff portal</button>
        </nav>
      </header>

      <main>
        {view === 'request' ? (
          <section className="request-layout">
            <div className="intro">
              <p className="eyebrow">WASHINGTON, D.C. · RESTORATION & CONSTRUCTION</p>
              <h1>Make the next<br /><span>move with confidence.</span></h1>
              <p className="intro-copy">Tell us about the property and the work ahead. Our team will review your request and follow up to arrange a site meeting.</p>
              <div className="process-note"><span>01</span><div><strong>Request received</strong><small>We review every project directly.</small></div></div>
            </div>
            <form className="form-panel" onSubmit={submitRequest}>
              <div className="panel-heading"><p className="eyebrow">PROJECT INTAKE</p><h2>Tell us what you need.</h2></div>
              <div className="field-grid">
                <label>Full name<input name="name" autoComplete="name" required minLength={2} maxLength={120} /></label>
                <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
                <label>Phone <span className="optional">Optional</span><input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
                <label>Project type<input name="projectType" placeholder="Water damage, framing…" required minLength={2} maxLength={120} /></label>
                <label className="full-field">Property address<input name="propertyAddress" autoComplete="street-address" required minLength={5} maxLength={300} /></label>
                <label>Preferred site meeting <span className="optional">Optional</span><input name="preferredMeeting" placeholder="Date and time" maxLength={100} /></label>
                <label>Ideal start date <span className="optional">Optional</span><input name="idealStart" type="date" /></label>
                <label className="full-field">Project details<textarea name="message" rows={4} required minLength={10} maxLength={4000} placeholder="Describe the work, damage, or questions…" /></label>
              </div>
              <label className="consent"><input type="checkbox" name="smsConsent" /><span>I agree to receive SMS updates about this request. Message and data rates may apply. Reply STOP to opt out.</span></label>
              <button className="primary-button" disabled={busy}>{busy ? 'SENDING…' : 'SEND PROJECT REQUEST'} <span aria-hidden="true">→</span></button>
              <p className="fine-print">Your details are used to respond to this project inquiry.</p>
              {notice && <p className="feedback success" role="status">{notice}</p>}
              {error && <p className="feedback failure" role="alert">{error}</p>}
            </form>
          </section>
        ) : user ? (
          <section className="admin-view">
            <div className="admin-heading"><div><p className="eyebrow">PROJECT X · OPERATIONS</p><h1>Request inbox</h1><p>Signed in as {user.email} · {user.role}</p></div><button className="quiet-button" onClick={signOut}>Sign out</button></div>
            {error && <p className="feedback failure" role="alert">{error}</p>}
            <div className="inbox-toolbar"><strong>{requests.length} {requests.length === 1 ? 'request' : 'requests'}</strong><button className="quiet-button" onClick={() => loadRequests().catch((reason: Error) => setError(reason.message))}>Refresh</button></div>
            {requests.length === 0 ? <div className="empty-state">No project requests yet.</div> : (
              <div className="request-list">{requests.map((item) => (
                <article className="request-item" key={item.id}>
                  <div className="request-main"><div className="request-title"><h2>{item.name}</h2><span className={`status status-${item.status}`}>{item.status.replace('_', ' ')}</span></div>
                    <p className="request-type">{item.projectType}</p><p className="request-address">{item.propertyAddress}</p><p className="request-message">{item.message}</p>
                    <div className="request-meta"><a href={`mailto:${item.email}`}>{item.email}</a>{item.phone && <a href={`tel:${item.phone}`}>{item.phone}</a>}<span>{new Date(`${item.createdAt.replace(' ', 'T')}Z`).toLocaleString()}</span></div>
                    {(item.preferredMeeting || item.idealStart) && <p className="request-dates">{item.preferredMeeting && `Meeting: ${item.preferredMeeting}`}{item.preferredMeeting && item.idealStart ? ' · ' : ''}{item.idealStart && `Ideal start: ${item.idealStart}`}</p>}
                  </div>
                  <label className="status-control">Status<select value={item.status} onChange={(event) => changeStatus(item.id, event.target.value as ProjectRequest['status'])}>{statuses.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select></label>
                </article>
              ))}</div>
            )}
          </section>
        ) : (
          <section className="login-layout">
            <div className="login-copy"><p className="eyebrow">PROJECT X · STAFF ONLY</p><h1>Work starts<br /><span>behind the scenes.</span></h1><p>Sign in with the staff account issued by your administrator.</p><button className="text-button" onClick={() => setView('request')}>← Back to project requests</button></div>
            <form className="form-panel login-panel" onSubmit={signIn}>
              <div className="panel-heading"><p className="eyebrow">STAFF PORTAL</p><h2>Sign in</h2></div>
              <label>Email address<input name="email" type="email" autoComplete="username" required /></label>
              <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
              <button className="primary-button" disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN'} <span aria-hidden="true">→</span></button>
              {error && <p className="feedback failure" role="alert">{error}</p>}
            </form>
          </section>
        )}
      </main>
      <footer><span>© {new Date().getFullYear()} Project X Contractors LLC</span><span>Washington, D.C.</span></footer>
    </div>
  );
}
