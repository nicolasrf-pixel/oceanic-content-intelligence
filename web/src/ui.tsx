import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export const CATEGORY_LABELS: Record<string, string> = { lanzamiento: 'Lanzamiento', producto: 'Producto', evento: 'Evento', estilo_de_vida: 'Estilo de vida', tecnologia: 'Tecnología', corporativo: 'Corporativo' };
export const STATUS_LABELS: Record<string, string> = { new: 'Procesando', pending: 'Por revisar', approved: 'Listo para publicar', published: 'Publicado por mí', discarded: 'Descartado', saved: 'Guardado', irrelevant: 'Irrelevante' };
export const PRIORITY_LABELS: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };

export function fmtDate(s?: string | null, withTime = false) {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.length <= 10 ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

export const mediaSrc = (p: { id?: string; publication_id?: string; media_r2_key?: string | null; media_url?: string | null }) =>
  p.media_r2_key ? `/api/publications/${p.id ?? p.publication_id}/media` : p.media_url || '';

export function Media({ p, className, controls = true }: { p: any; className?: string; controls?: boolean }) {
  const src = mediaSrc(p);
  if (!src) return <div className={`media-ph ${className ?? ''}`}><span>Sin imagen</span></div>;
  if (p.media_type === 'video' && (p.media_r2_key || /\.(mp4|webm)(\?|$)/i.test(src))) return <video className={className} src={src + (p.media_r2_key ? '#t=0.1' : '')} controls={controls} muted={!controls} playsInline preload="metadata" />;
  return <img className={className} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />;
}

export function Score({ score, priority }: { score: number | null; priority?: string | null }) {
  if (score == null) return <span className="pill neutral">Sin puntaje</span>;
  return <span className={`score-badge ${priority ?? ''}`}>{score}<small>/100</small></span>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill st-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export function Loading() { return <div className="empty"><p>Cargando…</p></div>; }

const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: string } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => { setT({ msg, kind }); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(null), 4500); }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div className={`toast ${t.kind}`} role="status">{t.msg}</div>}</ToastCtx.Provider>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true; set((s) => ({ ...s, loading: true }));
    fn().then((data) => alive && set({ data, loading: false })).catch((e) => alive && set({ error: e.message, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

export function PubCard({ p, onOpen }: { p: any; onOpen: () => void }) {
  return (
    <article className="card" onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="card-visual"><Media p={p} controls={false} />{p.media_type === 'video' && <span className="play">▶</span>}<span className="chip-brand">{p.brand_name}</span>{p.score != null && <span className={`chip-score ${p.priority}`}>{p.score}</span>}</div>
      <div className="card-body">
        <div className="tags">{p.category && <span className="tag">{CATEGORY_LABELS[p.category] ?? p.category}</span>}<StatusPill status={p.status} />{p.needs_ai ? <span className="pill warn">Requiere IA</span> : null}</div>
        <h3>{p.title || 'Sin título'}</h3>
        <p className="snippet">{p.snippet}</p>
        <div className="card-foot"><small>{p.platform === 'instagram' ? 'Instagram' : p.platform === 'manual' ? 'Manual' : 'Sitio web'} · {fmtDate(p.published_at || p.detected_at)}</small></div>
      </div>
    </article>
  );
}
