import { useEffect, useRef, useState } from 'react';
import { api, qs, uploadFile } from '../api';
import { go } from '../App';
import { Empty, fmtDate, Loading, Media, Modal, StatusPill, useAsync, useToast, CATEGORY_LABELS } from '../ui';

const TABS: [string, string][] = [['pending', 'Por elegir'], ['approved', 'Listos para publicar'], ['saved', 'Guardados'], ['published', 'Publicados por mí'], ['discarded', 'Descartados'], ['', 'Todos']];
type Item = { file?: File; state: 'espera' | 'subiendo' | 'ok' | 'error'; pct: number; msg?: string };

function Upload({ brands, onClose, onDone }: { brands: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const ref = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ brandId: brands[0]?.id ?? '', url: '', caption: '', title: '', rights: false });
  const [items, setItems] = useState<Item[]>([]); const [busy, setBusy] = useState(false);
  const files = items.map((i) => i.file!).filter(Boolean);
  const single = files.length <= 1;
  const patch = (i: number, p: Partial<Item>) => setItems((a) => a.map((x, n) => (n === i ? { ...x, ...p } : x)));

  const run = async () => {
    setBusy(true); let ok = 0;
    const list: (File | undefined)[] = files.length ? files : [undefined];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        if (file) patch(i, { state: 'subiendo', pct: 0 });
        const r = await api('/reels', { body: { brandId: f.brandId, url: single ? f.url : '', caption: single ? f.caption : '', title: single ? f.title : '', fileName: file?.name, fileSize: file?.size } });
        if (file) { await uploadFile(`/publications/${r.id}/media-file?rights=1&name=${encodeURIComponent(file.name)}`, file, (pct) => patch(i, { pct })); patch(i, { state: 'ok', pct: 100 }); }
        ok++;
      } catch (e) { if (file) patch(i, { state: 'error', msg: (e as Error).message }); else toast((e as Error).message, 'err'); }
    }
    setBusy(false);
    if (ok) { toast(`${ok} reel${ok > 1 ? 's' : ''} agregado${ok > 1 ? 's' : ''}`); onDone(); }
    if (ok === list.length) onClose();
  };
  const needsRights = files.length > 0;
  return (
    <Modal title="Agregar reels" onClose={busy ? () => {} : onClose}>
      <div className="field"><label>Marca / línea</label><select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
      <div className="field"><label>Archivos de video (puedes elegir varios · MP4 o MOV · máx. 100 MB c/u)</label>
        <input ref={ref} type="file" multiple accept="video/mp4,video/quicktime" disabled={busy} onChange={(e) => setItems([...(e.target.files ?? [])].map((file) => ({ file, state: 'espera', pct: 0 })))} /></div>
      {items.map((it, i) => <div key={i}><div className="up-row"><span>{it.file!.name}</span><span>{it.state === 'error' ? it.msg : it.state === 'ok' ? '✔ listo' : `${(it.file!.size / 1048576).toFixed(1)} MB`}</span></div>{it.state === 'subiendo' && <div className="bar"><i style={{ width: it.pct + '%' }} /></div>}</div>)}
      {single && <>
        <div className="field"><label>Enlace del reel original (opcional)</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://www.instagram.com/reel/…" /></div>
        <div className="field"><label>Texto original del reel / caption (opcional; lo puedes pegar después)</label><textarea value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} /></div>
        <div className="field"><label>Título interno (opcional)</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div></>}
      {!single && <p className="hint">Varios archivos: se crea un reel por archivo. El texto original y el enlace los completas después, abriendo cada reel.</p>}
      {needsRights && <label className="check"><input type="checkbox" checked={f.rights} onChange={(e) => setF({ ...f, rights: e.target.checked })} /> Confirmo que tengo derecho a usar este material (representada de Oceanic).</label>}
      <div className="actions"><button className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.brandId || (needsRights && !f.rights) || (!files.length && !f.url)} onClick={run}>{busy ? 'Subiendo…' : 'Agregar'}</button></div>
    </Modal>
  );
}

export function Reels() {
  const initial = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] ?? '')) as Record<string, string>;
  const [status, setStatus] = useState(initial.status ?? 'pending'); const [brand, setBrand] = useState(''); const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false); const [page, setPage] = useState(0);
  const brands = useAsync(() => api('/brands'), []);
  const dash = useAsync(() => api('/dashboard'), []);
  const list = useAsync(() => api('/publications' + qs({ status, brand, q, media: 'video', sort: 'date', limit: 24, offset: page * 24 })), [status, brand, q, page]);
  useEffect(() => { sessionStorage.setItem('oci-from', 'reels'); setPage(0); }, [status, brand, q]);
  const counts = dash.data?.counts ?? {};

  return (
    <>
      <div className="title-row"><div><span className="eyebrow">REELS DE LAS REPRESENTADAS</span><h1>Todos los reels en un lugar</h1><p className="muted">Sube los reels que descargas, elige cuál publicar, genera el copy y llévate el video listo para agregarle el cierre con el logo y subirlo desde Meta.</p></div>
        <button className="btn primary" disabled={!brands.data} onClick={() => setAdding(true)}>+ Agregar reels</button></div>
      <div className="chips">{TABS.map(([k, l]) => <button key={k} className={`chip ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{l}{k && counts[k] != null ? <b>{counts[k]}</b> : null}</button>)}</div>
      <div className="filters">
        <input className="search" placeholder="Buscar por texto…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca"><option value="">Todas las marcas</option>{brands.data?.brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </div>
      {list.loading && !list.data ? <Loading /> : list.error ? <Empty title="Error al cargar">{list.error}</Empty> : !list.data.items.length ? <Empty title="No hay reels aquí todavía">Pulsa «+ Agregar reels» para subir los videos que descargaste.</Empty> : <>
        <p className="muted small">{list.data.total} reel{list.data.total === 1 ? '' : 's'}</p>
        <div className="reel-grid">{list.data.items.map((p: any) => (
          <article className="reel" key={p.id} onClick={() => go(`publicacion/${p.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`publicacion/${p.id}`)}>
            <div className="reel-v"><Media p={p} controls={false} /><span className="chip-brand">{p.brand_name}</span><span className="play">▶</span></div>
            <div className="reel-b"><StatusPill status={p.status} /><strong>{p.title || p.snippet || 'Sin texto todavía'}</strong>
              <small>{fmtDate(p.published_at || p.detected_at)}{p.category ? ` · ${CATEGORY_LABELS[p.category] ?? ''}` : ''}</small>
              {!p.copy_source && <div className="nocopy">Falta el copy</div>}{!p.media_r2_key && <div className="nocopy">Sin archivo de video</div>}</div>
          </article>))}</div>
        {list.data.total > 24 && <div className="pager"><button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button><span>Página {page + 1} de {Math.ceil(list.data.total / 24)}</span><button className="btn" disabled={(page + 1) * 24 >= list.data.total} onClick={() => setPage(page + 1)}>Siguiente →</button></div>}</>}
      {adding && brands.data && <Upload brands={brands.data.brands.filter((b: any) => b.active)} onClose={() => setAdding(false)} onDone={() => { list.reload(); dash.reload(); }} />}
    </>
  );
}
