import type { Env } from '../types';
import { RetryableError, withRetry } from '../lib/util';
import { spend } from '../lib/budget';

export interface LlmResult { text: string; inputTokens?: number; outputTokens?: number }
export interface LlmClient {
  provider: string;
  model: string;
  complete(system: string, user: string, opts?: { maxTokens?: number }): Promise<LlmResult>;
}

export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Motor de IA incluido en Cloudflare (Workers AI): no requiere clave externa. */
function workersAi(env: Env): LlmClient {
  const model = env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL;
  return {
    provider: 'workers-ai', model,
    complete: (system, user, o) => withRetry(async () => {
      try {
        spend();
        const r: any = await (env.AI as any).run(model, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: o?.maxTokens ?? 1500, temperature: 0.3 });
        const out = r?.response ?? r?.result?.response ?? '';
        const text = typeof out === 'string' ? out : JSON.stringify(out);
        if (!text.trim()) throw new Error('respuesta vacía');
        return { text, inputTokens: r?.usage?.prompt_tokens, outputTokens: r?.usage?.completion_tokens };
      } catch (e) { throw new RetryableError(`Workers AI: ${(e as Error).message}`); }
    }, { attempts: 2, baseMs: 1500 }),
  };
}

/** Prioridad: clave externa (Anthropic/OpenAI) > Workers AI > null (modo heurístico). */
export function getLlm(env: Env): LlmClient | null {
  const key = env.AI_API_KEY?.trim();
  if (!key) return env.AI ? workersAi(env) : null;
  const provider = (env.AI_PROVIDER || 'anthropic').toLowerCase();

  if (provider === 'anthropic') {
    const model = env.AI_MODEL || 'claude-sonnet-5-5';
    return {
      provider, model,
      complete: (system, user, o) => withRetry(async () => {
        const res = await post('https://api.anthropic.com/v1/messages',
          { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          { model, max_tokens: o?.maxTokens ?? 1500, system, messages: [{ role: 'user', content: user }] });
        const text = (res.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
        return { text, inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens };
      }),
    };
  }

  const base = (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!base.startsWith('https://')) throw new Error('AI_BASE_URL debe ser https');
  const model = env.AI_MODEL || 'gpt-4o';
  return {
    provider: 'openai', model,
    complete: (system, user, o) => withRetry(async () => {
      const res = await post(`${base}/chat/completions`, { authorization: `Bearer ${key}` },
        { model, max_tokens: o?.maxTokens ?? 1500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
      return { text: res.choices?.[0]?.message?.content ?? '', inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens };
    }),
  };
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  spend();
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  } catch (e) { throw new RetryableError(`IA: error de red (${(e as Error).message})`); }
  if (res.status === 429 || res.status >= 500) throw new RetryableError(`IA: HTTP ${res.status}`);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`IA: HTTP ${res.status} ${data?.error?.message ?? ''}`.trim());
  return data;
}
