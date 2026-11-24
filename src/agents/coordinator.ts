import type { AccountConfig, AccountRow, BrandRow, Env, PubRow } from '../types';
import { CONNECTORS } from '../connectors';
import type { RobotsCache } from '../lib/robots';
import { exec, getSettings, one, q } from '../lib/db';
import { detectLang } from '../lib/html';
import { translateToSpanish } from '../lib/translate';
import { nowIso, priorityFor, uid, withRetry } from '../lib/util';
import { curate } from './curator';
import { writeCopy } from './copywriter';
import { hasBlocking, reviewCopy } from './editor';
import { getLlm } from './llm';
import { logAgent, logMonitor, type AgentCtx } from './log';
import { scout, knownUrls } from './scout';
import { COST, remaining, resetBudget } from '../lib/budget';

const LOCK_TTL_MS = 10 * 60_000;

export async function acquireLock(env: Env, runId: string): Promise<boolean> {
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('monitoring_lock', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2
     WHERE CASE WHEN json_valid(settings.value) THEN COALESCE(json_extract(settings.value, '$.expiresAt'), 0) ELSE 0 END < ?3`,
  ).bind(JSON.stringify({ runId, expiresAt: now + LOCK_TTL_MS }), nowIso(), now).run();
  return (res.meta.changes ?? 0) > 0;
}
export async function releaseLock(env: Env, runId: string) {
  await exec(env, `UPDATE settings SET value = '{"expiresAt":0}' WHERE key = 'monitoring_lock' AND json_valid(value) AND json_extract(value,'$.runId') = ?`, runId);
}

export function parseConfig(a: AccountRow): AccountConfig { try { return JSON.parse(a.config_json || '{}'); } catch { return {}; } }

export interface RunSummary { runId: string; status: 'ok' | 'locked' | 'disabled' | 'partial'; accounts: number; found: number; created: number; duplicates: number; irrelevant: number; errors: number; aiMode: 'ia' | 'heuristico'; deferred: number; budgetCut: boolean }

/** Persiste análisis + copy y deja la publicación lista para revisión humana. NUNCA publica. */
export async function processPublication(ctx: AgentCtx, pubId: string, o: { feedback?: string; copyOnly?: boolean } = {}): Promise<{ status: string }> {
  const { env } = ctx;
  const pub = await one<PubRow>(env, 'SELECT * FROM publications WHERE id = ?', pubId);
  if (!pub) throw new Error('Publicación no existe');
  const account = (await one<AccountRow>(env, 'SELECT * FROM social_accounts WHERE id = ?', pub.account_id))!;
  const cfg = parseConfig(account);
  const lineIds = cfg.lines?.length ? cfg.lines : [account.brand_id];
  const lines = (await q<BrandRow>(env, `SELECT * FROM brands WHERE id IN (${lineIds.map(() => '?').join(',')})`, ...lineIds));
  const defaultBrand = lines.find((l) => l.id === account.brand_id) ?? lines[0] ?? (await one<BrandRow>(env, 'SELECT * FROM brands WHERE id = ?', account.brand_id))!;
  const settings = await getSettings(env);

  let brand = lines.find((l) => l.id === pub.brand_id) ?? defaultBrand;
  let category = pub.category;
  if (!o.copyOnly) {
    const a = await curate(ctx, pub, lines.length ? lines : [defaultBrand], defaultBrand);
    brand = lines.find((l) => l.id === a.brandId) ?? defaultBrand; category = a.category;
    await exec(env, `INSERT INTO editorial_analyses (id, publication_id, relevant, category, score, explanation, flags_json, provider, model) VALUES (?,?,?,?,?,?,?,?,?)`,
      uid('an_'), pub.id, a.relevant ? 1 : 0, a.category, a.score, a.explanation, JSON.stringify(a.flags), a.provider, a.model);
    if (!a.relevant) {
      await exec(env, `UPDATE publications SET status='irrelevant', category=?, score=?, priority='baja', brand_id=?, updated_at=? WHERE id=?`, a.category, a.score, a.brandId, nowIso(), pub.id);
      return { status: 'irrelevant' };
    }
    await exec(env, `UPDATE publications SET category=?, score=?, priority=?, brand_id=?, updated_at=? WHERE id=?`, a.category, a.score, priorityFor(a.score), a.brandId, nowIso(), pub.id);
  }

  // Traducción literal de referencia (Workers AI) para que el editor lea el original en español.
  const source = `${pub.title ?? ''}\n${pub.original_text}`;
  const lang = detectLang(source);
  if (!pub.original_es && lang !== 'es' && lang !== 'other' && remaining() > 18) {   // la traducción es solo referencia: se omite si el presupuesto está justo
    const tr = await translateToSpanish(env, `${pub.title ? pub.title + '\n\n' : ''}${pub.original_text}`, lang);
    if (tr) await exec(env, 'UPDATE publications SET original_es = ? WHERE id = ?', tr, pub.id);
  }

  // Copywriter -> Editor, con una vuelta de corrección si el Editor encuentra errores bloqueantes.
  let draft = await writeCopy(ctx, pub, brand, { category, toneGuide: settings.tone_guide, feedback: o.feedback });
  let report = await reviewCopy(ctx, pub, draft.copy, draft.needsAi);
  if (hasBlocking(report.issues) && ctx.llm && !draft.needsAi) {
    draft = await writeCopy(ctx, pub, brand, { category, toneGuide: settings.tone_guide, feedback: o.feedback, issues: report.issues.filter((i) => i.severity !== 'baja'), previous: draft.copy });
    report = await reviewCopy(ctx, pub, draft.copy, draft.needsAi);
  }
  const finalCopy = report.correctedCopy ?? draft.copy;
  const prev = await one<{ v: number }>(env, 'SELECT COALESCE(MAX(version),0) v FROM generated_copies WHERE publication_id = ?', pub.id);
  await exec(env, 'UPDATE generated_copies SET is_current = 0 WHERE publication_id = ?', pub.id);
  const copyId = uid('cp_');
  await exec(env, `INSERT INTO generated_copies (id, publication_id, version, copy_es_cl, hashtags, source, needs_ai, provider, model, editor_report_json, is_current) VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
    copyId, pub.id, (prev?.v ?? 0) + 1, finalCopy, JSON.stringify(draft.hashtags), draft.source, draft.needsAi ? 1 : 0, draft.provider, draft.model, JSON.stringify({ approved: report.approved, issues: report.issues, provider: report.provider, model: report.model, corrected: Boolean(report.correctedCopy) }));
  await exec(env, `UPDATE publications SET status = CASE WHEN status IN ('new','pending') THEN 'pending' ELSE status END, original_lang = COALESCE(original_lang, ?), updated_at=? WHERE id=?`, detectLang(source), nowIso(), pub.id);
  return { status: 'pending' };
}

export async function runMonitoring(env: Env, opts: { trigger: 'cron' | 'manual'; brandId?: string; accountId?: string; dueOnly?: boolean; dueSince?: string }): Promise<RunSummary> {
  resetBudget(env.SUBREQUEST_BUDGET);
  const runId = uid('run_');
  const llm = (() => { try { return getLlm(env); } catch { return null; } })();
  const sum: RunSummary = { runId, status: 'ok', accounts: 0, found: 0, created: 0, duplicates: 0, irrelevant: 0, errors: 0, aiMode: llm ? 'ia' : 'heuristico', deferred: 0, budgetCut: false };
  const settings = await getSettings(env);
  if (opts.trigger === 'cron' && settings.monitoring_enabled !== '1') { sum.status = 'disabled'; return sum; }
  let sql = `SELECT a.* FROM social_accounts a JOIN brands b ON b.id = a.brand_id WHERE a.enabled = 1 AND b.active = 1 AND a.connector != 'manual'`;
  const binds: unknown[] = [];
  if (opts.accountId) { sql += ' AND a.id = ?'; binds.push(opts.accountId); }
  if (opts.brandId) { sql += ' AND a.brand_id = ?'; binds.push(opts.brandId); }
  if (opts.dueOnly) { sql += ' AND (a.last_checked_at IS NULL OR a.last_checked_at < ?)'; binds.push((opts.dueSince ?? new Date(Date.now() - 20 * 3600_000).toISOString()).replace('T', ' ').slice(0, 19)); }
  sql += ` ORDER BY COALESCE(a.last_checked_at, '') ASC`;   // la menos revisada primero: así nadie queda sin turno si el presupuesto se acaba
  const accounts = await q<AccountRow>(env, sql, ...binds);
  if (opts.dueOnly && !accounts.length) return sum;      // nada pendiente: no deja ruido en los registros
  if (!(await acquireLock(env, runId))) {
    await logMonitor(env, { runId, kind: 'skipped', status: 'locked', message: 'Ya hay una ejecución en curso (candado activo).' });
    sum.status = 'locked'; return sum;
  }
  const ctx: AgentCtx = { env, llm, runId };
  const robots: RobotsCache = new Map();
  const maxPerAccount = Math.max(1, Number(settings.max_new_per_account) || 5);
  let budget = Math.max(1, Number(settings.max_new_per_run) || 12);
  const maxAge = Math.max(1, Number(settings.max_age_days) || 45);
  try {
    await logMonitor(env, { runId, kind: 'run_start', message: `${opts.trigger} · modo ${sum.aiMode}` });
    for (const account of accounts) {
      if (remaining() < COST.account) { sum.budgetCut = true; break; }   // sin presupuesto del plan: el resto se retoma en la siguiente hora
      sum.accounts++;
      const connector = CONNECTORS[account.connector];
      if (!connector) { await markAccount(env, account.id, 'error', `Conector desconocido: ${account.connector}`); sum.errors++; continue; }
      if (budget <= 0) { await logMonitor(env, { runId, kind: 'account', accountId: account.id, status: 'skipped', message: 'Límite de publicaciones por ejecución alcanzado' }); continue; }
      try {
        const known = await knownUrls(env, account.id);
        const res = await connector.fetchItems(account, parseConfig(account), {
          env, robots, maxItems: Math.min(maxPerAccount, budget), maxAgeDays: maxAge, isKnownUrl: (u) => known.has(u),
        });
        await markAccount(env, account.id, res.status === 'ok' ? 'ok' : res.status, res.message ?? null);
        if (res.status !== 'ok') { await logMonitor(env, { runId, kind: 'account', accountId: account.id, status: res.status, message: res.message }); continue; }
        const { fresh, duplicates } = await scout(env, account, res.items);
        sum.found += res.items.length; sum.duplicates += duplicates;
        let created = 0;
        for (const it of fresh.slice(0, Math.min(maxPerAccount, budget))) {
          const id = uid('pub_');
          try {
            await exec(env, `INSERT INTO publications (id, brand_id, account_id, source_url, external_id, content_hash, title, original_text, original_lang, media_type, media_url, published_at, status)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'new')`, id, account.brand_id, account.id, it.url, it.externalId, it.hash, it.title ?? null, it.text.slice(0, 8000), detectLang(it.text), it.mediaType ?? 'none', it.mediaUrl ?? null, it.publishedAt ?? null);
          } catch { sum.duplicates++; continue; }   // carrera contra UNIQUE: duplicado
          created++; budget--; sum.created++;
          if (remaining() < COST.publication) { sum.deferred++; sum.budgetCut = true; continue; }   // queda 'new'; se procesa en el siguiente turno
          try {
            const r = await withRetry(async () => processPublication(ctx, id), { attempts: 2, baseMs: 800 });
            if (r.status === 'irrelevant') sum.irrelevant++;
          } catch (e) {
            sum.errors++;   // queda en 'new' para reintento (Reprocesar)
            await logAgent(env, { runId, publicationId: id, agent: 'coordinator', status: 'error', message: (e as Error).message });
          }
        }
        await logMonitor(env, { runId, kind: 'account', accountId: account.id, status: 'ok', found: res.items.length, newCount: created, duplicates, message: res.message });
      } catch (e) {
        sum.errors++;
        const msg = (e as Error).message;
        await markAccount(env, account.id, 'error', msg);
        await logMonitor(env, { runId, kind: 'account', accountId: account.id, status: 'error', message: msg });
      }
    }
    if (sum.errors) sum.status = 'partial';
    await logMonitor(env, { runId, kind: 'run_end', status: sum.status, found: sum.found, newCount: sum.created, duplicates: sum.duplicates, message: `${sum.accounts} cuentas, ${sum.irrelevant} irrelevantes, ${sum.errors} errores${sum.budgetCut ? `; límite del plan alcanzado (${sum.deferred} por procesar en la próxima hora)` : ''}` });
  } finally { await releaseLock(env, runId); }
  return sum;
}

/** Reprocesa publicaciones (p. ej. tras configurar IA real): las que están en 'new' o pendientes con copy heurístico. */
export async function reprocess(env: Env, opts: { ids?: string[]; limit?: number; scope?: 'heuristic' | 'failed' | 'all_pending'; keepBudget?: boolean }): Promise<{ runId: string; processed: number; errors: number; aiMode: string }> {
  if (!opts.keepBudget) resetBudget(env.SUBREQUEST_BUDGET);
  const runId = uid('rep_');
  const llm = (() => { try { return getLlm(env); } catch { return null; } })();
  const ctx: AgentCtx = { env, llm, runId };
  let ids = opts.ids;
  if (!ids) {
    const limit = Math.min(opts.limit ?? 10, 25);
    const scope = opts.scope ?? 'heuristic';
    const where = scope === 'failed' ? `p.status = 'new'`
      : scope === 'all_pending' ? `p.status = 'pending'`
      : `p.status = 'pending' AND EXISTS (SELECT 1 FROM generated_copies c WHERE c.publication_id = p.id AND c.is_current = 1 AND c.source = 'heuristic')`;
    ids = (await q<{ id: string }>(env, `SELECT p.id FROM publications p WHERE ${where} ORDER BY p.detected_at DESC LIMIT ?`, limit)).map((r) => r.id);
  }
  let processed = 0, errors = 0;
  for (const id of ids.slice(0, 25)) {
    if (remaining() < COST.publication) break;   // el resto se retoma en el siguiente turno
    try { await processPublication(ctx, id); processed++; } catch (e) { errors++; await logAgent(env, { runId, publicationId: id, agent: 'coordinator', status: 'error', message: (e as Error).message }); }
  }
  await logAgent(env, { runId, agent: 'coordinator', status: errors ? 'error' : 'ok', message: `Reproceso: ${processed} ok, ${errors} con error (${llm ? 'IA' : 'heurístico'})` });
  return { runId, processed, errors, aiMode: llm ? 'ia' : 'heuristico' };
}

async function markAccount(env: Env, id: string, status: string, error: string | null) {
  await exec(env, 'UPDATE social_accounts SET last_checked_at = ?, last_status = ?, last_error = ? WHERE id = ?', nowIso(), status, error, id);
}

/**
 * Ciclo de revisión cada N días: arranca un ciclo nuevo cuando coincide la hora local configurada y han pasado
 * (N·24 − 2) h desde el último inicio. Entre ciclos, los turnos horarios solo retoman fuentes aún no revisadas en el ciclo vigente.
 */
export function shouldStartCycle(hoursSetting: string, everyDays: number, cycleStartIso: string | null, now = new Date()): boolean {
  const days = Math.min(7, Math.max(1, Math.round(everyDays) || 1));
  const last = cycleStartIso ? Date.parse(cycleStartIso) : 0;
  const elapsedH = (now.getTime() - (isNaN(last) ? 0 : last)) / 3_600_000;
  return shouldRunNow(hoursSetting, now) && elapsedH >= days * 24 - 2;
}

/** ¿Toca ejecutar el cron ahora? Compara la hora local de Santiago con monitoring_hours_local ("8" o "8,18"). */
export function shouldRunNow(hoursSetting: string, now = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Santiago' }).format(now)) % 24;
  return hoursSetting.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n)).includes(h);
}
