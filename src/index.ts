import type { Env } from './types';
import { handleApi } from './api';
import { reprocess, runMonitoring, shouldStartCycle } from './agents/coordinator';
import { getLlm } from './agents/llm';
import { exec, getSettings, one } from './lib/db';

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
      // Cada N días (a la hora configurada) inicia un ciclo y revisa todas las fuentes; en las demás horas solo retoma
      // las que quedaron pendientes del ciclo (el plan gratuito de Workers limita las operaciones por ejecución)
      // y rehace lo que quedó sin IA.
      const cycle = await one<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'monitoring_cycle_start'");
      const startNew = shouldStartCycle(s.monitoring_hours_local, Number(s.monitoring_every_days), cycle?.value ?? null);
      if (startNew) await exec(env, `INSERT INTO settings (key, value, updated_at) VALUES ('monitoring_cycle_start', ?1, ?1) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?1`, new Date().toISOString());
      await runMonitoring(env, { trigger: 'cron', dueOnly: !startNew, dueSince: startNew ? undefined : cycle?.value }); 
      let llm = null; try { llm = getLlm(env); } catch { /* sin IA */ }
      if (llm) {
        await reprocess(env, { scope: 'failed', limit: 10, keepBudget: true });
        await reprocess(env, { scope: 'heuristic', limit: 10, keepBudget: true });
      }
    })());
  },
} satisfies ExportedHandler<Env>;
