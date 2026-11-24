import { BOT_UA, safeFetch } from './safe-fetch';
import { readerFetch } from './reader';

interface Rule { allow: boolean; pattern: string }
export type RobotsCache = Map<string, Rule[] | 'deny_all' | 'allow_all'>;

export function parseRobots(txt: string, agent = 'oceaniccontentbot'): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null; let lastWasAgent = false;
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, '').trim();
    const m = clean.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(); const val = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: field === 'allow', pattern: val });
    } else lastWasAgent = false;
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path) ? body.length : -1;
}

export function pathAllowed(rules: Rule[], path: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const r of rules) {
    const len = matches(r.pattern, path);
    if (len < 0) continue;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

/** Devuelve true si BOT_UA puede leer la URL. 4xx en robots => permitido; 5xx/red => denegado (criterio conservador). */
export async function robotsAllows(rawUrl: string, cache: RobotsCache, via: 'direct' | 'reader' = 'direct'): Promise<boolean> {
  const u = new URL(rawUrl);
  const origin = u.origin;
  const key = `${via}:${origin}`;
  let entry = cache.get(key);
  if (!entry) {
    try {
      if (via === 'reader') {
        const r = await readerFetch(`${origin}/robots.txt`);
        entry = r.ok && /user-agent/i.test(r.markdown) ? parseRobots(r.markdown) : 'allow_all';
      } else {
        const r = await safeFetch(`${origin}/robots.txt`, { accept: 'text/plain', timeoutMs: 6000, maxBytes: 300_000 });
        entry = r.status >= 400 ? 'allow_all' : parseRobots(r.text);
      }
    } catch {
      entry = 'deny_all';
    }
    cache.set(key, entry);
  }
  if (entry === 'allow_all') return true;
  if (entry === 'deny_all') return false;
  return pathAllowed(entry, u.pathname + u.search);
}
export { BOT_UA };
