import type { Env } from '../types';
import { HttpError, sha256Hex } from './util';
import { exec, one } from './db';

const enc = new TextEncoder();
const COOKIE = 'oci_session';
const TTL_SECONDS = 12 * 3600;

const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function secretOf(env: Env): string {
  const s = env.ADMIN_AUTH_SECRET;
  if (!s || s.length < 12) throw new HttpError(503, 'Autenticación no configurada: define el secreto ADMIN_AUTH_SECRET (mínimo 12 caracteres).', 'auth_not_configured');
  return s;
}

async function key(env: Env) {
  return crypto.subtle.importKey('raw', enc.encode('oceanic-jwt:' + secretOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signJwt(env: Env, sub: string): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TTL_SECONDS })));
  const sig = await crypto.subtle.sign('HMAC', await key(env), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

export async function verifyJwt(env: Env, token: string): Promise<{ sub: string } | null> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(env), b64uDecode(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(p)));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return { sub: String(payload.sub) };
  } catch { return null; }
}

/** Comparación en tiempo constante (compara digests SHA-256). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function readCookie(req: Request, name: string): string | null {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

export async function authenticate(req: Request, env: Env): Promise<{ email: string }> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const token = bearer || readCookie(req, COOKIE);
  if (!token) throw new HttpError(401, 'Sesión requerida', 'unauthorized');
  const v = await verifyJwt(env, token);
  if (!v) throw new HttpError(401, 'Sesión inválida o expirada', 'unauthorized');
  // Defensa CSRF para mutaciones con cookie: exige cabecera personalizada.
  if (!bearer && !['GET', 'HEAD'].includes(req.method) && req.headers.get('x-requested-with') !== 'oceanic') {
    throw new HttpError(403, 'Solicitud no permitida', 'csrf');
  }
  return { email: v.sub };
}

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;

export async function login(req: Request, env: Env, email: string, password: string): Promise<Response> {
  const secret = secretOf(env);
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const since = Date.now() - WINDOW_MS;
  const row = await one<{ n: number }>(env, 'SELECT COUNT(*) n FROM login_attempts WHERE ip = ? AND created_at > ?', ip, since);
  if ((row?.n ?? 0) >= MAX_FAILS) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.', 'rate_limited');

  const expectedEmail = (env.ADMIN_EMAIL || '').toLowerCase();
  const okEmail = !expectedEmail || (await safeEqual(email.toLowerCase(), expectedEmail));
  const okPass = await safeEqual(password, secret);
  if (!okEmail || !okPass) {
    await exec(env, 'INSERT INTO login_attempts (ip, created_at) VALUES (?, ?)', ip, Date.now());
    await exec(env, 'DELETE FROM login_attempts WHERE created_at < ?', since - WINDOW_MS);
    throw new HttpError(401, 'Credenciales incorrectas', 'bad_credentials');
  }
  await exec(env, 'DELETE FROM login_attempts WHERE ip = ?', ip);
  const sub = expectedEmail || email.toLowerCase();
  const token = await signJwt(env, sub);
  const secure = env.ENVIRONMENT === 'development' ? '' : '; Secure';
  return new Response(JSON.stringify({ email: sub, token }), {
    headers: {
      'content-type': 'application/json',
      'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}${secure}`,
    },
  });
}

export function logoutResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` },
  });
}
