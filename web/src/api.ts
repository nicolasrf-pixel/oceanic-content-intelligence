export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

type Opts = { method?: string; body?: unknown; form?: FormData };

export async function api<T = any>(path: string, o: Opts = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: o.method ?? (o.body || o.form ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'x-requested-with': 'oceanic', ...(o.body ? { 'content-type': 'application/json' } : {}) },
    body: o.form ?? (o.body ? JSON.stringify(o.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('oci-unauthorized'));
    throw new ApiError(res.status, data.error || `Error ${res.status}`, data.code);
  }
  return data as T;
}

export const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};
