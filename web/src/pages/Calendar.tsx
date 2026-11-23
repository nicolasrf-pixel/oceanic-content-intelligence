import { useMemo, useState } from 'react';
import { api, qs } from '../api';
import { go } from '../App';
import { Empty, fmtDate, Modal, useAsync, useToast } from '../ui';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function CalendarPage() {
  const toast = useToast();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [adding, setAdding] = useState<string | null>(null);
  const range = useMemo(() => {
    const a = new Date(anchor); let start: Date; let end: Date;
    if (view === 'month') { const first = new Date(a.getFullYear(), a.getMonth(), 1); start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); end = new Date(start); end.setDate(start.getDate() + 41); }
    else { start = new Date(a); start.setDate(a.getDate() - ((a.getDay() + 6) % 7)); end = new Date(start); end.setDate(start.getDate() + 6); }
    const days: Date[] = []; for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    return { days, from: iso(start), to: iso(end) };
  }, [anchor, view]);
  const cal = useAsync(() => api('/calendar' + qs({ from: range.from, to: range.to })), [range.from, range.to]);
  const approved = useAsync(() => api('/library?limit=100&sort=date'), []);
  const byDay = useMemo(() => { const m: Record<string, any[]> = {}; for (const i of cal.data?.items ?? []) (m[i.planned_date] ??= []).push(i); return m; }, [cal.data]);
  const shift = (n: number) => { const d = new Date(anchor); view === 'month' ? d.setMonth(d.getMonth() + n) : d.setDate(d.getDate() + 7 * n); setAnchor(d); };
  const title = anchor.toLocaleDateString('es-CL', view === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' });
  const move = async (id: string, date: string) => { try { await api(`/calendar/${id}`, { method: 'PUT', body: { plannedDate: date } }); cal.reload(); } catch (e) { toast((e as Error).message, 'err'); } };
  const remove = async (id: string) => { await api(`/calendar/${id}`, { method: 'DELETE' }); toast('Fecha tentativa eliminada'); cal.reload(); };
  const [pick, setPick] = useState('');
  const add = async () => { try { await api('/calendar', { body: { publicationId: pick, plannedDate: adding } }); toast('Agregado al calendario'); setAdding(null); setPick(''); cal.reload(); } catch (e) { toast((e as Error).message, 'err'); } };
  const today = iso(new Date());

  return (
    <>
      <div className="title-row"><div><span className="eyebrow">PLANIFICACIÓN</span><h1>Calendario editorial</h1><p className="muted">Fechas tentativas para contenidos aprobados. Es solo planificación: nada se publica automáticamente.</p></div>
        <div className="actions"><div className="seg"><button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>Mes</button><button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Semana</button></div></div></div>
      <div className="between cal-nav"><button className="btn" onClick={() => shift(-1)}>←</button><strong className="cap">{title}</strong><div className="actions"><button className="btn" onClick={() => setAnchor(new Date())}>Hoy</button><button className="btn" onClick={() => shift(1)}>→</button></div></div>
      {cal.error && <Empty title="Error">{cal.error}</Empty>}
      <div className={`cal ${view}`}>
        {DAYS.map((d) => <div key={d} className="cal-h">{d}</div>)}
        {range.days.map((d) => { const k = iso(d); const out = view === 'month' && d.getMonth() !== anchor.getMonth(); return (
          <div key={k} className={`cal-d ${out ? 'out' : ''} ${k === today ? 'today' : ''}`}>
            <div className="between"><b>{d.getDate()}</b><button className="add" onClick={() => setAdding(k)} aria-label={`Agregar el ${k}`}>+</button></div>
            {(byDay[k] ?? []).map((e) => <div className="ev" key={e.id}><button className="ev-t" onClick={() => go(`publicacion/${e.publication_id}`)}><small>{e.brand_name}</small>{e.title || 'Sin título'}</button><div className="ev-a"><input type="date" value={e.planned_date} onChange={(x) => x.target.value && move(e.id, x.target.value)} aria-label="Cambiar fecha" /><button onClick={() => remove(e.id)} aria-label="Quitar">✕</button></div></div>)}
          </div>); })}
      </div>
      {adding && <Modal title={`Asignar fecha tentativa · ${fmtDate(adding)}`} onClose={() => setAdding(null)}>
        {approved.data?.items.length ? <><div className="field"><label>Contenido aprobado</label><select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Selecciona…</option>{approved.data.items.map((p: any) => <option key={p.id} value={p.id}>{p.brand_name} · {p.title || 'Sin título'}</option>)}</select></div>
          <div className="actions"><button className="btn" onClick={() => setAdding(null)}>Cancelar</button><button className="btn primary" disabled={!pick} onClick={add}>Asignar</button></div></> : <Empty title="No hay contenidos aprobados">Aprueba una publicación primero.</Empty>}
      </Modal>}
    </>
  );
}
