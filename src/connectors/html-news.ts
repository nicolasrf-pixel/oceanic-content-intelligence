import type { SourceConnector } from './types';
import type { RawItem } from '../types';
import { safeFetch, assertPublicHttpsUrl, hostAllowed } from '../lib/safe-fetch';
import { robotsAllows } from '../lib/robots';
import { extractLinks, extractMainText, firstContentImage, getMeta, getPublishedAt, getTitle } from '../lib/html';
import { canonicalUrl, withRetry } from '../lib/util';

const ASSET_EXT = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js|ico|xml)(\?|$)/i;

/** ¿Parece un artículo y no una página de sección/listado? Fecha, og:type=article, ruta /article/ o slug largo. */
export function looksLikeArticle(url: string, published?: string, ogType?: string): boolean {
  if (published || /article|news|blog/i.test(ogType ?? '') && ogType !== 'website') return true;
  const path = new URL(url).pathname;
  if (/\/(article|articles|post|posts)\/[^/]+$/i.test(path)) return true;
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  return slug.length >= 24 && slug.split('-').filter(Boolean).length >= 3;
}

export async function articleFromUrl(url: string, allowedHosts: string[] | undefined, robots: Map<string, any>): Promise<{ item?: RawItem; blockedByRobots?: boolean; skipped?: string }> {
  if (!(await robotsAllows(url, robots))) return { blockedByRobots: true };
  const res = await withRetry(() => safeFetch(url, { allowedHosts }));
  if (res.status >= 400) return { skipped: `HTTP ${res.status}` };
  const html = res.text;
  const title = getTitle(html);
  const body = extractMainText(html);
  const desc = getMeta(html, 'og:description') ?? getMeta(html, 'description') ?? '';
  const text = (body.length > desc.length ? body : desc).trim();
  const published = getPublishedAt(html);
  if (text.length < 80) return { skipped: 'texto insuficiente' };
  if (!looksLikeArticle(res.url, published, getMeta(html, 'og:type'))) return { skipped: 'página de sección o listado' };
  const image = getMeta(html, 'og:image') || firstContentImage(html, res.url);
  const video = getMeta(html, 'og:video');
  let mediaUrl: string | undefined;
  try { const m = video || image; mediaUrl = m ? new URL(m, res.url).toString() : undefined; } catch { /* sin media */ }
  return {
    item: {
      externalId: canonicalUrl(res.url), url: canonicalUrl(res.url), title, text,
      publishedAt: published, mediaType: video ? 'video' : image ? 'image' : 'none', mediaUrl,
    },
  };
}

export const htmlNewsConnector: SourceConnector = {
  id: 'html_news',
  async fetchItems(account, cfg, ctx) {
    const start = assertPublicHttpsUrl(cfg.listUrl || account.url);
    const allowed = [start.hostname, ...(cfg.allowedHosts ?? [])];
    if (!(await robotsAllows(start.toString(), ctx.robots))) return { status: 'blocked_robots', items: [], message: `robots.txt no permite leer ${start.pathname}` };

    const list = await withRetry(() => safeFetch(start.toString(), { allowedHosts: allowed }));
    const pattern = cfg.linkPattern ? new RegExp(cfg.linkPattern, 'i') : /\/(news|actualit|blog|press|stor)/i;
    const links = extractLinks(list.text, list.url)
      .filter((l) => { const u = new URL(l); return hostAllowed(u, allowed) && !ASSET_EXT.test(u.pathname) && pattern.test(u.pathname) && u.pathname.split('/').filter(Boolean).length >= 2; })
      .map(canonicalUrl);
    const unique = [...new Set(links)].filter((l) => !ctx.isKnownUrl(l)).slice(0, Math.min(ctx.maxItems * 2, 10));

    const items: RawItem[] = []; let robotsBlocked = 0; const errors: string[] = []; const skipped: string[] = [];
    for (const link of unique) {
      if (items.length >= ctx.maxItems) break;
      try {
        const r = await articleFromUrl(link, allowed, ctx.robots);
        if (r.blockedByRobots) robotsBlocked++;
        else if (r.item) items.push(r.item);
        else if (r.skipped) skipped.push(`${new URL(link).pathname}: ${r.skipped}`);
      } catch (e) { errors.push(`${new URL(link).pathname}: ${(e as Error).message}`); }
    }
    const cutoff = Date.now() - ctx.maxAgeDays * 86400_000;
    const fresh = items.filter((i) => !i.publishedAt || new Date(i.publishedAt).getTime() >= cutoff);
    const stale = items.length - fresh.length;
    const note = [stale ? `${stale} descartadas por antigüedad (>${ctx.maxAgeDays} días)` : '', robotsBlocked ? `${robotsBlocked} bloqueadas por robots.txt` : '', skipped.length ? `omitidas ${skipped.length} (${skipped.slice(0, 2).join(' | ')})` : '', errors.length ? `errores: ${errors.slice(0, 2).join(' | ')}` : '', !links.length ? 'no se encontraron enlaces de noticias (ajusta listUrl/linkPattern)' : ''].filter(Boolean).join('; ');
    return { status: 'ok', items: fresh, message: note || undefined };
  },
};
