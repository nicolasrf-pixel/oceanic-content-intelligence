import { describe, expect, it } from 'vitest';
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
