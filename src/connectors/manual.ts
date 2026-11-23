import type { Env, RawItem } from '../types';
import { HttpError, canonicalUrl } from '../lib/util';
import { assertPublicHttpsUrl } from '../lib/safe-fetch';
import { articleFromUrl } from './html-news';

const SOCIAL_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com)$/i;

/**
 * Incorporación manual por URL. Páginas web públicas se leen (respetando robots.txt);
 * enlaces a redes sociales no se raspan: el editor debe pegar el texto.
 */
export async function buildManualItem(env: Env, input: { url: string; text?: string; title?: string; mediaUrl?: string }): Promise<RawItem> {
  const u = assertPublicHttpsUrl(input.url);
  const url = canonicalUrl(u.toString());
  const social = SOCIAL_HOSTS.test(u.hostname);
  const text = input.text?.trim();
  if (social || text) {
    if (!text || text.length < 10) throw new HttpError(400, 'Para enlaces de redes sociales pega el texto de la publicación (no se extrae automáticamente).', 'text_required');
    return { externalId: url, url, title: input.title?.trim() || undefined, text, mediaType: input.mediaUrl ? 'image' : 'none', mediaUrl: input.mediaUrl };
  }
  const r = await articleFromUrl(url, [u.hostname], new Map());
  if (r.blockedByRobots) throw new HttpError(422, 'El sitio no permite lectura automatizada (robots.txt). Pega el texto manualmente.', 'robots');
  if (!r.item) throw new HttpError(422, 'No se pudo extraer contenido suficiente de la página. Pega el texto manualmente.', 'no_content');
  return { ...r.item, title: input.title?.trim() || r.item.title };
}
