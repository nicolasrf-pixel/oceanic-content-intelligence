import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { go } from '../App';
import { Empty, Loading, Modal, PubCard, useAsync, useToast, CATEGORY_LABELS, STATUS_LABELS } from '../ui';

export function Filters({ value, onChange, brands, showStatus = true }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; brands: any[]; showStatus?: boolean }) {
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="filters">
      <input className="search" placeholder="Buscar en título o texto…" value={value.q ?? ''} onChange={(e) => set('q', e.target.value)} aria-label="Buscar" />
      <select value={value.brand ?? ''} onChange={(e) => set('brand', e.target.value)} aria-label="Marca"><option value="">Todas las marcas</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <select value={value.category ?? ''} onChange={(e) => set('category', e.target.value)} aria-label="Categoría"><option value="">Todas las categorías</option>{Object.entries(CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {showStatus && <select value={value.status ?? ''} onChange={(e) => set('status', e.target.value)} aria-label="Estado"><option value="">Todos los estados</option>{Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      <select value={value.priority ?? ''} onChange={(e) => set('priority', e.target.value)} aria-label="Prioridad"><option value="">Toda prioridad</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
      <label className="date">Desde<input type="date" value={value.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
      <label className="date">Hasta<input type="date" value={value.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
      <select value={value.sort ?? 'score'} onChange={(e) => set('sort', e.target.value)} aria-label="Orden"><option value="score">Mayor puntaje</option><option value="date">Más recientes</option></select>
    </div>
  );
}

function useDebounced<T>(v: T, ms = 350) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }

export function PubGrid({ filters, fixed, empty }: { filters: Record<string, string>; fixed?: Record<string, string>; empty: string }) {
  const [page, setPage] = useState(0); const f = useDebounced(filters);
  useEffect(() => setPage(0), [f]);
  const { data, loading, error } = useAsync(() => api('/' + (fixed?.endpoint ?? 'publications') + qs({ ...f, limit: 24, offset: page * 24 })), [f, page]);
  if (loading && !data) return <Loading />;
  if (error) return <Empty title="Error al cargar">{error}</Empty>;
  if (!data.items.length) return <Empty title="Sin resultados">{empty}</Empty>;
  return (<>
    <p className="muted small">{data.total} resultado{data.total === 1 ? '' : 's'}</p>
    <div className="grid-cards">{data.items.map((p: any) => <PubCard key={p.id} p={p} onOpen={() => go(`publicacion/${p.id}`)} />)}</div>
    {data.total > 24 && <div className="pager"><button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button><span>Página {page + 1} de {Math.ceil(data.total / 24)}</span><button className="btn" disabled={(page + 1) * 24 >= data.total} onClick={() => setPage(page + 1)}>Siguiente →</button></div>}
  </>);
}

function AddUrl({ brands, onClose }: { brands: any[]; onClose: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ brandId: brands[0]?.id ?? '', url: '', title: '', text: '', mediaUrl: '' });
  const submit = async () => {
    setBusy(true);
    try { const r = await api('/publications/manual', { body: f }); toast('Publicación incorporada y analizada'); go(`publicacion/${r.id}`); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Agregar publicación por URL" onClose={onClose}>
      <p className="muted small">Páginas web públicas se leen respetando robots.txt. Para enlaces de Instagram u otras redes, pega el texto: no se extrae automáticamente.</p>
      <div className="field"><label>Marca / línea</label><select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
      <div className="field"><label>URL (https)</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></div>
      <div className="field"><label>Título (opcional)</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="field"><label>Texto de la publicación (obligatorio para redes sociales)</label><textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
      <div className="field"><label>URL de imagen (opcional)</label><input value={f.mediaUrl} onChange={(e) => setF({ ...f, mediaUrl: e.target.value })} placeholder="https://…" /></div>
      <div className="actions"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.url} onClick={submit}>{busy ? 'Procesando…' : 'Incorporar y analizar'}</button></div>
    </Modal>
  );
}

export function Inbox() {
  const initial = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] ?? '')) as Record<string, string>;
  const [filters, setFilters] = useState<Record<string, string>>({ status: 'pending', sort: 'score', ...initial });
  const [adding, setAdding] = useState(false);
  const brands = useAsync(() => api('/brands'), []);
  return (
    <>
      <div className="title-row"><div><span className="eyebrow">BANDEJA</span><h1>Bandeja editorial</h1><p className="muted">Propuestas detectadas y adaptadas al mercado chileno, ordenadas por oportunidad.</p></div><button className="btn primary" onClick={() => setAdding(true)} disabled={!brands.data}>+ Agregar por URL</button></div>
      <Filters value={filters} onChange={setFilters} brands={brands.data?.brands ?? []} />
      <PubGrid filters={filters} empty="No hay publicaciones con estos filtros. Prueba otro estado o ejecuta el monitoreo." />
      {adding && brands.data && <AddUrl brands={brands.data.brands.filter((b: any) => b.active)} onClose={() => setAdding(false)} />}
    </>
  );
}
