import type { Issue } from '../types';

const L = (words: string[]) => new RegExp(`(?<![\\p{L}])(?:${words.join('|')})(?![\\p{L}])`, 'giu');

/** Voseo rioplatense (verbos, imperativos y pronombre) y jerga argentina. */
const VOSEO = L(['vivís','escribís','sentís','elegís','salís','recibís','preferís','decidís','descubrís','compartís','disfrutás','navegás','conocés','necesitás','buscás','llegás','ponés','tomás','imaginás','pasás','cruzás','vendés', 'vos', 'tenés', 'querés', 'podés', 'sos', 'sabés', 'hacés', 'decís', 'venís', 'descubrí', 'viví', 'elegí', 'probá', 'conocé', 'explorá', 'imaginá', 'reservá', 'navegá', 'mirá', 'dejá', 'vení', 'andá', 'escuchá', 'pedí', 'animate', 'sumate', 'unite', 'enterate', 'fijate', 'seguinos', 'visitanos', 'contactanos', 'escribinos', 'contame', 'che', 'boludo', 'pibe', 'laburo', 'quilombo', 'dale']);
/** Segunda persona del plural de España. */
const VOSOTROS = L(['vosotros', 'vosotras', 'vuestro', 'vuestra', 'vuestros', 'vuestras', 'habéis', 'tenéis', 'podéis', 'queréis', 'sois', 'estáis', 'descubrid', 'venid', 'conoced', 'disfrutad', 'vivid', 'mirad']);
const SPAIN_LEX: [RegExp, string][] = [
  [L(['ordenador(?:es)?']), 'computador'], [L(['móvil(?:es)?']), 'celular'], [L(['coche(?:s)?']), 'auto'],
  [L(['zumo']), 'jugo'], [L(['patata(?:s)?']), 'papa'], [L(['guay']), 'genial'], [L(['chulo']), 'bacán'],
];

const TUTEO_MAP: Record<string, string> = {
  vivís: 'vives', escribís: 'escribes', sentís: 'sientes', elegís: 'eliges', salís: 'sales', recibís: 'recibes', preferís: 'prefieres', decidís: 'decides', descubrís: 'descubres', compartís: 'compartes', disfrutás: 'disfrutas', navegás: 'navegas', conocés: 'conoces', necesitás: 'necesitas', buscás: 'buscas', llegás: 'llegas', ponés: 'pones', tomás: 'tomas', imaginás: 'imaginas', pasás: 'pasas', cruzás: 'cruzas', vendés: 'vendes',
  tenés: 'tienes', querés: 'quieres', podés: 'puedes', sos: 'eres', sabés: 'sabes', hacés: 'haces', decís: 'dices', venís: 'vienes',
  descubrí: 'descubre', viví: 'vive', elegí: 'elige', probá: 'prueba', conocé: 'conoce', explorá: 'explora', imaginá: 'imagina',
  reservá: 'reserva', navegá: 'navega', mirá: 'mira', dejá: 'deja', vení: 'ven', andá: 've', escuchá: 'escucha', pedí: 'pide',
  animate: 'anímate', sumate: 'súmate', unite: 'únete', enterate: 'entérate', fijate: 'fíjate',
  seguinos: 'síguenos', visitanos: 'visítanos', contactanos: 'contáctanos', escribinos: 'escríbenos', contame: 'cuéntame',
};
const TUTEO_RE = L(Object.keys(TUTEO_MAP));

function matchCase(src: string, repl: string) {
  return src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase() ? repl[0].toUpperCase() + repl.slice(1) : repl;
}

/** Convierte automáticamente los casos de voseo con equivalente directo en tuteo chileno. */
export function toTuteo(text: string): string {
  return text.replace(TUTEO_RE, (m) => matchCase(m, TUTEO_MAP[m.toLowerCase()] ?? m));
}
export function neutralizeLexicon(text: string): string {
  return SPAIN_LEX.reduce((t, [re, to]) => t.replace(re, (m) => matchCase(m, to)), text);
}

export function lintChileanSpanish(text: string): Issue[] {
  const issues: Issue[] = [];
  const found = (re: RegExp) => [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase()))];
  const v = found(VOSEO); if (v.length) issues.push({ severity: 'alta', type: 'voseo', message: `Voseo o jerga rioplatense: ${v.join(', ')}. Usa tuteo chileno.` });
  const s = found(VOSOTROS); if (s.length) issues.push({ severity: 'alta', type: 'vosotros', message: `Formas de España (vosotros): ${s.join(', ')}. Usa "ustedes" o tuteo.` });
  for (const [re, to] of SPAIN_LEX) { const f = found(re); if (f.length) issues.push({ severity: 'media', type: 'lexico', message: `Léxico no chileno: ${f.join(', ')} → "${to}".` }); }
  if (/ {2,}/.test(text)) issues.push({ severity: 'baja', type: 'formato', message: 'Espacios dobles.' });
  if (/\s[,.;:!?]/.test(text)) issues.push({ severity: 'baja', type: 'ortografia', message: 'Espacio antes de signo de puntuación.' });
  if (text.includes('?') && !text.includes('¿')) issues.push({ severity: 'baja', type: 'ortografia', message: 'Pregunta sin signo de apertura "¿".' });
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 4) issues.push({ severity: 'baja', type: 'formato', message: 'Exceso de emojis (máx. 4).' });
  if (text.length > 2200) issues.push({ severity: 'alta', type: 'formato', message: 'Supera 2.200 caracteres (límite de Instagram).' });
  return issues;
}

const numsOf = (s: string) => new Set((s.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,]+$/, '').replace(/[.,]/g, '')));

/** Cifras presentes en el copy que no aparecen en la fuente (posible dato inventado). */
export function unsupportedNumbers(copy: string, source: string): string[] {
  const src = numsOf(source);
  return [...numsOf(copy)].filter((n) => n.length > 0 && !src.has(n));
}
