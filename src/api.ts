import type { AccountRow, Env, PubRow } from './types';
import { CATEGORIES } from './types';
import { authenticate, login, logoutResponse } from './lib/auth';
import { exec, getSettings, HIDDEN_SETTINGS, one, q, SETTING_DEFAULTS } from './lib/db';
import { HttpError, canonicalUrl, json, nowIso, uid, sha256Hex } from './lib/util';
import { assertPublicHttpsUrl } from './lib/safe-fetch';
import { buildManualItem } from './connectors/manual';
import { contentHash } from './agents/scout';
import { getLlm } from './agents/llm';
import { processPublication, reprocess, runMonitoring } from './agents/coordinator';
import { detectLang } from './lib/html';
import { logAgent } from './agents/log';

type Ctx = { req: Request; env: Env; url: URL; params: Record<string, string>; user: { email: string } };
type Handler = (c: Ctx) => Promise<Response>;
const routes: { method: string; re: RegExp; keys: string[]; handler: Handler; auth: boolean }[] = [];

function route(method: string, path: string, handler: Handler, auth = true) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
}

async function body<T = any>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'JSON inválido'); }
}
const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const user = r.auth ? await authenticate(req, env) : { email: '' };
      return await r.handler({ req, env, url, params, user });
    }
    throw new HttpError(404, 'Ruta no encontrada');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error('API error', (e as Error).stack || e);
    return json({ error: 'Error interno del servidor' }, 500);
  }
}

// ───────────── Público ─────────────
route('GET', '/api/health', async ({ env }) => {
  let db = false; try { db = (await one<{ ok: number }>(env, 'SELECT 1 ok'))?.ok === 1; } catch { /* db no lista */ }
  let llm: ReturnType<typeof getLlm> = null; try { llm = getLlm(env); } catch { /* config inválida */ }
  return json({ ok: db, db, r2: Boolean(env.MEDIA), authConfigured: Boolean(env.ADMIN_AUTH_SECRET && env.ADMIN_AUTH_SECRET.length >= 12),
    ai: { mode: llm ? 'ia' : 'heuristico', provider: llm?.provider ?? null, model: llm?.model ?? null },
    instagram: { configured: Boolean(env.META_ACCESS_TOKEN && env.META_IG_USER_ID) }, youtube: { configured: Boolean(env.YOUTUBE_API_KEY) }, workersAi: Boolean(env.AI), version: '1.0.0', time: nowIso() });
}, false);

route('POST', '/api/auth/login', async ({ req, env }) => {
  const b = await body(req);
  return login(req, env, str(b.email, 200), str(b.password, 500));
}, false);
route('POST', '/api/auth/logout', async () => logoutResponse(), false);
route('GET', '/api/me', async ({ user }) => json({ email: user.email }));

// ───────────── Dashboard ─────────────
route('GET', '/api/dashboard', async ({ env }) => {
  const [byStatus, byBrand, accounts, lastRun, top, upcoming, llm] = await Promise.all([
    q(env, `SELECT status, COUNT(*) n FROM publications GROUP BY status`),
    q(env, `SELECT b.id, b.name, SUM(p.status='pending') pending, SUM(p.status='approved') approved, COUNT(p.id) total FROM brands b LEFT JOIN publications p ON p.brand_id = b.id WHERE b.active = 1 GROUP BY b.id ORDER BY b.sort_order`),
    q(env, `SELECT a.id, a.platform, a.handle, a.url, a.connector, a.enabled, a.last_status, a.last_checked_at, a.last_error, b.name brand_name FROM social_accounts a JOIN brands b ON b.id = a.brand_id ORDER BY b.sort_order, a.platform`),
    one(env, `SELECT run_id, status, found, new_count, duplicates, message, created_at FROM monitoring_logs WHERE kind = 'run_end' ORDER BY id DESC LIMIT 1`),
    q(env, `SELECT p.id, p.title, p.score, p.priority, p.category, p.media_type, p.media_url, p.media_r2_key, b.name brand_name FROM publications p JOIN brands b ON b.id = p.brand_id WHERE p.status = 'pending' ORDER BY p.score DESC, p.detected_at DESC LIMIT 5`),
    q(env, `SELECT c.id, c.planned_date, p.id publication_id, p.title, b.name brand_name FROM editorial_calendar c JOIN publications p ON p.id = c.publication_id JOIN brands b ON b.id = p.brand_id WHERE c.planned_date >= date('now') ORDER BY c.planned_date LIMIT 5`),
    (() => { try { return getLlm(env); } catch { return null; } })(),
  ]);
  const counts: Record<string, number> = {}; for (const r of byStatus as any[]) counts[r.status] = r.n;
  return json({ counts, byBrand, accounts, lastRun, top, upcoming, ai: { mode: llm ? 'ia' : 'heuristico', provider: llm?.provider ?? null, model: llm?.model ?? null } });
});

async function ensureManualAccount(env: Env, brandId: string): Promise<AccountRow> {
  let acc = await one<AccountRow>(env, `SELECT * FROM social_accounts WHERE brand_id = ? AND connector = 'manual' LIMIT 1`, brandId);
  if (!acc) {
    const id = uid('acc_');
    await exec(env, `INSERT INTO social_accounts (id, brand_id, platform, url, connector, enabled, permission_status) VALUES (?,?,?,?,?,0,'manual')`, id, brandId, 'manual', 'manual://incorporacion', 'manual');
    acc = (await one<AccountRow>(env, 'SELECT * FROM social_accounts WHERE id = ?', id))!;
  }
  return acc;
}

// ───────────── Publicaciones ─────────────
const PUB_SELECT = `SELECT p.id, p.brand_id, b.name brand_name, p.account_id, p.source_url, p.title, p.category, p.score, p.priority, p.status, p.media_type, p.media_url, p.media_r2_key,
  p.published_at, p.detected_at, p.updated_at, p.original_lang, a.platform,
  substr(COALESCE((SELECT copy_es_cl FROM generated_copies c WHERE c.publication_id = p.id AND c.is_current = 1), p.original_text), 1, 280) snippet,
  (SELECT needs_ai FROM generated_copies c WHERE c.publication_id = p.id AND c.is_current = 1) needs_ai,
  (SELECT source FROM generated_copies c WHERE c.publication_id = p.id AND c.is_current = 1) copy_source
  FROM publications p JOIN brands b ON b.id = p.brand_id JOIN social_accounts a ON a.id = p.account_id`;

function listFilters(url: URL, forceStatus?: string) {
  const w: string[] = []; const b: unknown[] = [];
  const g = (k: string) => url.searchParams.get(k) || '';
  if (g('brand')) { w.push('p.brand_id = ?'); b.push(g('brand')); }
  if (g('category')) { w.push('p.category = ?'); b.push(g('category')); }
  const status = forceStatus ?? g('status'); if (status) { w.push('p.status = ?'); b.push(status); }
  if (g('priority')) { w.push('p.priority = ?'); b.push(g('priority')); }
  if (['video', 'image', 'none'].includes(g('media'))) { w.push('p.media_type = ?'); b.push(g('media')); }
  if (g('has_file') === '1') w.push('p.media_r2_key IS NOT NULL');
  if (g('from') && ISO_DATE.test(g('from'))) { w.push('date(COALESCE(p.published_at, p.detected_at)) >= ?'); b.push(g('from')); }
  if (g('to') && ISO_DATE.test(g('to'))) { w.push('date(COALESCE(p.published_at, p.detected_at)) <= ?'); b.push(g('to')); }
  if (g('q')) { w.push(`(p.title LIKE ? ESCAPE '\\' OR p.original_text LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM generated_copies c WHERE c.publication_id = p.id AND c.is_current = 1 AND c.copy_es_cl LIKE ? ESCAPE '\\'))`); const like = `%${g('q').replace(/[%_\\]/g, '\\$&')}%`; b.push(like, like, like); }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', binds: b };
}

async function listPubs(env: Env, url: URL, forceStatus?: string) {
  const { where, binds } = listFilters(url, forceStatus);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const order = url.searchParams.get('sort') === 'date' ? 'COALESCE(p.published_at, p.detected_at) DESC' : 'COALESCE(p.score, -1) DESC, p.detected_at DESC';
  const [items, total] = await Promise.all([
    q(env, `${PUB_SELECT} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...binds, limit, offset),
    one<{ n: number }>(env, `SELECT COUNT(*) n FROM publications p ${where}`, ...binds),
  ]);
  return json({ items, total: total?.n ?? 0, limit, offset });
}

route('GET', '/api/publications', ({ env, url }) => listPubs(env, url));
route('GET', '/api/library', ({ env, url }) => listPubs(env, url, 'approved'));

route('POST', '/api/publications/manual', async ({ req, env, user }) => {
  const b = await body(req);
  const brandId = str(b.brandId, 100);
  const brand = await one(env, 'SELECT id FROM brands WHERE id = ? AND active = 1', brandId);
  if (!brand) throw new HttpError(400, 'Selecciona una marca válida');
  const item = await buildManualItem(env, { url: str(b.url, 2000), text: str(b.text, 8000), title: str(b.title, 300), mediaUrl: str(b.mediaUrl, 2000) || undefined });
  const acc = await ensureManualAccount(env, brandId);
  const hash = await contentHash(item);
  const dup = await one<{ id: string }>(env, 'SELECT id FROM publications WHERE content_hash = ? OR (account_id = ? AND external_id = ?) LIMIT 1', hash, acc.id, item.externalId);
  if (dup) throw new HttpError(409, 'Esta publicación ya existe en el sistema', 'duplicate');
  const id = uid('pub_');
  await exec(env, `INSERT INTO publications (id, brand_id, account_id, source_url, external_id, content_hash, title, original_text, original_lang, media_type, media_url, published_at, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'new')`, id, brandId, acc.id, item.url, item.externalId, hash, item.title ?? null, item.text.slice(0, 8000), detectLang(item.text), item.mediaType ?? 'none', item.mediaUrl ?? null, item.publishedAt ?? null);
  await exec(env, `INSERT INTO approvals (id, publication_id, action, actor, reason) VALUES (?,?,?,?,?)`, uid('ap_'), id, 'manual_add', user.email, item.url);
  const llm = (() => { try { return getLlm(env); } catch { return null; } })();
  await processPublication({ env, llm, runId: uid('man_') }, id);
  return json({ id }, 201);
});

route('GET', '/api/publications/:id', async ({ env, params }) => {
  const pub = await one<PubRow & { brand_name: string }>(env, `SELECT p.*, b.name brand_name, a.platform, a.handle FROM publications p JOIN brands b ON b.id = p.brand_id JOIN social_accounts a ON a.id = p.account_id WHERE p.id = ?`, params.id);
  if (!pub) throw new HttpError(404, 'Publicación no encontrada');
  const [analysis, copies, approvals, calendar] = await Promise.all([
    one(env, 'SELECT * FROM editorial_analyses WHERE publication_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', params.id),
    q(env, 'SELECT * FROM generated_copies WHERE publication_id = ? ORDER BY version DESC', params.id),
    q(env, 'SELECT * FROM approvals WHERE publication_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30', params.id),
    q(env, 'SELECT * FROM editorial_calendar WHERE publication_id = ? ORDER BY planned_date', params.id),
  ]);
  return json({ publication: pub, analysis, copies, approvals, calendar });
});

route('POST', '/api/publications/:id/action', async ({ req, env, params, user }) => {
  const b = await body(req);
  const action = str(b.action, 20);
  const pub = await one<PubRow>(env, 'SELECT * FROM publications WHERE id = ?', params.id);
  if (!pub) throw new HttpError(404, 'Publicación no encontrada');
  const cur = await one<{ id: string; needs_ai: number }>(env, 'SELECT id, needs_ai FROM generated_copies WHERE publication_id = ? AND is_current = 1', params.id);
  const reason = str(b.reason, 500);
  let status: string;
  switch (action) {
    case 'approve': {
      if (!cur) throw new HttpError(409, 'No hay copy adaptado para aprobar');
      if (cur.needs_ai && b.force !== true) throw new HttpError(409, 'El copy está pendiente de adaptación con IA. Edítalo manualmente o regénéralo antes de aprobar.', 'needs_ai');
      status = 'approved'; break;
    }
    case 'discard': if (reason.length < 3) throw new HttpError(400, 'Indica el motivo del descarte'); status = 'discarded'; break;
    case 'save': status = 'saved'; break;
    case 'reset': status = 'pending'; break;
    case 'published': status = 'published'; break;   // registro manual: el editor lo subió él mismo desde Meta
    default: throw new HttpError(400, 'Acción no válida');
  }
  await exec(env, `UPDATE publications SET status = ?, discard_reason = ?, updated_at = ? WHERE id = ?`, status, action === 'discard' ? reason : null, nowIso(), params.id);
  await exec(env, `INSERT INTO approvals (id, publication_id, copy_id, action, actor, reason) VALUES (?,?,?,?,?,?)`, uid('ap_'), params.id, cur?.id ?? null, action, user.email, reason || null);
  if (action === 'approve' && ISO_DATE.test(str(b.plannedDate, 10))) {
    await exec(env, `INSERT INTO editorial_calendar (id, publication_id, copy_id, planned_date, channel) VALUES (?,?,?,?, 'instagram')`, uid('cal_'), params.id, cur?.id ?? null, str(b.plannedDate, 10));
  }
  return json({ ok: true, status });
});

route('PUT', '/api/publications/:id/copy', async ({ req, env, params, user }) => {
  const b = await body(req);
  const text = str(b.copy, 2200);
  if (text.length < 10) throw new HttpError(400, 'El copy es demasiado corto');
  const pub = await one(env, 'SELECT id FROM publications WHERE id = ?', params.id);
  if (!pub) throw new HttpError(404, 'Publicación no encontrada');
  const hashtags = (Array.isArray(b.hashtags) ? b.hashtags : []).map((h: unknown) => '#' + String(h).replace(/^#/, '').replace(/\s+/g, '')).filter((h: string) => h.length > 1).slice(0, 10);
  const prev = await one<{ v: number }>(env, 'SELECT COALESCE(MAX(version),0) v FROM generated_copies WHERE publication_id = ?', params.id);
  const id = uid('cp_');
  await exec(env, 'UPDATE generated_copies SET is_current = 0 WHERE publication_id = ?', params.id);
  await exec(env, `INSERT INTO generated_copies (id, publication_id, version, copy_es_cl, hashtags, source, needs_ai, is_current) VALUES (?,?,?,?,?, 'manual', 0, 1)`, id, params.id, (prev?.v ?? 0) + 1, text, JSON.stringify(hashtags));
  await exec(env, `INSERT INTO approvals (id, publication_id, copy_id, action, actor) VALUES (?,?,?, 'edit', ?)`, uid('ap_'), params.id, id, user.email);
  await exec(env, `UPDATE publications SET updated_at = ?, status = CASE WHEN status = 'new' THEN 'pending' ELSE status END WHERE id = ?`, nowIso(), params.id);
  const { lintChileanSpanish } = await import('./lib/chilean');
  return json({ id, issues: lintChileanSpanish(text) });
});

route('POST', '/api/publications/:id/regenerate', async ({ req, env, params, user }) => {
  const b = await body(req).catch(() => ({} as any));
  const llm = (() => { try { return getLlm(env); } catch { return null; } })();
  await processPublication({ env, llm, runId: uid('reg_') }, params.id, { feedback: str(b.instructions, 800) || undefined, copyOnly: true });
  await exec(env, `INSERT INTO approvals (id, publication_id, action, actor, reason) VALUES (?,?, 'regenerate', ?, ?)`, uid('ap_'), params.id, user.email, str(b.instructions, 500) || null);
  return json({ ok: true, aiMode: llm ? 'ia' : 'heuristico' });
});

// ───────────── Reels y medios (R2) ─────────────
const MEDIA_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;   // límite de cuerpo de solicitud de Workers (planes Free/Pro)

/** Alta de un reel (o enlace) en el panel. El archivo se sube después, en streaming, a /publications/:id/media-file. */
route('POST', '/api/reels', async ({ req, env, user }) => {
  const b = await body(req);
  const brandId = str(b.brandId, 100);
  if (!(await one(env, 'SELECT id FROM brands WHERE id = ? AND active = 1', brandId))) throw new HttpError(400, 'Selecciona una marca válida');
  const rawUrl = str(b.url, 2000); const fileName = str(b.fileName, 200); const fileSize = Number(b.fileSize) || 0;
  if (!rawUrl && !fileName) throw new HttpError(400, 'Indica el enlace del reel o sube un archivo');
  let url = '';
  if (rawUrl) url = canonicalUrl(assertPublicHttpsUrl(rawUrl).toString());
  const caption = str(b.caption, 8000); const title = str(b.title, 300) || null;
  const externalId = url || `file:${fileName}:${fileSize}`;
  const acc = await ensureManualAccount(env, brandId);
  const hash = await sha256Hex(`reel|${externalId}`);
  const dup = await one<{ id: string }>(env, 'SELECT id FROM publications WHERE content_hash = ? OR (account_id = ? AND external_id = ?) LIMIT 1', hash, acc.id, externalId);
  if (dup) throw new HttpError(409, 'Este reel ya está en el panel', 'duplicate');
  const id = uid('pub_');
  await exec(env, `INSERT INTO publications (id, brand_id, account_id, source_url, external_id, content_hash, title, original_text, original_lang, media_type, published_at, status)
    VALUES (?,?,?,?,?,?,?,?,?, 'video', ?, 'pending')`, id, brandId, acc.id, url || 'manual://archivo', externalId, hash, title, caption, caption ? detectLang(caption) : null, str(b.publishedAt, 30) || null);
  await exec(env, `INSERT INTO approvals (id, publication_id, action, actor, reason) VALUES (?,?, 'manual_add', ?, ?)`, uid('ap_'), id, user.email, url || fileName);
  let processed = false;
  if (caption.length >= 10) {
    const llm = (() => { try { return getLlm(env); } catch { return null; } })();
    try { await processPublication({ env, llm, runId: uid('reel_') }, id); processed = true; } catch (e) { console.error('reel process', (e as Error).message); }
  }
  return json({ id, processed }, 201);
});

/** Completa o corrige el texto original de una publicación (p. ej. el caption del reel) y regenera análisis y copy. */
route('PUT', '/api/publications/:id/original', async ({ req, env, params, user }) => {
  const b = await body(req);
  const text = str(b.text, 8000);
  if (text.length < 10) throw new HttpError(400, 'Pega el texto original del reel (mínimo 10 caracteres)');
  const pub = await one<PubRow>(env, 'SELECT * FROM publications WHERE id = ?', params.id);
  if (!pub) throw new HttpError(404, 'Publicación no encontrada');
  const hash = await contentHash({ title: str(b.title, 300), text });
  const clash = await one<{ id: string }>(env, 'SELECT id FROM publications WHERE content_hash = ? AND id != ?', hash, params.id);
  const finalHash = clash ? await sha256Hex(`${hash}|${params.id}`) : hash;
  let url = pub.source_url;
  if (b.url !== undefined && str(b.url, 2000)) url = canonicalUrl(assertPublicHttpsUrl(str(b.url, 2000)).toString());
  await exec(env, `UPDATE publications SET title = ?, original_text = ?, original_lang = ?, content_hash = ?, source_url = ?, updated_at = ? WHERE id = ?`,
    str(b.title, 300) || null, text, detectLang(text), finalHash, url, nowIso(), params.id);
  await exec(env, `INSERT INTO approvals (id, publication_id, action, actor, reason) VALUES (?,?, 'edit_original', ?, NULL)`, uid('ap_'), params.id, user.email);
  const llm = (() => { try { return getLlm(env); } catch { return null; } })();
  await processPublication({ env, llm, runId: uid('orig_') }, params.id);
  return json({ ok: true, aiMode: llm ? 'ia' : 'heuristico' });
});

/** Sube el archivo (video o imagen) en streaming directo a R2, sin cargarlo en memoria. Cuerpo = bytes del archivo. */
route('POST', '/api/publications/:id/media-file', async ({ req, env, url, params, user }) => {
  if (url.searchParams.get('rights') !== '1') throw new HttpError(400, 'Debes confirmar que cuentas con los derechos de uso del material.', 'rights_required');
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = MEDIA_TYPES[type];
  if (!ext) throw new HttpError(415, 'Formato no permitido (MP4, MOV, JPG, PNG, WebP o GIF)');
  const size = Number(req.headers.get('content-length') || 0);
  if (!size) throw new HttpError(411, 'Falta el tamaño del archivo');
  if (size > (type.startsWith('video') ? MAX_VIDEO : MAX_IMAGE)) throw new HttpError(413, type.startsWith('video') ? 'El video supera 100 MB' : 'La imagen supera 25 MB');
  const pub = await one<PubRow>(env, 'SELECT * FROM publications WHERE id = ?', params.id);
  if (!pub) throw new HttpError(404, 'Publicación no encontrada');
  if (!req.body) throw new HttpError(400, 'Cuerpo vacío');
  const key = `publications/${params.id}/${uid()}.${ext}`;
  await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: type }, customMetadata: { uploadedBy: user.email, rights: 'confirmed_by_editor', fileName: (url.searchParams.get('name') || '').slice(0, 200) } });
  if (pub.media_r2_key) await env.MEDIA.delete(pub.media_r2_key).catch(() => {});
  await exec(env, `UPDATE publications SET media_r2_key = ?, media_rights = 'confirmed_by_editor', media_type = ?, updated_at = ? WHERE id = ?`, key, type.startsWith('video') ? 'video' : 'image', nowIso(), params.id);
  await exec(env, `INSERT INTO approvals (id, publication_id, action, actor, reason) VALUES (?,?, 'media', ?, 'archivo subido; derechos confirmados por el editor')`, uid('ap_'), params.id, user.email);
  return json({ key, size }, 201);
});

/** Reproduce o descarga el archivo propio. Soporta Range (necesario para adelantar videos en Safari/iOS). */
route('GET', '/api/publications/:id/media', async ({ req, env, url, params }) => {
  const pub = await one<PubRow & { brand_name: string }>(env, 'SELECT p.media_r2_key, p.media_type, b.name brand_name FROM publications p JOIN brands b ON b.id = p.brand_id WHERE p.id = ?', params.id);
  if (!pub?.media_r2_key) throw new HttpError(404, 'Sin archivo');
  const hasRange = req.headers.has('range');
  const obj = await env.MEDIA.get(pub.media_r2_key, hasRange ? { range: req.headers } : undefined);
  if (!obj) throw new HttpError(404, 'Archivo no encontrado');
  const headers: Record<string, string> = {
    'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes',
  };
  if (url.searchParams.get('download') === '1') {
    const ext = pub.media_r2_key.split('.').pop();
    headers['content-disposition'] = `attachment; filename="${pub.brand_name.replace(/[^A-Za-z0-9]+/g, '-')}-${params.id.slice(-6)}.${ext}"`;
  }
  const r = (obj as any).range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (hasRange && r) {
    const start = r.suffix !== undefined ? obj.size - r.suffix : r.offset ?? 0;
    const len = r.suffix !== undefined ? r.suffix : r.length ?? obj.size - start;
    headers['content-range'] = `bytes ${start}-${start + len - 1}/${obj.size}`; headers['content-length'] = String(len);
    return new Response((obj as R2ObjectBody).body, { status: 206, headers });
  }
  headers['content-length'] = String(obj.size);
  return new Response((obj as R2ObjectBody).body, { headers });
});

// ───────────── Calendario ─────────────
route('GET', '/api/calendar', async ({ env, url }) => {
  const from = url.searchParams.get('from') || '0000-01-01'; const to = url.searchParams.get('to') || '9999-12-31';
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new HttpError(400, 'Fechas inválidas');
  return json({ items: await q(env, `SELECT c.id, c.planned_date, c.channel, c.note, c.publication_id, p.title, p.status, p.media_type, p.media_url, p.media_r2_key, b.name brand_name,
    substr((SELECT copy_es_cl FROM generated_copies g WHERE g.publication_id = p.id AND g.is_current = 1), 1, 140) snippet
    FROM editorial_calendar c JOIN publications p ON p.id = c.publication_id JOIN brands b ON b.id = p.brand_id WHERE c.planned_date BETWEEN ? AND ? ORDER BY c.planned_date`, from, to) });
});
route('POST', '/api/calendar', async ({ req, env }) => {
  const b = await body(req);
  if (!ISO_DATE.test(str(b.plannedDate, 10))) throw new HttpError(400, 'Fecha inválida (AAAA-MM-DD)');
  const pub = await one<{ id: string }>(env, `SELECT id FROM publications WHERE id = ? AND status = 'approved'`, str(b.publicationId, 60));
  if (!pub) throw new HttpError(400, 'Solo se pueden calendarizar contenidos aprobados');
  const cur = await one<{ id: string }>(env, 'SELECT id FROM generated_copies WHERE publication_id = ? AND is_current = 1', pub.id);
  const id = uid('cal_');
  await exec(env, `INSERT INTO editorial_calendar (id, publication_id, copy_id, planned_date, channel, note) VALUES (?,?,?,?, 'instagram', ?)`, id, pub.id, cur?.id ?? null, str(b.plannedDate, 10), str(b.note, 300) || null);
  return json({ id }, 201);
});
route('PUT', '/api/calendar/:id', async ({ req, env, params }) => {
  const b = await body(req);
  if (!ISO_DATE.test(str(b.plannedDate, 10))) throw new HttpError(400, 'Fecha inválida');
  await exec(env, 'UPDATE editorial_calendar SET planned_date = ?, note = COALESCE(?, note) WHERE id = ?', str(b.plannedDate, 10), b.note === undefined ? null : str(b.note, 300), params.id);
  return json({ ok: true });
});
route('DELETE', '/api/calendar/:id', async ({ env, params }) => { await exec(env, 'DELETE FROM editorial_calendar WHERE id = ?', params.id); return json({ ok: true }); });

// ───────────── Marcas, cuentas y monitoreo ─────────────
route('GET', '/api/brands', async ({ env }) => {
  const brands = await q(env, 'SELECT * FROM brands ORDER BY sort_order, name');
  const accounts = await q(env, 'SELECT * FROM social_accounts ORDER BY brand_id, platform');
  return json({ brands, accounts, categories: CATEGORIES, instagramConfigured: Boolean(env.META_ACCESS_TOKEN && env.META_IG_USER_ID) });
});

route('POST', '/api/brands', async ({ req, env }) => {
  const b = await body(req);
  const name = str(b.name, 100); if (name.length < 2) throw new HttpError(400, 'Nombre requerido');
  const id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (await one(env, 'SELECT id FROM brands WHERE id = ?', id)) throw new HttpError(409, 'Ya existe una marca con ese nombre');
  const order = (await one<{ n: number }>(env, 'SELECT COALESCE(MAX(sort_order),0)+1 n FROM brands'))!.n;
  await exec(env, `INSERT INTO brands (id, name, category, country, editorial_profile, keywords, sort_order) VALUES (?,?,?,?,?,?,?)`, id, name, str(b.category, 100) || 'General', str(b.country, 60) || null, str(b.editorialProfile, 500) || null, JSON.stringify(Array.isArray(b.keywords) ? b.keywords.map(String).slice(0, 30) : []), order);
  return json({ id }, 201);
});
route('PUT', '/api/brands/:id', async ({ req, env, params }) => {
  const b = await body(req);
  await exec(env, `UPDATE brands SET name = COALESCE(?, name), category = COALESCE(?, category), editorial_profile = COALESCE(?, editorial_profile), active = COALESCE(?, active) WHERE id = ?`,
    b.name ? str(b.name, 100) : null, b.category ? str(b.category, 100) : null, b.editorialProfile !== undefined ? str(b.editorialProfile, 500) : null, b.active === undefined ? null : b.active ? 1 : 0, params.id);
  return json({ ok: true });
});

const CONNECTOR_PLATFORM: Record<string, string> = { instagram_discovery: 'instagram', html_news: 'web', rss: 'rss', youtube_api: 'youtube' };
function validateAccountInput(b: any, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.connector !== undefined) { if (!CONNECTOR_PLATFORM[str(b.connector, 40)]) throw new HttpError(400, 'Conector no válido'); out.connector = str(b.connector, 40); }
  if (b.url !== undefined || !partial) {
    const url = str(b.url, 2000);
    if (out.connector === 'instagram_discovery' || (partial && url.includes('instagram.com'))) { if (!/^https:\/\/(www\.)?instagram\.com\//.test(url)) throw new HttpError(400, 'URL de Instagram inválida'); }
    else if (out.connector === 'youtube_api') { if (!/^https:\/\/(www\.)?youtube\.com\//.test(url)) throw new HttpError(400, 'URL de YouTube inválida'); }
    else assertPublicHttpsUrl(url);
    out.url = url;
  }
  if (b.config !== undefined) {
    const c = b.config; if (typeof c !== 'object' || c === null || Array.isArray(c)) throw new HttpError(400, 'Configuración inválida');
    if (c.listUrl) assertPublicHttpsUrl(String(c.listUrl));
    if (c.linkPattern) { try { new RegExp(String(c.linkPattern)); } catch { throw new HttpError(400, 'linkPattern no es una expresión regular válida'); } }
    for (const h of c.allowedHosts ?? []) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(h))) throw new HttpError(400, `Dominio permitido inválido: ${h}`);
    out.config_json = JSON.stringify({ lines: c.lines, listUrl: c.listUrl, linkPattern: c.linkPattern, allowedHosts: c.allowedHosts, maxItems: c.maxItems ? Math.min(Number(c.maxItems) || 5, 10) : undefined, viaReader: c.viaReader === true ? true : undefined, channelId: typeof c.channelId === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(c.channelId) ? c.channelId : undefined });
  }
  if (b.handle !== undefined) out.handle = str(b.handle, 60).replace(/^@/, '') || null;
  return out;
}
route('POST', '/api/accounts', async ({ req, env }) => {
  const b = await body(req);
  if (!(await one(env, 'SELECT id FROM brands WHERE id = ?', str(b.brandId, 100)))) throw new HttpError(400, 'Marca inválida');
  const v = validateAccountInput(b, false); const id = uid('acc_');
  await exec(env, `INSERT INTO social_accounts (id, brand_id, platform, handle, url, connector, config_json, enabled, permission_status) VALUES (?,?,?,?,?,?,?,0,?)`,
    id, str(b.brandId, 100), CONNECTOR_PLATFORM[v.connector as string], (v.handle as string) ?? null, v.url, v.connector, (v.config_json as string) ?? '{}', v.connector === 'instagram_discovery' ? 'requires_meta_credentials' : 'public_site_robots_respected');
  return json({ id }, 201);
});
route('PUT', '/api/accounts/:id', async ({ req, env, params }) => {
  const b = await body(req);
  const v = validateAccountInput(b, true);
  await exec(env, `UPDATE social_accounts SET enabled = COALESCE(?, enabled), url = COALESCE(?, url), handle = COALESCE(?, handle), config_json = COALESCE(?, config_json) WHERE id = ?`,
    b.enabled === undefined ? null : b.enabled ? 1 : 0, (v.url as string) ?? null, (v.handle as string) ?? null, (v.config_json as string) ?? null, params.id);
  return json({ ok: true });
});

route('POST', '/api/monitor/run', async ({ req, env }) => {
  const b = await body(req).catch(() => ({} as any));
  return json(await runMonitoring(env, { trigger: 'manual', brandId: str(b.brandId, 100) || undefined, accountId: str(b.accountId, 100) || undefined }));
});
route('POST', '/api/monitor/reprocess', async ({ req, env, user }) => {
  const b = await body(req).catch(() => ({} as any));
  const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 25) : undefined;
  const r = await reprocess(env, { ids, limit: Number(b.limit) || 10, scope: ['heuristic', 'failed', 'all_pending'].includes(b.scope) ? b.scope : 'heuristic' });
  await logAgent(env, { runId: r.runId, agent: 'coordinator', status: 'ok', message: `Reproceso solicitado por ${user.email}` });
  return json(r);
});

// ───────────── Logs y ajustes ─────────────
route('GET', '/api/logs', async ({ env, url }) => {
  const type = url.searchParams.get('type') || 'monitoring';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 300);
  if (type === 'agents') return json({ items: await q(env, `SELECT l.*, p.title FROM agent_logs l LEFT JOIN publications p ON p.id = l.publication_id ORDER BY l.id DESC LIMIT ?`, limit) });
  if (type === 'audit') return json({ items: await q(env, `SELECT a.*, p.title FROM approvals a LEFT JOIN publications p ON p.id = a.publication_id ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`, limit) });
  return json({ items: await q(env, `SELECT l.*, a.handle, a.platform, b.name brand_name FROM monitoring_logs l LEFT JOIN social_accounts a ON a.id = l.account_id LEFT JOIN brands b ON b.id = a.brand_id ORDER BY l.id DESC LIMIT ?`, limit) });
});

route('GET', '/api/settings', async ({ env }) => json(await getSettings(env)));
route('PUT', '/api/settings', async ({ req, env }) => {
  const b = await body(req);
  for (const [k, v] of Object.entries(b)) {
    if (!(k in SETTING_DEFAULTS) || HIDDEN_SETTINGS.includes(k)) throw new HttpError(400, `Ajuste desconocido: ${k}`);
    const val = String(v).trim().slice(0, 2000);
    if (k === 'monitoring_enabled' && !['0', '1'].includes(val)) throw new HttpError(400, 'monitoring_enabled debe ser 0 o 1');
    if (k === 'monitoring_hours_local' && !/^\d{1,2}(,\d{1,2})*$/.test(val.replace(/\s/g, '')) ) throw new HttpError(400, 'Horas locales inválidas (ej.: 8 o 8,18)');
    if (['max_new_per_account', 'max_new_per_run', 'max_age_days'].includes(k) && !(Number(val) >= 1 && Number(val) <= 100)) throw new HttpError(400, `${k} debe estar entre 1 y 100`);
    await exec(env, `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, k, val.replace(/\s/g, '') && k === 'monitoring_hours_local' ? val.replace(/\s/g, '') : val, nowIso());
  }
  return json(await getSettings(env));
});
