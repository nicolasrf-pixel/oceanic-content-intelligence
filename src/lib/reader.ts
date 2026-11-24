import { safeFetch } from './safe-fetch';
import { BOILERPLATE, IMG_EXT, IMG_SKIP } from './html';
import { HttpError } from './util';

/**
 * Lector público (r.jina.ai) usado como respaldo cuando un sitio bloquea las IP del Worker
 * (403/404) o cuando la fuente se configura con viaReader. Solo se le envían URLs públicas de las marcas.
 */
const READER = 'https://r.jina.ai/';

export interface ReaderPage { ok: boolean; title?: string; publishedAt?: string; markdown: string; finalUrl: string }

export async function readerFetch(url: string): Promise<ReaderPage> {
  const res = await safeFetch(READER + url, { allowedHosts: ['r.jina.ai'], accept: 'text/plain', maxBytes: 1_500_000, timeoutMs: 40_000 });
  if (res.status >= 400) return { ok: false, markdown: '', finalUrl: url };
  return parseReader(res.text, url);
}

export function parseReader(text: string, url: string): ReaderPage {
  const head = (k: string) => text.match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'mi'))?.[1]?.trim() || undefined;
  const i = text.search(/^Markdown Content:/mi);
  const markdown = i >= 0 ? text.slice(i).replace(/^Markdown Content:\s*/i, '') : text;
  const pub = head('Published Time'); const d = pub ? new Date(pub) : undefined;
  const bad = /^(Warning: )?Target URL returned error 4\d\d/mi.test(text.slice(0, 600));
  return { ok: !bad, title: head('Title'), publishedAt: d && !isNaN(d.getTime()) ? d.toISOString() : undefined, markdown, finalUrl: head('Final URL') || head('URL Source') || url };
}

export function markdownToText(md: string): string {
  const lines = md.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split(/\n+/)
    .map((l) => l.replace(/^[\s>*#\-+]+/, '').replace(/[*_`]+/g, '').trim())
    .filter((l) => l.length >= 40 && !(l.length < 110 && BOILERPLATE.test(l)));
  return [...new Set(lines)].join('\n\n').slice(0, 6000);
}

export function linksFromMarkdown(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) out.add(m[1].replace(/#.*$/, ''));
  return [...out];
}

export function firstImageFromMarkdown(md: string): string | undefined {
  for (const m of md.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) if (!IMG_SKIP.test(m[1]) && IMG_EXT.test(m[1])) return m[1];
  return undefined;
}

export { HttpError };
