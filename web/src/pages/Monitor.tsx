import { useEffect, useState } from 'react';
import { api } from '../api';
import { Empty, fmtDate, Loading, Modal, useAsync, useToast } from '../ui';

const STATUS: Record<string, [string, string]> = { ok: ['Conectado', 'ok'], needs_credentials: ['Requiere credenciales', 'warn'], blocked_robots: ['robots.txt lo bloquea', 'warn'], error: ['Con error', 'err'] };
const CONNECTORS: Record<string, string> = { html_news: 'Sitio web / noticias', rss: 'RSS / Atom', instagram_discovery: 'Instagram (Business Discovery)' };

function AccountForm({ brandId, account, onClose, onSaved }: { brandId: string; account?: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const cfg = account ? JSON.parse(account.config_json || '{}') : {};
  const [f, setF] = useState({ connector: account?.connector ?? 'html_news', url: account?.url ?? '', handle: account?.handle ?? '', listUrl: cfg.listUrl ?? '', linkPattern: cfg.linkPattern ?? '', allowedHosts: (cfg.allowedHosts ?? []).join(', '), maxItems: cfg.maxItems ?? 5 });
  const save = async () => {
    const config = { ...cfg, listUrl: f.listUrl || undefined, linkPattern: f.linkPattern || undefined, allowedHosts: f.allowedHosts ? f.allowedHosts.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined, maxItems: Number(f.maxItems) || 5 };
    try {
      if (account) await api(`/accounts/${account.id}`, { method: 'PUT', body: { url: f.url, handle: f.handle || undefined, config } });
      else await api('/accounts', { body: { brandId, connector: f.connector, url: f.url, handle: f.handle || undefined, config } });
      toast('Fuente guardada'); onSaved(); onClose();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const ig = f.connector === 'instagram_discovery';
  return (
    <Modal title={account ? 'Configurar fuente' : 'Nueva fuente'} onClose={onClose}>
      {!account && <div className="field"><label>Tipo de conector</label><select value={f.connector} onChange={(e) => setF({ ...f, connector: e.target.value })}>{Object.entries(CONNECTORS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
      <div className="field"><label>{ig ? 'URL del perfil de Instagram' : 'URL de la fuente (https)'}</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>
      {ig && <div className="field"><label>Handle (sin @)</label><input value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} /></div>}
      {!ig && <>
        <div className="field"><label>URL del listado de noticias (opcional)</label><input value={f.listUrl} onChange={(e) => setF({ ...f, listUrl: e.target.value })} placeholder="https://www.ejemplo.com/news" /></div>
        {f.connector === 'html_news' && <div className="field"><label>Patrón de enlaces de artículos (regex sobre la ruta)</label><input value={f.linkPattern} onChange={(e) => setF({ ...f, linkPattern: e.target.value })} placeholder="/(news|blog|press)" /></div>}
        <div className="field"><label>Dominios adicionales permitidos (separados por coma)</label><input value={f.allowedHosts} onChange={(e) => setF({ ...f, allowedHosts: e.target.value })} /></div></>}
      <div className="field"><label>Máx. publicaciones por ejecución (1–10)</label><input type="number" min={1} max={10} value={f.maxItems} onChange={(e) => setF({ ...f, maxItems: e.target.value })} /></div>
      <p className="muted small">Solo se leen sitios públicos respetando robots.txt y dominios permitidos. No se hace scraping de redes sociales.</p>
      <div className="actions"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!f.url} onClick={save}>Guardar</button></div>
    </Modal>
  );
}

export function Monitor() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api('/brands'), []);
  const settings = useAsync(() => api('/settings'), []);
  const [form, setForm] = useState<any>(null); const [busy, setBusy] = useState('');
  const [newBrand, setNewBrand] = useState<string | null>(null);
  const [s, setS] = useState<Record<string, string>>({});
  useEffect(() => { if (settings.data) setS(settings.data); }, [settings.data]);

  const toggleAccount = async (a: any) => { try { await api(`/accounts/${a.id}`, { method: 'PUT', body: { enabled: !a.enabled } }); reload(); } catch (e) { toast((e as Error).message, 'err'); } };
  const toggleBrand = async (b: any) => { await api(`/brands/${b.id}`, { method: 'PUT', body: { active: !b.active } }); reload(); };
  const run = async (label: string, path: string, body: object, fmt: (r: any) => string) => {
    setBusy(label);
    try { const r = await api(path, { body }); toast(fmt(r)); reload(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  const saveSettings = async () => { try { await api('/settings', { method: 'PUT', body: s }); toast('Ajustes guardados'); settings.reload(); } catch (e) { toast((e as Error).message, 'err'); } };
  if (loading) return <Loading />;
  if (error || !data) return <Empty title="Error">{error}</Empty>;
  const accountsOf = (id: string) => data.accounts.filter((a: any) => a.brand_id === id && a.connector !== 'manual');

  return (
    <>
      <div className="title-row"><div><span className="eyebrow">FUENTES</span><h1>Monitor de marcas</h1><p className="muted">Activa o desactiva marcas y fuentes, configura URLs y revisa el estado de cada conector.</p></div>
        <div className="actions wrap"><button className="btn" onClick={() => setNewBrand('')}>+ Marca</button>
          <button className="btn" disabled={!!busy} onClick={() => run('re', '/monitor/reprocess', { scope: 'heuristic', limit: 10 }, (r) => `Reprocesadas ${r.processed} (${r.aiMode === 'ia' ? 'con IA' : 'sin IA'})${r.errors ? `, ${r.errors} con error` : ''}`)}>{busy === 're' ? 'Reprocesando…' : '↻ Reprocesar con IA'}</button>
          <button className="btn primary" disabled={!!busy} onClick={() => run('run', '/monitor/run', {}, (r) => r.status === 'locked' ? 'Ya hay una ejecución en curso' : `${r.created} nuevas, ${r.duplicates} duplicadas, ${r.errors} errores`)}>{busy === 'run' ? 'Ejecutando…' : '▶ Ejecutar monitoreo ahora'}</button></div></div>
      {!data.instagramConfigured && <p className="alert info">Instagram aún no está conectado: faltan <code>META_ACCESS_TOKEN</code> y <code>META_IG_USER_ID</code> (cuenta profesional autorizada). Mientras tanto esas fuentes quedan en espera y no se hace scraping.</p>}

      {data.brands.map((b: any) => (
        <section className="panel mt" key={b.id}>
          <div className="panel-head"><div><h3>{b.name}</h3><p className="muted small">{b.category}{b.country ? ` · ${b.country}` : ''}</p></div>
            <div className="actions"><button className="btn small" onClick={() => setForm({ brandId: b.id })}>+ Fuente</button><label className="switch"><input type="checkbox" checked={!!b.active} onChange={() => toggleBrand(b)} /><span>{b.active ? 'Activa' : 'Inactiva'}</span></label></div></div>
          <div className="table-wrap"><table><thead><tr><th>Fuente</th><th>Conector</th><th>Estado</th><th>Última revisión</th><th></th></tr></thead><tbody>
            {accountsOf(b.id).length === 0 && <tr><td colSpan={5} className="muted">Sin fuentes configuradas.</td></tr>}
            {accountsOf(b.id).map((a: any) => { const [l, k] = a.enabled ? STATUS[a.last_status] ?? ['Sin ejecutar', 'neutral'] : ['Desactivada', 'neutral']; return (
              <tr key={a.id}><td><strong>{a.platform === 'instagram' ? '@' + a.handle : a.url.replace('https://', '')}</strong>{a.last_error && <small className="err-t">{a.last_error}</small>}</td><td>{CONNECTORS[a.connector]}</td><td><span className={`pill ${k}`}>{l}</span></td><td>{fmtDate(a.last_checked_at, true)}</td>
                <td className="actions"><button className="btn small" onClick={() => setForm({ brandId: b.id, account: a })}>Configurar</button><button className="btn small" disabled={!!busy} onClick={() => run(a.id, '/monitor/run', { accountId: a.id }, (r) => `${r.created} nuevas, ${r.duplicates} duplicadas`)}>Probar</button><label className="switch"><input type="checkbox" checked={!!a.enabled} onChange={() => toggleAccount(a)} /><span className="sr">Activar</span></label></td></tr>); })}
          </tbody></table></div>
        </section>))}

      <section className="panel mt"><div className="panel-head"><h3>Programación y límites</h3></div><div className="pad settings">
        <label className="switch"><input type="checkbox" checked={s.monitoring_enabled === '1'} onChange={(e) => setS({ ...s, monitoring_enabled: e.target.checked ? '1' : '0' })} /><span>Monitoreo automático (cron) activo</span></label>
        <div className="field"><label>Hora(s) de ejecución, hora de Santiago (ej.: 8 o 8,18)</label><input value={s.monitoring_hours_local ?? ''} onChange={(e) => setS({ ...s, monitoring_hours_local: e.target.value })} /></div>
        <div className="field"><label>Máx. publicaciones nuevas por cuenta</label><input type="number" value={s.max_new_per_account ?? ''} onChange={(e) => setS({ ...s, max_new_per_account: e.target.value })} /></div>
        <div className="field"><label>Máx. publicaciones nuevas por ejecución</label><input type="number" value={s.max_new_per_run ?? ''} onChange={(e) => setS({ ...s, max_new_per_run: e.target.value })} /></div>
        <div className="field"><label>Ignorar contenido de más de N días</label><input type="number" value={s.max_age_days ?? ''} onChange={(e) => setS({ ...s, max_age_days: e.target.value })} /></div>
        <div className="field wide"><label>Guía de tono Oceanic (se entrega al Copywriter)</label><textarea value={s.tone_guide ?? ''} onChange={(e) => setS({ ...s, tone_guide: e.target.value })} /></div>
        <div className="actions"><button className="btn primary" onClick={saveSettings}>Guardar ajustes</button></div>
      </div></section>

      {form && <AccountForm brandId={form.brandId} account={form.account} onClose={() => setForm(null)} onSaved={reload} />}
      {newBrand !== null && <Modal title="Nueva marca / línea" onClose={() => setNewBrand(null)}>
        <div className="field"><label>Nombre</label><input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} /></div>
        <div className="actions"><button className="btn" onClick={() => setNewBrand(null)}>Cancelar</button><button className="btn primary" disabled={newBrand.length < 2} onClick={async () => { try { await api('/brands', { body: { name: newBrand } }); setNewBrand(null); reload(); } catch (e) { toast((e as Error).message, 'err'); } }}>Crear</button></div></Modal>}
    </>
  );
}
