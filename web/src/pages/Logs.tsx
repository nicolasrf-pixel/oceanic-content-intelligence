import { useState } from 'react';
import { api } from '../api';
import { Empty, fmtDate, Loading, useAsync } from '../ui';

const TABS = [['monitoring', 'Monitoreo'], ['agents', 'Agentes IA'], ['audit', 'Auditoría editorial']] as const;
const KIND: Record<string, string> = { run_start: 'Inicio', run_end: 'Fin', account: 'Cuenta', skipped: 'Omitida' };

export function Logs() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('monitoring');
  const { data, loading, error } = useAsync(() => api(`/logs?type=${tab}&limit=150`), [tab]);
  return (
    <>
      <div className="title-row"><div><span className="eyebrow">TRAZABILIDAD</span><h1>Registros y auditoría</h1><p className="muted">Qué se ejecutó, qué hicieron los agentes y quién tomó cada decisión.</p></div></div>
      <div className="seg">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {loading ? <Loading /> : error ? <Empty title="Error">{error}</Empty> : !data.items.length ? <Empty title="Sin registros todavía" /> :
        <section className="panel mt"><div className="table-wrap"><table>
          {tab === 'monitoring' && <><thead><tr><th>Fecha</th><th>Evento</th><th>Fuente</th><th>Estado</th><th>Hallazgos</th><th>Detalle</th></tr></thead><tbody>{data.items.map((l: any) => <tr key={l.id}><td>{fmtDate(l.created_at, true)}</td><td>{KIND[l.kind] ?? l.kind}</td><td>{l.brand_name ? `${l.brand_name} · ${l.platform}` : '—'}</td><td>{l.status ?? '—'}</td><td>{l.kind === 'account' || l.kind === 'run_end' ? `${l.new_count} nuevas / ${l.duplicates} dup. / ${l.found} enc.` : '—'}</td><td>{l.message ?? ''}</td></tr>)}</tbody></>}
          {tab === 'agents' && <><thead><tr><th>Fecha</th><th>Agente</th><th>Estado</th><th>Proveedor</th><th>Tokens (ent./sal.)</th><th>ms</th><th>Publicación</th><th>Detalle</th></tr></thead><tbody>{data.items.map((l: any) => <tr key={l.id}><td>{fmtDate(l.created_at, true)}</td><td><strong>{l.agent}</strong></td><td><span className={`pill ${l.status === 'ok' ? 'ok' : l.status === 'error' ? 'err' : 'warn'}`}>{l.status}</span></td><td>{l.provider ? `${l.provider} · ${l.model}` : 'heurístico'}</td><td>{l.input_tokens ?? '—'} / {l.output_tokens ?? '—'}</td><td>{l.duration_ms ?? '—'}</td><td className="clip-cell">{l.title ?? '—'}</td><td>{l.message ?? ''}</td></tr>)}</tbody></>}
          {tab === 'audit' && <><thead><tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Publicación</th><th>Motivo / detalle</th></tr></thead><tbody>{data.items.map((l: any) => <tr key={l.id}><td>{fmtDate(l.created_at, true)}</td><td><strong>{l.action}</strong></td><td>{l.actor}</td><td className="clip-cell"><a href={`#/publicacion/${l.publication_id}`}>{l.title ?? l.publication_id}</a></td><td>{l.reason ?? ''}</td></tr>)}</tbody></>}
        </table></div></section>}
    </>
  );
}
