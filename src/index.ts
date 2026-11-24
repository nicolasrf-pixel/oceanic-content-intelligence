import type { Env } from './types';
import { handleApi } from './api';
import { reprocess, runMonitoring, shouldRunNow } from './agents/coordinator';
import { getLlm } from './agents/llm';
import { getSettings } from './lib/db';

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
};

function withHeaders(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return withHeaders(await handleApi(req, env));
    return withHeaders(await env.ASSETS.fetch(req));
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const s = await getSettings(env);
      if (s.monitoring_enabled !== '1') return;
      // En la hora programada revisa todas las fuentes; en las demás horas solo retoma las que quedaron pendientes
      // (el plan gratuito de Workers limita las operaciones por ejecución) y rehace lo que quedó sin IA.
      await runMonitoring(env, { trigger: 'cron', dueOnly: !shouldRunNow(s.monitoring_hours_local) });
      let llm = null; try { llm = getLlm(env); } catch { /* sin IA */ }
      if (llm) {
        await reprocess(env, { scope: 'failed', limit: 10, keepBudget: true });
        await reprocess(env, { scope: 'heuristic', limit: 10, keepBudget: true });
      }
    })());
  },
} satisfies ExportedHandler<Env>;
