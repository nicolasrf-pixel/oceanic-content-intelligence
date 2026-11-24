import type { Env } from '../types';
import { spend } from './budget';
export async function q<T = any>(env: Env, sql: string, ...b: unknown[]): Promise<T[]> {
  spend();
  return (await env.DB.prepare(sql).bind(...b).all<T>()).results;
}
export async function one<T = any>(env: Env, sql: string, ...b: unknown[]): Promise<T | null> {
  spend();
  return env.DB.prepare(sql).bind(...b).first<T>();
}
export async function exec(env: Env, sql: string, ...b: unknown[]) {
  spend();
  return env.DB.prepare(sql).bind(...b).run();
}

export const SETTING_DEFAULTS: Record<string, string> = {
  monitoring_enabled: '1',
  monitoring_hours_local: '8',
  monitoring_every_days: '2',
  max_new_per_account: '5',
  max_new_per_run: '12',
  max_age_days: '45',
  tone_guide: 'Tono Oceanic: cercano, aspiracional y preciso. Español de Chile con tuteo.',
};
export const HIDDEN_SETTINGS = ['monitoring_lock', 'monitoring_cycle_start'];

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const rows = await q<{ key: string; value: string }>(env, 'SELECT key, value FROM settings');
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) if (!HIDDEN_SETTINGS.includes(r.key)) out[r.key] = r.value;
  return out;
}
