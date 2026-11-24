import type { Env } from '../types';
import { spend } from './budget';

const M2M = '@cf/meta/m2m100-1.2b';
const LANG_NAME: Record<string, string> = { en: 'english', fr: 'french', it: 'italian', nl: 'dutch', fi: 'finnish', de: 'german', pt: 'portuguese' };

export function chunkParagraphs(text: string, max = 700): string[] {
  const out: string[] = []; let cur = '';
  for (const para of text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length > max) {   // párrafo largo: cortar por oraciones
      for (const sent of para.split(/(?<=[.!?])\s+/)) {
        if ((cur + ' ' + sent).length > max && cur) { out.push(cur); cur = ''; }
        cur = cur ? cur + ' ' + sent : sent;
      }
      continue;
    }
    if ((cur + '\n' + para).length > max && cur) { out.push(cur); cur = para; } else cur = cur ? cur + '\n' + para : para;
  }
  if (cur) out.push(cur);
  return out;
}

/** Traducción literal al español (referencia para el editor). Devuelve null si no hay Workers AI o el idioma no se conoce. */
export async function translateToSpanish(env: Env, text: string, lang: string | null | undefined): Promise<string | null> {
  const source = lang ? LANG_NAME[lang] : undefined;
  if (!env.AI || !source || !text.trim()) return null;
  const chunks = chunkParagraphs(text.slice(0, 3200));
  const out: string[] = [];
  try {
    for (const c of chunks.slice(0, 4)) {
      spend();
      const r: any = await (env.AI as any).run(M2M, { text: c, source_lang: source, target_lang: 'spanish' });
      const t = r?.translated_text ?? r?.result?.translated_text;
      if (typeof t !== 'string' || !t.trim()) return null;
      out.push(t.trim());
    }
  } catch { return null; }
  return out.join('\n\n');
}
