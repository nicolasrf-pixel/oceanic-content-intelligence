import { HttpError, RetryableError } from './util';
import { spend } from './budget';

export const BOT_UA = 'OceanicContentBot/1.0 (monitoreo editorial; respeta robots.txt)';
const MAX_REDIRECTS = 3;

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.')) return true;                         // localhost, nombres internos sin punto
  if (h.startsWith('[') || h.includes(':')) return true;     // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;        // IPv4 literal
  if (/^\d+$/.test(h.replace(/\./g, ''))) return true;       // formas numericas
  return /\.(local|localhost|internal|intranet|lan|home|corp|test|invalid)$/.test(h);
}

/** Valida que la URL sea https publica (sin credenciales ni puertos raros). */
export function assertPublicHttpsUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'URL inválida', 'bad_url'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'Solo se permiten URLs https', 'bad_url');
  if (u.username || u.password) throw new HttpError(400, 'La URL no puede incluir credenciales', 'bad_url');
  if (u.port && u.port !== '443') throw new HttpError(400, 'Puerto no permitido', 'bad_url');
  if (isBlockedHost(u.hostname)) throw new HttpError(400, 'Host no permitido', 'ssrf_blocked');
  return u;
}

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, '');
export function hostAllowed(url: URL, allowed: string[]): boolean {
  const h = stripWww(url.hostname);
  return allowed.some((d) => { const a = stripWww(d); return h === a || h.endsWith('.' + a); });
}

export interface FetchResult { status: number; url: string; text: string; contentType: string }

export async function safeFetch(
  raw: string,
  o: { allowedHosts?: string[]; maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<FetchResult> {
  let url = assertPublicHttpsUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (o.allowedHosts && !hostAllowed(url, o.allowedHosts)) throw new HttpError(400, `Dominio fuera de la lista permitida: ${url.hostname}`, 'ssrf_blocked');
    let res: Response;
    spend();
    try {
      res = await fetch(url.toString(), {
        redirect: 'manual',
        headers: { 'user-agent': BOT_UA, accept: o.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      });
    } catch (e) { throw new RetryableError(`Error de red: ${(e as Error).message}`); }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new HttpError(502, 'Redirección sin destino');
      url = assertPublicHttpsUrl(new URL(loc, url).toString());
      continue;
    }
    if (res.status === 429 || res.status >= 500) throw new RetryableError(`HTTP ${res.status} en ${url.hostname}`);
    const text = await readLimited(res, o.maxBytes ?? 2_000_000);
    return { status: res.status, url: url.toString(), text, contentType: res.headers.get('content-type') || '' };
  }
  throw new HttpError(502, 'Demasiadas redirecciones');
}

async function readLimited(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); break; }   // se trunca; no se falla
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0; for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}
