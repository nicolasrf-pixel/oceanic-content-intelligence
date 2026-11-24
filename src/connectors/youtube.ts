import type { SourceConnector } from './types';
import type { RawItem } from '../types';
import { RetryableError, canonicalUrl, withRetry } from '../lib/util';

/**
 * YouTube Data API v3 (oficial, cuota gratuita). Los feeds RSS de YouTube NO se usan porque su robots.txt los prohíbe.
 * Lee los últimos videos (incluye Shorts) del canal. Sin YOUTUBE_API_KEY queda en espera.
 */
export const youtubeConnector: SourceConnector = {
  id: 'youtube_api',
  async fetchItems(account, cfg, ctx) {
    const key = ctx.env.YOUTUBE_API_KEY?.trim();
    if (!key) return { status: 'needs_credentials', items: [], message: 'Falta YOUTUBE_API_KEY (clave gratuita de la API de YouTube Data v3).' };
    const channelId = cfg.channelId || account.url.match(/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1];
    if (!channelId || !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) return { status: 'error', items: [], message: 'Configura channelId (UC…) del canal.' };
    const playlist = 'UU' + channelId.slice(2);   // lista "uploads" del canal
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=${Math.min(ctx.maxItems * 3, 25)}&playlistId=${playlist}`;
    const res = await withRetry(async () => {
      let r: Response;
      try { r = await fetch(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(12_000) }); } catch (e) { throw new RetryableError((e as Error).message); }
      if (r.status === 429 || r.status >= 500) throw new RetryableError(`YouTube API HTTP ${r.status}`);
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
    });
    if (res.status >= 400) {
      const bad = res.status === 400 || res.status === 403;
      return { status: bad ? 'needs_credentials' : 'error', items: [], message: `YouTube API: ${res.body?.error?.message ?? res.status}` };
    }
    const cutoff = Date.now() - ctx.maxAgeDays * 86400_000;
    const items: RawItem[] = [];
    for (const it of res.body.items ?? []) {
      const sn = it.snippet; const id = it.contentDetails?.videoId ?? sn?.resourceId?.videoId;
      if (!id || !sn || sn.title === 'Private video' || sn.title === 'Deleted video') continue;
      const link = canonicalUrl(`https://www.youtube.com/watch?v=${id}`);
      const published = it.contentDetails?.videoPublishedAt ?? sn.publishedAt;
      if (ctx.isKnownUrl(link) || (published && new Date(published).getTime() < cutoff)) continue;
      const thumb = sn.thumbnails?.maxres?.url ?? sn.thumbnails?.high?.url ?? sn.thumbnails?.medium?.url;
      items.push({ externalId: id, url: link, title: sn.title, text: `${sn.title}\n\n${(sn.description ?? '').trim()}`.trim(), publishedAt: published, mediaType: 'video', mediaUrl: thumb });
      if (items.length >= ctx.maxItems) break;
    }
    return { status: 'ok', items };
  },
};
