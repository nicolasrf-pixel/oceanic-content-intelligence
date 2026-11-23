import type { AccountRow, Env, RawItem } from '../types';
import { canonicalUrl, normalizeText, sha256Hex } from '../lib/util';
import { q } from '../lib/db';

export async function contentHash(item: Pick<RawItem, 'title' | 'text'>): Promise<string> {
  return sha256Hex(normalizeText(`${item.title ?? ''} ${item.text}`).slice(0, 2000));
}

/** URLs ya conocidas de la cuenta (para no descargarlas de nuevo). */
export async function knownUrls(env: Env, accountId: string): Promise<Set<string>> {
  const rows = await q<{ source_url: string; external_id: string }>(env, 'SELECT source_url, external_id FROM publications WHERE account_id = ?', accountId);
  const s = new Set<string>();
  for (const r of rows) { s.add(canonicalUrl(r.source_url)); s.add(r.external_id); }
  return s;
}

export interface ScoutResult { fresh: (RawItem & { hash: string })[]; duplicates: number }

/**
 * Scout: separa publicaciones nuevas de duplicadas (por id externo, URL canónica
 * o hash de contenido, incluso entre cuentas distintas) y descarta vacías.
 */
export async function scout(env: Env, account: AccountRow, items: RawItem[]): Promise<ScoutResult> {
  const known = await knownUrls(env, account.id);
  const hashes = new Set((await q<{ content_hash: string }>(env, 'SELECT content_hash FROM publications ORDER BY detected_at DESC LIMIT 5000')).map((r) => r.content_hash));
  const fresh: ScoutResult['fresh'] = []; let duplicates = 0;
  for (const it of items) {
    const url = canonicalUrl(it.url);
    if (!it.text || it.text.trim().length < 10) { continue; }
    const hash = await contentHash(it);
    if (known.has(it.externalId) || known.has(url) || hashes.has(hash)) { duplicates++; continue; }
    known.add(it.externalId); known.add(url); hashes.add(hash);
    fresh.push({ ...it, url, hash });
  }
  return { fresh, duplicates };
}
