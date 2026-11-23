import type { SourceConnector } from './types';
import type { RawItem } from '../types';
import { RetryableError, withRetry } from '../lib/util';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Instagram Business Discovery: lee medios publicos de cuentas profesionales usando
 * UNA cuenta profesional propia autorizada (META_IG_USER_ID) y su token. No hace scraping.
 * Sin credenciales el conector se reporta como `needs_credentials` y no inventa nada.
 */
export const instagramConnector: SourceConnector = {
  id: 'instagram_discovery',
  async fetchItems(account, _cfg, ctx) {
    const { META_ACCESS_TOKEN: token, META_IG_USER_ID: igId } = ctx.env;
    if (!token || !igId) return { status: 'needs_credentials', items: [], message: 'Faltan META_ACCESS_TOKEN y META_IG_USER_ID (cuenta profesional de Instagram autorizada).' };
    if (!account.handle) return { status: 'error', items: [], message: 'La cuenta no tiene handle de Instagram' };

    const fields = `business_discovery.username(${account.handle}){media.limit(${Math.min(ctx.maxItems * 3, 25)}){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp}}`;
    const url = `${GRAPH}/${encodeURIComponent(igId)}?fields=${encodeURIComponent(fields)}`;
    const data = await withRetry(async () => {
      let res: Response;
      try { res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) }); }
      catch (e) { throw new RetryableError((e as Error).message); }
      if (res.status === 429 || res.status >= 500) throw new RetryableError(`Meta API HTTP ${res.status}`);
      return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
    });
    if (data.status >= 400) {
      const msg = data.body?.error?.message ?? `HTTP ${data.status}`;
      return { status: data.status === 401 || data.status === 403 || data.body?.error?.code === 190 ? 'needs_credentials' : 'error', items: [], message: `Meta API: ${msg}` };
    }
    const media: any[] = data.body?.business_discovery?.media?.data ?? [];
    const cutoff = Date.now() - ctx.maxAgeDays * 86400_000;
    const items: RawItem[] = [];
    for (const m of media) {
      if (!m.permalink || ctx.isKnownUrl(m.permalink)) continue;
      if (m.timestamp && new Date(m.timestamp).getTime() < cutoff) continue;
      const isVideo = m.media_type === 'VIDEO';
      items.push({
        externalId: String(m.id), url: m.permalink, text: (m.caption ?? '').trim(), publishedAt: m.timestamp,
        mediaType: isVideo ? 'video' : 'image', mediaUrl: isVideo ? m.thumbnail_url ?? m.media_url : m.media_url,
      });
      if (items.length >= ctx.maxItems) break;
    }
    return { status: 'ok', items };
  },
};
