import type { Env } from '../types';
import { exec } from '../lib/db';

export interface AgentCtx { env: Env; llm: import('./llm').LlmClient | null; runId: string }

export async function logAgent(env: Env, r: {
  runId?: string; publicationId?: string; agent: string; status: 'ok' | 'fallback' | 'error';
  provider?: string; model?: string; inputTokens?: number; outputTokens?: number; durationMs?: number; message?: string;
}) {
  await exec(env, `INSERT INTO agent_logs (run_id, publication_id, agent, status, provider, model, input_tokens, output_tokens, duration_ms, message)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, r.runId ?? null, r.publicationId ?? null, r.agent, r.status, r.provider ?? null, r.model ?? null,
    r.inputTokens ?? null, r.outputTokens ?? null, r.durationMs ?? null, r.message?.slice(0, 500) ?? null);
}

export async function logMonitor(env: Env, r: {
  runId: string; kind: string; accountId?: string; status?: string; found?: number; newCount?: number; duplicates?: number; message?: string;
}) {
  await exec(env, `INSERT INTO monitoring_logs (run_id, kind, account_id, status, found, new_count, duplicates, message) VALUES (?,?,?,?,?,?,?,?)`,
    r.runId, r.kind, r.accountId ?? null, r.status ?? null, r.found ?? 0, r.newCount ?? 0, r.duplicates ?? 0, r.message?.slice(0, 500) ?? null);
}
