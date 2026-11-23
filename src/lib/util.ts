export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
/** Error que justifica reintento (429, 5xx, red). */
export class RetryableError extends Error {}

export const nowIso = () => new Date().toISOString();
export const uid = (prefix = '') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const TRACKING = /^(utm_|fbclid|gclid|igshid|mc_)/i;
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch { return raw; }
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  o: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = o.attempts ?? 3;
  const base = o.baseMs ?? 600;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (!(e instanceof RetryableError) || i === attempts) throw e;
      await sleep(base * 2 ** (i - 1) + Math.floor(Math.random() * 200));
    }
  }
  throw last;
}

export function parseJsonLoose<T = any>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('La IA no devolvió JSON');
  return JSON.parse(t.slice(a, b + 1)) as T;
}

export function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }

export function priorityFor(score: number): 'alta' | 'media' | 'baja' {
  return score >= 75 ? 'alta' : score >= 50 ? 'media' : 'baja';
}
