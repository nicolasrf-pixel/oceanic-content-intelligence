import type { SourceConnector } from './types';
import type { RawItem } from '../types';
import { safeFetch, assertPublicHttpsUrl, hostAllowed } from '../lib/safe-fetch';
import { robotsAllows, type RobotsCache } from '../lib/robots';
import { extractLinks, extractMainText, firstContentImage, getMeta, getPublishedAt, getTitle } from '../lib/html';
import { firstImageFromMarkdown, linksFromMarkdown, markdownToText, readerFetch } from '../lib/reader';
import { canonicalUrl, RetryableError, withRetry } from '../lib/util';

const ASSET_EXT = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js|ico|xml)(\?|$)/i;
/** Rutas de índice/archivo/paginación que nunca son una noticia. */
const NOT_ARTICLE_PATH = /\/(tag|tags|category|categories|author|authors|page|feed|search|archive|archives)(\/|$)/i;

export function isArticleCandidate(u: URL, pattern: RegExp): boolean {
  return !ASSET_EXT.test(u.pathname) && !NOT_ARTICLE_PATH.test(u.pathname) && pattern.test(u.pathname) && u.pathname.split('/').filter(Boolean).length >= 2;
}

/** ¿Parece un artículo y no una página de sección/listado? Fecha, og:type=article, ruta /article/ o slug largo. */
export function looksLikeArticle(url: string, published?: string, ogType?: string): boolean {
  if (published || (ogType ?? '').toLowerCase() === 'article') return true;
  if ((ogType ?? '').toLowerCase() === 'blog') return false;
  const path = new URL(url).pathname;
  if (/\/(article|articles|post|posts)\/[^/]+$/i.test(path)) return true;
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  return slug.length >= 24 && slug.split('-').filter(Boolean).length >= 3;
}

type ArticleResult = { item?: RawItem; blockedByRobots?: boolean; skipped?: string };

async function articleViaReader(url: string, robots: RobotsCache): Promise<ArticleResult> {
  if (!(await robotsAllows(url, robots, 'reader'))) return { blockedByRobots: true };
  const page = await withRetry(() => readerFetch(url), { attempts: 3, baseMs: 2500 });
  if (!page.ok) return { skipped: 'el lector no pudo abrir la página' };
  const text = markdownToText(page.markdown);
  if (text.length < 80) return { skipped: 'texto insuficiente' };
  if (!looksLikeArticle(url, page.publishedAt)) return { skipped: 'página de sección o listado' };
  const image = firstImageFromMarkdown(page.markdown);
  return { item: { externalId: canonicalUrl(url), url: canonicalUrl(url), title: page.title, text, publishedAt: page.publishedAt, mediaType: image ? 'image' : 'none', mediaUrl: image } };
}

async function articleDirect(url: string, allowedHosts: string[] | undefined, robots: RobotsCache): Promise<ArticleResult> {
  if (!(await robotsAllows(url, robots))) return { blockedByRobots: true };
  const res = await withRetry(() => safeFetch(url, { allowedHosts }));
  if (res.status >= 400) return { skipped: `HTTP ${res.status}` };
  const html = res.text;
  const title = getTitle(html);
  const body = extractMainText(html);
  const desc = getMeta(html, 'og:description') ?? getMeta(html, 'description') ?? '';
  const text = (body.length > desc.length ? body : desc).trim();
  const image = getMeta(html, 'og:image') || firstContentImage(html, res.url);
  const video = getMeta(html, 'og:video');
  const published = getPublishedAt(html);
  if (text.length < 80) return { skipped: 'texto insuficiente' };
  if (!looksLikeArticle(res.url, published, getMeta(html, 'og:type'))) return { skipped: 'página de sección o listado' };
  let mediaUrl: string | undefined;
  try { const m = video || image; mediaUrl = m ? new URL(m, res.url).toString() : undefined; } catch { /* sin media */ }
  return { item: { externalId: canonicalUrl(res.url), url: canonicalUrl(res.url), title, text, publishedAt: published, mediaType: video ? 'video' : image ? 'image' : 'none', mediaUrl } };
}

/** Lee un artículo; si el sitio lo bloquea o falla (403/404/red), reintenta a través del lector. */
export async function articleFromUrl(url: string, allowedHosts: string[] | undefined, robots: RobotsCache, o: { viaReader?: boolean } = {}): Promise<ArticleResult> {
  if (o.viaReader) return articleViaReader(url, robots);
  let direct: ArticleResult;
  try { direct = await articleDirect(url, allowedHosts, robots); }
  catch (e) { if (e instanceof RetryableError) direct = { skipped: `error de red: ${e.message}` }; else throw e; }
  const blockedByStatus = direct.skipped && /^(HTTP (403|404|5\d\d)|error de red)/.test(direct.skipped);
  if (blockedByStatus) {
    const viaReader = await articleViaReader(url, robots).catch(() => undefined);
    if (viaReader?.item || viaReader?.blockedByRobots) return viaReader;
  }
  return direct;
}

export const htmlNewsConnector: SourceConnector = {
  id: 'html_news',
  async fetchItems(account, cfg, ctx) {
    const start = assertPublicHttpsUrl(cfg.listUrl || account.url);
    const allowed = [start.hostname, ...(cfg.allowedHosts ?? [])];
    const forceReader = cfg.viaReader === true;
    if (!(await robotsAllows(start.toString(), ctx.robots, forceReader ? 'reader' : 'direct'))) return { status: 'blocked_robots', items: [], message: `robots.txt no permite leer ${start.pathname}` };

    const pattern = cfg.linkPattern ? new RegExp(cfg.linkPattern, 'i') : /\/(news|actualit|blog|press|stor)/i;
    let links: string[] = []; let via = 'directo';
    if (!forceReader) {
      try {
        const list = await withRetry(() => safeFetch(start.toString(), { allowedHosts: allowed }));
        if (list.status < 400) links = extractLinks(list.text, list.url);
      } catch (e) { if (!(e instanceof RetryableError)) throw e; }
    }
    if (!links.length) {   // bloqueado, vacío o forzado: probar con el lector
      const page = await withRetry(() => readerFetch(start.toString()), { attempts: 3, baseMs: 2500 }).catch(() => undefined);
      if (page?.ok) { links = linksFromMarkdown(page.markdown); via = 'lector'; }
    }
    const candidates = links.map((l) => { try { return new URL(l); } catch { return null; } })
      .filter((u): u is URL => !!u && hostAllowed(u, allowed) && isArticleCandidate(u, pattern)).map((u) => canonicalUrl(u.toString()));
    const unique = [...new Set(candidates)].filter((l) => !ctx.isKnownUrl(l)).slice(0, Math.min(ctx.maxItems * 2, 10));

    const items: RawItem[] = []; let robotsBlocked = 0; const errors: string[] = []; const skipped: string[] = [];
    for (const link of unique) {
      if (items.length >= ctx.maxItems) break;
      try {
        const r = await articleFromUrl(link, allowed, ctx.robots, { viaReader: forceReader || via === 'lector' });
        if (r.blockedByRobots) robotsBlocked++;
        else if (r.item) items.push(r.item);
        else if (r.skipped) skipped.push(`${new URL(link).pathname}: ${r.skipped}`);
      } catch (e) { errors.push(`${new URL(link).pathname}: ${(e as Error).message}`); }
    }
    const cutoff = Date.now() - ctx.maxAgeDays * 86400_000;
    const fresh = items.filter((i) => !i.publishedAt || new Date(i.publishedAt).getTime() >= cutoff);
    const stale = items.length - fresh.length;
    const note = [via === 'lector' ? 'leído mediante lector' : '', stale ? `${stale} descartadas por antigüedad (>${ctx.maxAgeDays} días)` : '', robotsBlocked ? `${robotsBlocked} bloqueadas por robots.txt` : '', skipped.length ? `omitidas ${skipped.length} (${skipped.slice(0, 2).join(' | ')})` : '', errors.length ? `errores: ${errors.slice(0, 2).join(' | ')}` : '', !candidates.length ? 'no se encontraron enlaces de noticias (ajusta listUrl/linkPattern)' : ''].filter(Boolean).join('; ');
    return { status: 'ok', items: fresh, message: note || undefined };
  },
};
