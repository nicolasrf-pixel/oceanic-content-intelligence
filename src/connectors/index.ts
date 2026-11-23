import type { SourceConnector } from './types';
import { htmlNewsConnector } from './html-news';
import { rssConnector } from './rss';
import { instagramConnector } from './instagram';

/** La incorporación manual por URL no es un conector programado: ver src/connectors/manual.ts. */
export const CONNECTORS: Record<string, SourceConnector> = {
  html_news: htmlNewsConnector,
  rss: rssConnector,
  instagram_discovery: instagramConnector,
};
export * from './types';
