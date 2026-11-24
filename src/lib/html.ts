const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ntilde: 'ñ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCp(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
function safeCp(n: number) { try { return String.fromCodePoint(n); } catch { return ''; } }

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function getMeta(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return undefined;
  const c = tag.match(/content=("([^"]*)"|'([^']*)')/i);
  const v = c ? c[2] ?? c[3] : undefined;
  return v ? decodeEntities(v).trim() : undefined;
}

export function getTitle(html: string): string | undefined {
  const og = getMeta(html, 'og:title'); if (og) return og;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return stripTags(h1);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return t ? stripTags(t) : undefined;
}

export function getPublishedAt(html: string): string | undefined {
  const cands = [getMeta(html, 'article:published_time'), getMeta(html, 'og:article:published_time'), getMeta(html, 'date'),
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1], html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1]];
  for (const c of cands) { if (!c) continue; const d = new Date(c); if (!isNaN(d.getTime())) return d.toISOString(); }
  return undefined;
}

export const BOILERPLATE = /(language choice|cookie|accept all|newsletter|subscribe|privacy|all rights reserved|©|share (on|this)|follow us|read more|sign up)/i;

export function extractMainText(html: string): string {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const scope = h.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? h.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? h;
  const paras = [...scope.matchAll(/<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => stripTags(m[2])).filter((t) => t.length > 25 && !(t.length < 110 && BOILERPLATE.test(t)));
  return [...new Set(paras)].join('\n\n').slice(0, 6000);
}

export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=("([^"]*)"|'([^']*)')/gi)) {
    const href = (m[2] ?? m[3] ?? '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    try { const u = new URL(decodeEntities(href), base); u.hash = ''; out.add(u.toString()); } catch { /* ignora */ }
  }
  return [...out];
}

export type Lang = 'es' | 'en' | 'fr' | 'it' | 'nl' | 'fi' | 'de' | 'pt' | 'other';
const STOP: Record<Exclude<Lang, 'other'>, string[]> = {
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'con', 'para', 'por', 'del', 'es', 'su', 'se', 'al'],
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'for', 'with', 'on', 'that', 'this', 'are', 'from', 'by', 'it', 'as', 'at'],
  fr: ['le', 'la', 'les', 'des', 'et', 'est', 'une', 'un', 'du', 'pour', 'dans', 'avec', 'sur', 'qui', 'au', 'en', 'que'],
  it: ['il', 'di', 'che', 'e', 'per', 'con', 'una', 'del', 'nel', 'sono', 'è', 'della', 'degli', 'alla', 'più', 'non', 'le'],
  nl: ['de', 'het', 'een', 'en', 'van', 'voor', 'met', 'op', 'is', 'dat', 'zijn', 'te', 'ook', 'naar', 'bij'],
  fi: ['ja', 'on', 'että', 'ei', 'se', 'kun', 'tai', 'oli', 'ovat', 'mutta', 'myös', 'sekä', 'kaikki', 'sen'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'für', 'auf', 'ein', 'eine', 'den', 'dem', 'von', 'zu'],
  pt: ['o', 'os', 'as', 'de', 'que', 'e', 'para', 'com', 'uma', 'um', 'não', 'em', 'do', 'da', 'se'],
};
export function detectLang(text: string): Lang {
  const w = text.toLowerCase().match(/[a-záéíóúñàâçèêëîïôùûüäöåõãò']+/g) ?? [];
  if (w.length < 6) return 'other';
  const keys = Object.keys(STOP) as Exclude<Lang, 'other'>[];
  const score = (k: Exclude<Lang, 'other'>) => w.filter((x) => STOP[k].includes(x)).length;
  const ranked = keys.map((k) => [k, score(k)] as const).sort((a, b) => b[1] - a[1]);
  const [best, n] = ranked[0];
  return n / w.length < 0.08 || n === (ranked[1]?.[1] ?? -1) ? 'other' : best;
}

export const IMG_SKIP = /(logo|icon|sprite|avatar|placeholder|pixel|blank|flag|\.svg|\.gif|data:)/i;
export const IMG_EXT = /\.(jpe?g|png|webp)(\.webp)?(\?|$)/i;

/** Primera imagen de contenido (fuera de menús/cabeceras) cuando la página no declara og:image. */
export function firstContentImage(html: string, base: string): string | undefined {
  const h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const scope = h.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? h.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? h;
  const cands: string[] = [];
  for (const m of scope.matchAll(/<(?:img|source)\s[^>]*>/gi)) {
    const tag = m[0];
    const attrs = [tag.match(/\sdata-src=["']([^"']+)["']/i)?.[1], tag.match(/\ssrcset=["']([^"',\s]+)/i)?.[1], tag.match(/\ssrc=["']([^"']+)["']/i)?.[1]];
    for (const a of attrs) if (a) cands.push(a);
  }
  for (const m of scope.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) cands.push(m[1]);
  for (const c of cands) {
    if (IMG_SKIP.test(c) || !IMG_EXT.test(c)) continue;
    try { return new URL(decodeEntities(c), base).toString(); } catch { /* siguiente */ }
  }
  return undefined;
}
