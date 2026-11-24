import { describe, expect, it, vi } from 'vitest';
import { lintChileanSpanish, neutralizeLexicon, toTuteo, unsupportedNumbers } from '../src/lib/chilean';
import { assertPublicHttpsUrl, hostAllowed, isBlockedHost } from '../src/lib/safe-fetch';
import { parseRobots, pathAllowed } from '../src/lib/robots';
import { firstContentImage, detectLang, extractLinks, extractMainText, getMeta, getPublishedAt } from '../src/lib/html';
import { canonicalUrl, normalizeText, parseJsonLoose, priorityFor } from '../src/lib/util';
import { parseFeed } from '../src/connectors/rss';
import { heuristicAnalysis, pickBrand } from '../src/agents/curator';
import { heuristicDraft } from '../src/agents/copywriter';
import { deterministicReview } from '../src/agents/editor';
import { looksLikeArticle } from '../src/connectors/html-news';
import { shouldRunNow } from '../src/agents/coordinator';

describe('español de Chile', () => {
  it('detecta voseo y jerga', () => {
    const i = lintChileanSpanish('Descubrí el nuevo velero, vos querés navegar? Mirá qué lindo, che.');
    expect(i.some((x) => x.type === 'voseo' && x.severity === 'alta')).toBe(true);
  });
  it('detecta vosotros', () => {
    expect(lintChileanSpanish('Descubrid vuestro barco, habéis elegido bien').some((x) => x.type === 'vosotros')).toBe(true);
  });
  it('convierte voseo a tuteo conservando mayúsculas', () => {
    expect(toTuteo('Descubrí el mar. Tenés todo. Sumate')).toBe('Descubre el mar. Tienes todo. Súmate');
  });
  it('cubre voseo en -ís/-ás/-és', () => {
    expect(toTuteo('Vivís el mar y disfrutás cada milla')).toBe('Vives el mar y disfrutas cada milla');
    expect(lintChileanSpanish('vivís el mar').some((i) => i.type === 'voseo')).toBe(true);
    expect(lintChileanSpanish('Visita el país y París; estás en casa')).toEqual([]);
  });
  it('no marca tuteo correcto', () => {
    expect(lintChileanSpanish('Descubre el nuevo velero. ¿Quieres conocerlo? Escríbenos.')).toEqual([]);
  });
  it('neutraliza léxico de España', () => {
    expect(neutralizeLexicon('Tu coche y tu móvil')).toBe('Tu auto y tu celular');
  });
  it('detecta cifras inventadas', () => {
    expect(unsupportedNumbers('Mide 14,5 metros y 3 cabinas', 'Cuenta con 3 cabinas')).toEqual(['145']);
    expect(unsupportedNumbers('Tiene 3 cabinas', 'Cuenta con 3 cabinas')).toEqual([]);
  });
  it('el Editor marca bloqueante una cifra ausente en el original', () => {
    const issues = deterministicReview('Alcanza 40 nudos', 'Una lancha veloz y elegante para toda la familia.');
    expect(issues.some((x) => x.type === 'exactitud' && x.severity === 'alta')).toBe(true);
  });
});

describe('seguridad de URLs (SSRF)', () => {
  it.each(['http://beneteau.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://10.0.0.5/x', 'https://[::1]/', 'https://intranet/', 'https://user:pw@beneteau.com/', 'https://beneteau.com:8443/', 'https://foo.internal/', 'https://2130706433/'])('bloquea %s', (u) => {
    expect(() => assertPublicHttpsUrl(u)).toThrow();
  });
  it('acepta https público', () => { expect(assertPublicHttpsUrl('https://www.beneteau.com/en/news').hostname).toBe('www.beneteau.com'); });
  it('lista de dominios permitidos', () => {
    const u = new URL('https://news.beneteau.com/a');
    expect(hostAllowed(u, ['www.beneteau.com'])).toBe(true);
    expect(hostAllowed(new URL('https://evil.com/'), ['beneteau.com'])).toBe(false);
    expect(hostAllowed(new URL('https://beneteau.com.evil.com/'), ['beneteau.com'])).toBe(false);
  });
  it('isBlockedHost', () => { expect(isBlockedHost('metadata')).toBe(true); expect(isBlockedHost('lagoon.com')).toBe(false); });
});

describe('robots.txt', () => {
  const txt = `User-agent: *\nDisallow: /private/\nAllow: /private/open\nDisallow: /*.pdf$\n\nUser-agent: OceanicContentBot\nDisallow: /blocked/`;
  it('usa el grupo específico del bot', () => {
    const r = parseRobots(txt);
    expect(pathAllowed(r, '/blocked/x')).toBe(false);
    expect(pathAllowed(r, '/private/x')).toBe(true);
  });
  it('grupo * con Allow más específico y comodines', () => {
    const r = parseRobots(txt, 'otrobot');
    expect(pathAllowed(r, '/private/x')).toBe(false);
    expect(pathAllowed(r, '/private/open')).toBe(true);
    expect(pathAllowed(r, '/doc.pdf')).toBe(false);
    expect(pathAllowed(r, '/news/a')).toBe(true);
  });
});

describe('HTML y feeds', () => {
  const html = `<html><head><title>T</title><meta property="og:title" content="Nuevo Oceanis &amp; más"><meta property="og:image" content="/img/a.jpg"><meta property="article:published_time" content="2026-11-10T10:00:00Z"></head>
  <body><nav><p>menu menu menu menu menu menu menu</p></nav><article><h2>Subtítulo largo del artículo</h2><p>Este es un párrafo suficientemente largo para ser contenido.</p></article><a href="/en/news/a-1">a</a><a href="mailto:x@y.z">m</a></body></html>`;
  it('extrae meta, fecha, texto y links', () => {
    expect(getMeta(html, 'og:title')).toBe('Nuevo Oceanis & más');
    expect(getPublishedAt(html)).toBe('2026-11-10T10:00:00.000Z');
    expect(extractMainText(html)).toContain('párrafo suficientemente largo');
    expect(extractMainText(html)).not.toContain('menu menu');
    expect(extractLinks(html, 'https://x.com/')).toEqual(['https://x.com/en/news/a-1']);
  });
  it('imagen de contenido: ignora menús/logos y toma la del artículo', () => {
    const h = '<header><img src="/menu.jpg"></header><nav><img src="/nav.jpg"></nav><main><img src="/icons/logo-x.svg"><article><img data-src="/styles/xl/hero-oceanis.jpg.webp?itok=1"></article></main>';
    expect(firstContentImage(h, 'https://a.com/news/x')).toBe('https://a.com/styles/xl/hero-oceanis.jpg.webp?itok=1');
    expect(firstContentImage('<p>sin imagen</p>', 'https://a.com/')).toBeUndefined();
  });
  it('quita texto de cookies/idioma del contenido', () => {
    const t = extractMainText('<article><p>Please confirm your language choice.</p><p>Este es el contenido real del artículo de la marca náutica.</p></article>');
    expect(t).not.toMatch(/language choice/); expect(t).toMatch(/contenido real/);
  });
  it('parsea RSS', () => {
    const items = parseFeed(`<rss><channel><item><title>Hola</title><link>https://x.com/a?utm_source=z</link><description><![CDATA[<p>Un texto de descripción bastante largo para pasar el filtro mínimo.</p>]]></description><pubDate>Mon, 10 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://x.com/a');
    expect(items[0].publishedAt).toBe('2026-11-10T10:00:00.000Z');
  });
  it('distingue artículos de páginas de sección', () => {
    expect(looksLikeArticle('https://www.beneteau.com/newsroom/boating-news')).toBe(false);
    expect(looksLikeArticle('https://www.beneteau.com/newsroom/tests-and-awards')).toBe(false);
    expect(looksLikeArticle('https://www.beneteau.com/news/gran-turismo-50-wins-award-its-design')).toBe(true);
    expect(looksLikeArticle('https://x.com/news/corto', '2026-11-01T00:00:00Z')).toBe(true);
  });
  it('detecta idioma', () => {
    expect(detectLang('The new yacht is designed for the whole family and it is built with care')).toBe('en');
    expect(detectLang('El nuevo velero está pensado para toda la familia y para disfrutar del mar')).toBe('es');
    expect(detectLang('Le nouveau voilier est conçu pour toute la famille et pour les voyages au large')).toBe('fr');
  });
});

describe('utilidades', () => {
  it('URL canónica', () => { expect(canonicalUrl('https://a.com/x/?utm_source=1&id=2#h')).toBe('https://a.com/x/?id=2'); expect(canonicalUrl('https://a.com/x/')).toBe('https://a.com/x'); });
  it('normaliza texto para hash', () => { expect(normalizeText('  ¡Hola,   MUNDO! ')).toBe('hola mundo'); });
  it('JSON laxo con fences', () => { expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 }); expect(() => parseJsonLoose('sin json')).toThrow(); });
  it('prioridad', () => { expect([priorityFor(80), priorityFor(60), priorityFor(10)]).toEqual(['alta', 'media', 'baja']); });
});

describe('agentes (modo heurístico)', () => {
  const brand = { name: 'Beneteau Vela' };
  it('Curador: lanzamiento con media y reciente puntúa alto y explica', () => {
    const a = heuristicAnalysis({ title: 'Launch of the new Oceanis', original_text: 'We are proud to unveil the all-new Oceanis with a spacious cockpit and cabin layout for Beneteau owners. '.repeat(4), media_type: 'image', published_at: new Date(Date.now() - 86400_000).toISOString() }, brand);
    expect(a.relevant).toBe(true); expect(a.category).toBe('lanzamiento'); expect(a.score).toBeGreaterThanOrEqual(75);
    expect(a.explanation).toMatch(/Lanzamiento/);
  });
  it('Curador: detecta irrelevante', () => {
    expect(heuristicAnalysis({ title: 'Careers', original_text: 'Join our team: we are hiring a new engineer for our factory in Vendée today.', media_type: 'none', published_at: null }, brand).relevant).toBe(false);
  });
  it('elige línea en cuenta compartida', () => {
    const lines: any[] = [{ id: 'sail', keywords: '["oceanis","sailing"]' }, { id: 'power', keywords: '["antares","gran turismo"]' }];
    expect(pickBrand(lines, 'The new Antares 11 outboard', 'sail')).toBe('power');
    expect(pickBrand(lines, 'Nothing special', 'sail')).toBe('sail');
  });
  it('Copywriter sin IA: español se ajusta a tuteo, sin inventar', () => {
    const d = heuristicDraft({ title: null, original_text: 'Descubrí el nuevo velero de Beneteau. Tenés que conocerlo, es ideal para toda la familia en el mar.' }, brand, 'lanzamiento');
    expect(d.copy).toContain('Descubre'); expect(d.copy).not.toMatch(/Tenés/); expect(d.needsAi).toBe(false);
  });
  it('Copywriter sin IA: inglés NO se traduce, queda marcado como pendiente', () => {
    const d = heuristicDraft({ title: null, original_text: 'The new yacht is designed for the whole family and it is built with great care for the sea.' }, brand, null);
    expect(d.needsAi).toBe(true); expect(d.copy).toMatch(/PENDIENTE/);
    expect(deterministicReview(d.copy, 'x', d.needsAi).some((i) => i.type === 'traduccion_pendiente')).toBe(true);
  });
  it('cron: respeta hora local de Santiago (verano UTC-3)', () => {
    expect(shouldRunNow('8', new Date('2026-12-15T11:00:00Z'))).toBe(true);
    expect(shouldRunNow('8', new Date('2026-12-15T12:00:00Z'))).toBe(false);
    expect(shouldRunNow('8', new Date('2026-07-15T12:00:00Z'))).toBe(true);   // invierno UTC-4
    expect(shouldRunNow('8,18', new Date('2026-12-15T21:00:00Z'))).toBe(true);
  });
});

import { isArticleCandidate } from '../src/connectors/html-news';
import { chunkParagraphs, translateToSpanish } from '../src/lib/translate';
import { linksFromMarkdown, markdownToText, parseReader, firstImageFromMarkdown } from '../src/lib/reader';
import { getLlm } from '../src/agents/llm';
import { youtubeConnector } from '../src/connectors/youtube';

describe('filtro de artículos (caso Aquila)', () => {
  const pat = /\/news/i;
  it('excluye etiquetas, paginación y archivos', () => {
    for (const p of ['/news/tag/awards-recognition', '/news/page/2', '/news/category/x', '/news/author/pepe', '/news/feed/'])
      expect(isArticleCandidate(new URL('https://www.aquilaboats.com' + p), pat)).toBe(false);
    expect(isArticleCandidate(new URL('https://www.aquilaboats.com/news/aquila-expands-nordic-presence'), pat)).toBe(true);
  });
  it('og:type blog (índice) no es artículo; article sí', () => {
    expect(looksLikeArticle('https://www.aquilaboats.com/news', undefined, 'blog')).toBe(false);
    expect(looksLikeArticle('https://x.com/news/corto', undefined, 'article')).toBe(true);
  });
});

describe('lector y Markdown', () => {
  const raw = 'Title: Nueva noticia\n\nURL Source: https://a.com/news/x\n\nPublished Time: 2026-11-10T10:00:00Z\n\nMarkdown Content:\n*   [Go to menu](https://a.com#m)\n![Image 1: logo](https://a.com/logo.svg)\n![Image 2: hero](https://a.com/img/hero.jpg)\n\nEste es un párrafo largo de la noticia con [un enlace](https://a.com/y) que debe quedar como texto.\n\nPlease confirm your language choice.\n';
  it('parsea cabeceras, texto, imágenes y enlaces', () => {
    const p = parseReader(raw, 'https://a.com/news/x');
    expect(p.ok).toBe(true); expect(p.title).toBe('Nueva noticia'); expect(p.publishedAt).toBe('2026-11-10T10:00:00.000Z');
    const t = markdownToText(p.markdown);
    expect(t).toContain('un enlace que debe quedar como texto'); expect(t).not.toMatch(/language choice|Go to menu/);
    expect(firstImageFromMarkdown(p.markdown)).toBe('https://a.com/img/hero.jpg');
    expect(linksFromMarkdown(p.markdown)).toContain('https://a.com/y');
  });
  it('detecta error 404 del lector', () => {
    expect(parseReader('Title: x\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\n', 'https://a.com').ok).toBe(false);
  });
});

describe('traductor y Workers AI', () => {
  it('trocea por párrafos sin pasar el máximo', () => {
    const t = chunkParagraphs(('Una oración de prueba bastante larga. ').repeat(60) + '\n\nOtro párrafo corto.', 300);
    expect(t.every((c) => c.length <= 340)).toBe(true); expect(t.length).toBeGreaterThan(3);
  });
  it('traduce con m2m100 y devuelve null sin binding o idioma desconocido', async () => {
    const calls: any[] = [];
    const env: any = { AI: { run: async (m: string, i: any) => { calls.push([m, i]); return { translated_text: 'TRADUCIDO: ' + i.text.slice(0, 5) }; } } };
    const r = await translateToSpanish(env, 'Hello world\n\nSecond paragraph', 'en');
    expect(r).toMatch(/^TRADUCIDO/); expect(calls[0][0]).toBe('@cf/meta/m2m100-1.2b'); expect(calls[0][1]).toMatchObject({ source_lang: 'english', target_lang: 'spanish' });
    expect(await translateToSpanish({} as any, 'Hello', 'en')).toBeNull();
    expect(await translateToSpanish(env, 'Hello', 'other')).toBeNull();
    expect(await translateToSpanish({ AI: { run: async () => { throw new Error('x'); } } } as any, 'Hello', 'en')).toBeNull();
  });
  it('sin clave externa usa Workers AI; con clave, Anthropic tiene prioridad', async () => {
    const env: any = { AI: { run: async () => ({ response: '{"ok":true}' }) } };
    const llm = getLlm(env)!; expect(llm.provider).toBe('workers-ai');
    expect((await llm.complete('s', 'u')).text).toContain('ok');
    expect(getLlm({ ...env, AI_API_KEY: 'k', AI_PROVIDER: 'anthropic' })!.provider).toBe('anthropic');
    expect(getLlm({} as any)).toBeNull();
  });
  it('detecta idiomas adicionales', () => {
    expect(detectLang('Il nuovo veliero è stato progettato per la famiglia e per le lunghe navigazioni con gli amici')).toBe('it');
    expect(detectLang('De nieuwe zeilboot is ontworpen voor het hele gezin en voor lange reizen met vrienden op zee')).toBe('nl');
  });
});

describe('conector YouTube (API oficial)', () => {
  const account: any = { url: 'https://www.youtube.com/channel/UCD32lcECDXD-Mz9rgvM03kg' };
  it('sin clave queda en espera', async () => {
    const r = await youtubeConnector.fetchItems(account, {}, { env: {}, robots: new Map(), maxItems: 3, isKnownUrl: () => false, maxAgeDays: 45 } as any);
    expect(r.status).toBe('needs_credentials');
  });
  it('lee la lista uploads y arma videos', async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify({ items: [{ snippet: { title: 'Nuevo Oceanis', description: 'desc', publishedAt: new Date().toISOString(), thumbnails: { high: { url: 'https://i.ytimg.com/a.jpg' } } }, contentDetails: { videoId: 'abc123' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await youtubeConnector.fetchItems(account, {}, { env: { YOUTUBE_API_KEY: 'k' }, robots: new Map(), maxItems: 3, isKnownUrl: () => false, maxAgeDays: 45 } as any);
    vi.unstubAllGlobals();
    expect(String(f.mock.calls[0][0])).toContain('playlistId=UUD32lcECDXD-Mz9rgvM03kg');
    expect(r.items[0]).toMatchObject({ url: 'https://www.youtube.com/watch?v=abc123', mediaType: 'video', mediaUrl: 'https://i.ytimg.com/a.jpg' });
  });
});

import { COST, remaining, resetBudget, spend } from '../src/lib/budget';
describe('presupuesto de subsolicitudes (plan gratuito)', () => {
  it('descuenta y respeta el límite configurado', () => {
    resetBudget('45'); expect(remaining()).toBe(45);
    spend(); spend(10); expect(remaining()).toBe(34);
    resetBudget('900'); expect(remaining()).toBe(900);
    resetBudget(undefined); expect(remaining()).toBe(45);
    resetBudget('3'); expect(remaining()).toBe(45);   // valores absurdos caen al mínimo seguro
  });
  it('una publicación completa cabe en una ejecución del plan gratuito', () => { expect(COST.publication + COST.account).toBeLessThan(45); });
});

import { shouldStartCycle } from '../src/agents/coordinator';
describe('ciclo cada N días', () => {
  const at = (iso: string) => new Date(iso);
  it('arranca solo a la hora local y si pasaron ~N días', () => {
    // 2026-12-15 11:00Z = 08:00 en Santiago (verano)
    expect(shouldStartCycle('8', 2, null, at('2026-12-15T11:00:00Z'))).toBe(true);                       // primer ciclo
    expect(shouldStartCycle('8', 2, '2026-12-15T11:00:05Z', at('2026-12-16T11:00:00Z'))).toBe(false);    // solo pasó 1 día
    expect(shouldStartCycle('8', 2, '2026-12-15T11:00:05Z', at('2026-12-17T11:00:00Z'))).toBe(true);     // pasaron 2 días
    expect(shouldStartCycle('8', 2, '2026-12-15T11:00:05Z', at('2026-12-17T14:00:00Z'))).toBe(false);    // hora equivocada
    expect(shouldStartCycle('8', 1, '2026-12-15T11:00:05Z', at('2026-12-16T11:00:00Z'))).toBe(true);     // diario
  });
  it('acota los días a 1–7', () => {
    expect(shouldStartCycle('8', 99, '2026-12-01T11:00:00Z', at('2026-12-09T11:00:00Z'))).toBe(true);    // 99 → 7 días
    expect(shouldStartCycle('8', 99, '2026-12-05T11:00:00Z', at('2026-12-09T11:00:00Z'))).toBe(false);
  });
});
