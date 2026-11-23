import type { SourceConnector } from './types';
import type { RawItem } from '../types';
import { safeFetch, assertPublicHttpsUrl } from '../lib/safe-fetch';
import { robotsAllows } from '../lib/robots';
import { decodeEntities, stripTags } from '../lib/html';
import { canonicalUrl, withRetry } from '../lib/util';

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return undefined;
  return decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim();
};

export function parseFeed(xml: string): RawItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const out: RawItem[] = [];
  for (const b of blocks) {
    const link = b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? tag(b, 'link');
    if (!link) continue;
    const title = tag(b, 'title');
    const text = stripTags(tag(b, 'content:encoded') ?? tag(b, 'content') ?? tag(b, 'description') ?? tag(b, 'summary') ?? '');
    const date = tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated');
    const d = date ? new Date(date) : undefined;
    const media = b.match(/<(?:media:content|enclosure)[^>]+url=["']([^"']+)["']/i)?.[1] ?? b.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
    if (text.length < 40 && !title) continue;
    out.push({
      externalId: tag(b, 'guid') ?? tag(b, 'id') ?? canonicalUrl(link), url: canonicalUrl(link), title,
      text: text || title || '', publishedAt: d && !isNaN(d.getTime()) ? d.toISOString() : undefined,
      mediaType: media ? 'image' : 'none', mediaUrl: media,
    });
  }
  return out;
}

export const rssConnector: SourceConnector = {
  id: 'rss',
  async fetchItems(account, cfg, ctx) {
    const u = assertPublicHttpsUrl(cfg.listUrl || account.url);
    if (!(await robotsAllows(u.toString(), ctx.robots))) return { status: 'blocked_robots', items: [], message: 'robots.txt no permite leer el feed' };
    const res = await withRetry(() => safeFetch(u.toString(), { allowedHosts: [u.hostname], accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml' }));
    const cutoff = Date.now() - ctx.maxAgeDays * 86400_000;
    const items = parseFeed(res.text)
      .filter((i) => !ctx.isKnownUrl(i.url))
      .filter((i) => !i.publishedAt || new Date(i.publishedAt).getTime() >= cutoff)
      .slice(0, ctx.maxItems);
    return { status: 'ok', items };
  },
};
