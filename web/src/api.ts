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

/** Sube un archivo en streaming (cuerpo = bytes) con progreso. */
export function uploadFile(path: string, file: File, onProgress?: (pct: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api' + path);
    x.setRequestHeader('x-requested-with', 'oceanic');
    x.setRequestHeader('content-type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let data: any = {}; try { data = JSON.parse(x.responseText); } catch { /* sin cuerpo */ }
      if (x.status >= 200 && x.status < 300) resolve(data);
      else { if (x.status === 401) window.dispatchEvent(new Event('oci-unauthorized')); reject(new ApiError(x.status, data.error || `Error ${x.status}`, data.code)); }
    };
    x.onerror = () => reject(new ApiError(0, 'Falló la conexión durante la subida'));
    x.send(file);
  });
}
