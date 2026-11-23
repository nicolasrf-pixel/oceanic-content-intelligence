import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { go } from '../App';
import { Empty, fmtDate, Loading, Media, Modal, Score, StatusPill, useAsync, useToast, CATEGORY_LABELS } from '../ui';

const SEV: Record<string, string> = { alta: 'err', media: 'warn', baja: 'neutral' };

export function Detail({ id }: { id: string }) {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api(`/publications/${id}`), [id]);
  const [text, setText] = useState(''); const [tags, setTags] = useState(''); const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<'discard' | 'approve' | 'regen' | 'media' | null>(null);
  const [aux, setAux] = useState({ reason: '', date: '', instructions: '', rights: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const cur = data?.copies.find((c: any) => c.is_current);
  useEffect(() => { if (cur) { setText(cur.copy_es_cl); setTags(JSON.parse(cur.hashtags || '[]').join(' ')); } }, [cur?.id]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <Empty title="No se encontró la publicación">{error}</Empty>;
  const { publication: p, analysis, copies, approvals, calendar } = data;
  const report = cur?.editor_report_json ? JSON.parse(cur.editor_report_json) : null;
  const flags: string[] = analysis ? JSON.parse(analysis.flags_json || '[]') : [];
  const dirty = cur && (text !== cur.copy_es_cl || tags !== JSON.parse(cur.hashtags || '[]').join(' '));

  const run = async (label: string, fn: () => Promise<any>, ok: string) => {
    setBusy(label);
    try { await fn(); toast(ok); setDialog(null); reload(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  const saveCopy = () => run('save', async () => {
    const r = await api(`/publications/${id}/copy`, { method: 'PUT', body: { copy: text, hashtags: tags.split(/\s+/).filter(Boolean) } });
    if (r.issues?.length) toast(`Guardado. Revisa: ${r.issues[0].message}`, 'err');
  }, 'Copy guardado como nueva versión');
  const act = (action: string, extra: object = {}, ok = 'Listo') => run(action, () => api(`/publications/${id}/action`, { body: { action, ...extra } }), ok);

  return (
    <>
      <div className="title-row">
        <div><button className="link" onClick={() => history.length > 1 ? history.back() : go('bandeja')}>← Volver</button><span className="eyebrow">{p.brand_name.toUpperCase()} · {p.platform === 'instagram' ? 'INSTAGRAM' : p.platform === 'manual' ? 'INCORPORACIÓN MANUAL' : 'SITIO WEB'}</span><h1>{p.title || 'Sin título'}</h1>
          <div className="tags"><StatusPill status={p.status} />{p.category && <span className="tag">{CATEGORY_LABELS[p.category]}</span>}<span className="muted small">Publicado {fmtDate(p.published_at)} · detectado {fmtDate(p.detected_at, true)}</span></div></div>
        <Score score={p.score} priority={p.priority} />
      </div>

      {cur?.needs_ai ? <p className="alert warn"><strong>Requiere adaptación con IA.</strong> El original no está en español y no hay IA configurada, por lo que no se tradujo ni se inventó nada. Configura <code>AI_API_KEY</code> y pulsa «Regenerar», o redacta el copy manualmente.</p> : null}
      {cur && cur.source === 'heuristic' && !cur.needs_ai && <p className="alert info">Copy generado sin IA (solo ajustes de tuteo/léxico sobre el texto original). Revísalo con atención.</p>}

      <div className="detail">
        <div className="stack">
          <section className="panel"><div className="media-box"><Media p={p} /></div>
            <div className="pad-sm between"><small className="muted">{p.media_rights === 'confirmed_by_editor' ? '✔ Archivo propio en R2 con derechos confirmados' : p.media_url ? 'Imagen enlazada desde la fuente (solo referencia; no usar sin permiso)' : 'Sin material visual'}</small>
              <button className="btn small" onClick={() => { setAux({ ...aux, rights: false }); setDialog('media'); }}>Subir material</button></div></section>
          <section className="panel"><div className="panel-head"><h3>Texto original</h3><a className="link" href={p.source_url} target="_blank" rel="noopener noreferrer">Ver fuente ↗</a></div><div className="pad pre">{p.original_text}</div></section>
          <section className="panel"><div className="panel-head"><h3>Análisis editorial</h3><small className="muted">{analysis ? (analysis.provider === 'heuristic' ? 'Reglas (sin IA)' : `${analysis.provider} · ${analysis.model}`) : ''}</small></div>
            <div className="pad">{analysis ? <><p>{analysis.explanation}</p>{flags.length > 0 && <div className="tags">{flags.map((f) => <span key={f} className="tag">{f}</span>)}</div>}</> : <p className="muted">Sin análisis todavía.</p>}</div></section>
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h3>Copy adaptado · español de Chile</h3><small className="muted">{cur ? `v${cur.version} · ${cur.source === 'ai' ? 'IA' : cur.source === 'manual' ? 'editado' : 'sin IA'}` : ''}</small></div>
            <div className="pad">
              {cur ? <>
                <textarea className="copy" value={text} onChange={(e) => setText(e.target.value)} maxLength={2200} aria-label="Copy adaptado" />
                <div className="between"><small className="muted">{text.length}/2200</small></div>
                <div className="field"><label>Hashtags</label><input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
                {dirty && <button className="btn" disabled={!!busy} onClick={saveCopy}>Guardar edición</button>}
              </> : <p className="muted">Aún no hay copy generado.</p>}
            </div>
          </section>
          {report && <section className="panel"><div className="panel-head"><h3>Informe del Editor</h3><span className={`pill ${report.approved ? 'ok' : 'err'}`}>{report.approved ? 'Sin bloqueos' : 'Con observaciones graves'}</span></div>
            <div className="pad-sm">{report.issues.length === 0 ? <p className="muted small pad-x">Sin observaciones: ortografía, tuteo y exactitud verificados.</p> : report.issues.map((i: any, n: number) => <div className="issue" key={n}><span className={`pill ${SEV[i.severity]}`}>{i.severity}</span><span>{i.message}</span></div>)}{report.corrected && <p className="muted small pad-x">El Editor aplicó correcciones automáticas al texto.</p>}</div></section>}
          <section className="panel"><div className="panel-head"><h3>Decisión</h3></div>
            <div className="pad actions wrap">
              <button className="btn ok" disabled={!!busy || !cur || p.status === 'approved'} onClick={() => { setAux({ ...aux, date: '' }); setDialog('approve'); }}>✓ Aprobar</button>
              <button className="btn" disabled={!!busy || p.status === 'saved'} onClick={() => act('save', {}, 'Guardado para después')}>Guardar para después</button>
              <button className="btn" disabled={!!busy} onClick={() => setDialog('regen')}>↻ Regenerar</button>
              <button className="btn danger" disabled={!!busy || p.status === 'discarded'} onClick={() => { setAux({ ...aux, reason: '' }); setDialog('discard'); }}>Descartar</button>
              {['approved', 'saved', 'discarded', 'irrelevant'].includes(p.status) && <button className="btn" disabled={!!busy} onClick={() => act('reset', {}, 'Devuelto a revisión')}>Devolver a revisión</button>}
            </div>
            {p.discard_reason && <p className="pad-x muted small">Motivo de descarte: {p.discard_reason}</p>}
            {calendar.length > 0 && <div className="pad-sm">{calendar.map((c: any) => <span key={c.id} className="pill neutral">📅 {fmtDate(c.planned_date)}</span>)}</div>}
            <p className="pad-x muted small">Aprobar no publica: el contenido queda en la biblioteca y, si lo indicas, con fecha tentativa en el calendario.</p>
          </section>
          <section className="panel"><div className="panel-head"><h3>Historial</h3></div><div className="pad-sm">
            {approvals.map((a: any) => <div className="conn" key={a.id}><div><strong>{a.action}</strong><small>{a.actor}{a.reason ? ` · ${a.reason}` : ''}</small></div><small className="muted">{fmtDate(a.created_at, true)}</small></div>)}
            {copies.length > 1 && <p className="muted small pad-x">{copies.length} versiones del copy guardadas.</p>}</div></section>
        </div>
      </div>

      {dialog === 'approve' && <Modal title="Aprobar contenido" onClose={() => setDialog(null)}>
        <p>El copy actual pasará a la biblioteca. No se publicará nada en redes.</p>
        <div className="field"><label>Fecha tentativa en calendario (opcional)</label><input type="date" value={aux.date} onChange={(e) => setAux({ ...aux, date: e.target.value })} /></div>
        {report && !report.approved && <p className="alert warn">El Editor dejó observaciones graves. Revísalas antes de aprobar.</p>}
        <div className="actions"><button className="btn" onClick={() => setDialog(null)}>Cancelar</button><button className="btn ok" disabled={!!busy} onClick={() => act('approve', { plannedDate: aux.date || undefined }, 'Contenido aprobado')}>Aprobar</button></div></Modal>}
      {dialog === 'discard' && <Modal title="Descartar contenido" onClose={() => setDialog(null)}>
        <div className="field"><label>Motivo del descarte (obligatorio)</label><textarea value={aux.reason} onChange={(e) => setAux({ ...aux, reason: e.target.value })} placeholder="Ej.: no aplica al mercado chileno, modelo no disponible…" /></div>
        <div className="actions"><button className="btn" onClick={() => setDialog(null)}>Cancelar</button><button className="btn danger" disabled={aux.reason.trim().length < 3 || !!busy} onClick={() => act('discard', { reason: aux.reason }, 'Contenido descartado')}>Descartar</button></div></Modal>}
      {dialog === 'regen' && <Modal title="Regenerar copy" onClose={() => setDialog(null)}>
        <div className="field"><label>Instrucciones para el Copywriter (opcional)</label><textarea value={aux.instructions} onChange={(e) => setAux({ ...aux, instructions: e.target.value })} placeholder="Ej.: más breve, tono más técnico, destacar la vida a bordo…" /></div>
        <div className="actions"><button className="btn" onClick={() => setDialog(null)}>Cancelar</button><button className="btn primary" disabled={!!busy} onClick={() => run('regen', () => api(`/publications/${id}/regenerate`, { body: { instructions: aux.instructions } }), 'Nueva versión generada')}>{busy === 'regen' ? 'Generando…' : 'Regenerar'}</button></div></Modal>}
      {dialog === 'media' && <Modal title="Subir material propio" onClose={() => setDialog(null)}>
        <p className="muted small">JPG, PNG, WebP, GIF o MP4 (máx. 25 MB). Solo material con autorización de uso.</p>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4" />
        <label className="check"><input type="checkbox" checked={aux.rights} onChange={(e) => setAux({ ...aux, rights: e.target.checked })} /> Confirmo que tengo los derechos para usar este material.</label>
        <div className="actions"><button className="btn" onClick={() => setDialog(null)}>Cancelar</button><button className="btn primary" disabled={!aux.rights || !!busy} onClick={() => { const f = fileRef.current?.files?.[0]; if (!f) return toast('Selecciona un archivo', 'err'); const fd = new FormData(); fd.set('file', f); fd.set('rightsConfirmed', 'true'); run('media', () => api(`/publications/${id}/media`, { form: fd }), 'Material subido'); }}>Subir</button></div></Modal>}
    </>
  );
}
