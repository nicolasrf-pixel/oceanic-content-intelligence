import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { ToastProvider, useAsync } from './ui';
import { Dashboard } from './pages/Dashboard';
import { Inbox } from './pages/Inbox';
import { Detail } from './pages/Detail';
import { Library } from './pages/Library';
import { CalendarPage } from './pages/Calendar';
import { Monitor } from './pages/Monitor';
import { Logs } from './pages/Logs';

const NAV = [
  ['panel', 'Panel', '◧'], ['bandeja', 'Bandeja editorial', '☰'], ['biblioteca', 'Biblioteca', '▤'],
  ['calendario', 'Calendario', '▦'], ['monitor', 'Monitor de marcas', '◎'], ['registros', 'Registros', '≡'],
] as const;

function useHash() {
  const [h, setH] = useState(() => location.hash.slice(2) || 'panel');
  useEffect(() => { const f = () => setH(location.hash.slice(2) || 'panel'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}
export const go = (path: string) => { location.hash = '/' + path; };

function Login({ onDone }: { onDone: (email: string) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const health = useAsync(() => api('/health'), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api('/auth/login', { body: { email, password } }); onDone(r.email); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <div className="brand-lg"><span className="brand-mark">O</span><div><strong>OCEANIC</strong><small>CONTENT INTELLIGENCE</small></div></div>
        <h1>Ingresa a tu mesa editorial</h1>
        {health.data && !health.data.authConfigured && <p className="alert warn">El acceso aún no está configurado: falta el secreto <code>ADMIN_AUTH_SECRET</code> en el Worker.</p>}
        <div className="field"><label htmlFor="em">Correo</label><input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="pw">Clave de acceso</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {err && <p className="alert err" role="alert">{err}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="muted small">Ningún contenido se publica sin aprobación humana.</p>
      </form>
    </div>
  );
}

function Shell({ email, onLogout }: { email: string; onLogout: () => void }) {
  const hash = useHash(); const [open, setOpen] = useState(false);
  const [section, id] = hash.split('?')[0].split('/');
  const current = section === 'publicacion' ? 'bandeja' : section;
  const health = useAsync(() => api('/health'), []);
  let page;
  switch (section) {
    case 'bandeja': page = <Inbox />; break;
    case 'publicacion': page = <Detail id={id} />; break;
    case 'biblioteca': page = <Library />; break;
    case 'calendario': page = <CalendarPage />; break;
    case 'monitor': page = <Monitor />; break;
    case 'registros': page = <Logs />; break;
    default: page = <Dashboard />;
  }
  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <a className="brand" href="#/panel"><span className="brand-mark">O</span><div><strong>OCEANIC</strong><small>CONTENT INTELLIGENCE</small></div></a>
        <nav>{NAV.map(([k, label, ico]) => <a key={k} href={`#/${k}`} className={current === k || (k === 'panel' && !NAV.some(n => n[0] === current)) ? 'active' : ''} onClick={() => setOpen(false)}><span>{ico}</span>{label}</a>)}</nav>
        <div className="side-bottom">
          <div className="ai-state"><i className={health.data?.ai.mode === 'ia' ? 'dot ok' : 'dot warn'} /><div><strong>{health.data?.ai.mode === 'ia' ? `IA activa` : 'Modo heurístico'}</strong><small>{health.data?.ai.mode === 'ia' ? `${health.data.ai.provider} · ${health.data.ai.model}` : 'Sin AI_API_KEY configurada'}</small></div></div>
          <div className="user"><span className="avatar">{email[0]?.toUpperCase()}</span><div><strong>{email}</strong><button className="link" onClick={onLogout}>Cerrar sesión</button></div></div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar"><button className="icon-btn menu" onClick={() => setOpen(!open)} aria-label="Menú">☰</button><span className="today">{new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' })}</span></header>
        <main className="page">{page}</main>
        <footer className="foot">OCEANIC CONTENT INTELLIGENCE 1.0 · NADA SE PUBLICA SIN APROBACIÓN HUMANA</footer>
      </div>
    </div>
  );
}

export function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api('/me').then((r) => setEmail(r.email)).catch(() => setEmail(null));
    const h = () => setEmail(null); window.addEventListener('oci-unauthorized', h); return () => window.removeEventListener('oci-unauthorized', h);
  }, []);
  const logout = async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); setEmail(null); };
  if (email === undefined) return <div className="boot">Cargando…</div>;
  return <ToastProvider>{email ? <Shell email={email} onLogout={logout} /> : <Login onDone={setEmail} />}</ToastProvider>;
}
