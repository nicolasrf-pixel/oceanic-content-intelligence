import { api } from '../api';
import { go } from '../App';
import { Empty, fmtDate, Loading, Media, Score, useAsync, CATEGORY_LABELS } from '../ui';

const CONN_LABEL: Record<string, [string, string]> = { ok: ['Conectado', 'ok'], needs_credentials: ['Requiere credenciales', 'warn'], blocked_robots: ['Bloqueado por robots.txt', 'warn'], error: ['Con error', 'err'] };

export function Dashboard() {
  const { data, loading, error } = useAsync(() => api('/dashboard'), []);
  if (loading) return <Loading />;
  if (error || !data) return <Empty title="No se pudo cargar el panel">{error}</Empty>;
  const c = data.counts as Record<string, number>;
  const stats = [['Por revisar', c.pending ?? 0, 'pending'], ['Aprobados', c.approved ?? 0, 'approved'], ['Guardados', c.saved ?? 0, 'saved'], ['Descartados', (c.discarded ?? 0) + (c.irrelevant ?? 0), 'discarded']];
  return (
    <>
      <div className="title-row"><div><span className="eyebrow">RESUMEN</span><h1>Panel editorial</h1><p className="muted">Publicaciones detectadas, estado de las fuentes y última ejecución del monitoreo.</p></div><button className="btn primary" onClick={() => go('bandeja')}>Ir a la bandeja</button></div>
      <div className="stats">{stats.map(([l, v, s]) => <button key={l as string} className="stat" onClick={() => go(`bandeja?status=${s}`)}><span>{l}</span><strong>{v}</strong></button>)}</div>
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h3>Mejores oportunidades pendientes</h3><button className="link" onClick={() => go('bandeja')}>Ver todo</button></div>
          {data.top.length === 0 ? <Empty title="Sin publicaciones pendientes">Ejecuta el monitoreo desde «Monitor de marcas» o agrega una URL manualmente.</Empty> :
            data.top.map((p: any) => <div className="row" key={p.id} onClick={() => go(`publicacion/${p.id}`)}><div className="thumb"><Media p={p} /></div><div className="grow"><small className="brand-tag">{p.brand_name}</small><strong className="clip">{p.title || 'Sin título'}</strong><small className="muted">{CATEGORY_LABELS[p.category] ?? ''}</small></div><Score score={p.score} priority={p.priority} /></div>)}
        </section>
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h3>Última ejecución</h3></div>
            <div className="pad">{data.lastRun ? <><p><strong>{fmtDate(data.lastRun.created_at, true)}</strong></p><p className="muted small">{data.lastRun.new_count} nuevas · {data.lastRun.duplicates} duplicadas · {data.lastRun.found} encontradas</p><p className="muted small">{data.lastRun.message}</p></> : <p className="muted">Aún no se ha ejecutado el monitoreo.</p>}
              <p className="muted small">Modo de IA: <strong>{data.ai.mode === 'ia' ? `${data.ai.provider} · ${data.ai.model}` : 'heurístico (sin IA)'}</strong></p></div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>Estado de conectores</h3><button className="link" onClick={() => go('monitor')}>Gestionar</button></div>
            <div className="pad-sm">{data.accounts.map((a: any) => { const [l, k] = a.enabled ? CONN_LABEL[a.last_status] ?? ['Sin ejecutar', 'neutral'] : ['Desactivado', 'neutral']; return <div className="conn" key={a.id}><div><strong>{a.brand_name}</strong><small>{a.platform === 'instagram' ? '@' + a.handle : a.url.replace('https://', '')}</small></div><span className={`pill ${k}`}>{l}</span></div>; })}</div>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>Próximos en calendario</h3><button className="link" onClick={() => go('calendario')}>Abrir</button></div>
            <div className="pad-sm">{data.upcoming.length ? data.upcoming.map((u: any) => <div className="conn" key={u.id}><div><strong className="clip">{u.title || 'Sin título'}</strong><small>{u.brand_name}</small></div><span className="pill neutral">{fmtDate(u.planned_date)}</span></div>) : <p className="muted small pad-x">Sin fechas tentativas asignadas.</p>}</div>
          </section>
        </div>
      </div>
      <section className="panel mt"><div className="panel-head"><h3>Pendientes por marca</h3></div><div className="table-wrap"><table><thead><tr><th>Marca</th><th>Por revisar</th><th>Aprobados</th><th>Total detectado</th></tr></thead><tbody>{data.byBrand.map((b: any) => <tr key={b.id}><td><strong>{b.name}</strong></td><td>{b.pending ?? 0}</td><td>{b.approved ?? 0}</td><td>{b.total}</td></tr>)}</tbody></table></div></section>
    </>
  );
}
