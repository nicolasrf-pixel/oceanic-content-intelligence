import type { AccountConfig, AccountRow, Env, RawItem } from '../types';
import type { RobotsCache } from '../lib/robots';

export interface ConnectorContext {
  env: Env;
  robots: RobotsCache;
  /** Cantidad maxima de items nuevos que el conector debe devolver. */
  maxItems: number;
  /** Permite saltarse URLs ya conocidas antes de descargarlas. */
  isKnownUrl: (url: string) => boolean;
  maxAgeDays: number;
}

export type ConnectorStatus = 'ok' | 'needs_credentials' | 'blocked_robots' | 'error' | 'disabled';

export interface ConnectorResult { status: ConnectorStatus; items: RawItem[]; message?: string }

export interface SourceConnector {
  id: string;
  fetchItems(account: AccountRow, cfg: AccountConfig, ctx: ConnectorContext): Promise<ConnectorResult>;
}
