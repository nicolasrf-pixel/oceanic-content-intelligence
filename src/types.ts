export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_AUTH_SECRET?: string;
  ADMIN_EMAIL?: string;
  AI_API_KEY?: string;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  META_ACCESS_TOKEN?: string;
  META_IG_USER_ID?: string;
  YOUTUBE_API_KEY?: string;
  SUBREQUEST_BUDGET?: string;   // 45 en plan gratuito; 900 en plan de pago
  AI?: Ai;                      // Workers AI (sin clave externa)
  WORKERS_AI_MODEL?: string;
  ENVIRONMENT?: string;
}

export const CATEGORIES = ['lanzamiento', 'producto', 'evento', 'estilo_de_vida', 'tecnologia', 'corporativo'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  lanzamiento: 'Lanzamiento',
  producto: 'Producto',
  evento: 'Evento',
  estilo_de_vida: 'Estilo de vida',
  tecnologia: 'Tecnología',
  corporativo: 'Corporativo',
};

export interface BrandRow {
  id: string; name: string; category: string; country: string | null;
  editorial_profile: string | null; keywords: string; active: number; sort_order: number;
}

export interface AccountRow {
  id: string; brand_id: string; platform: string; handle: string | null; url: string;
  connector: string; config_json: string; enabled: number; permission_status: string;
  last_checked_at: string | null; last_status: string | null; last_error: string | null;
}

export interface PubRow {
  id: string; brand_id: string; account_id: string; source_url: string; external_id: string;
  content_hash: string; title: string | null; original_text: string; original_lang: string | null;
  media_type: string; media_url: string | null; media_r2_key: string | null; media_rights: string;
  published_at: string | null; detected_at: string; status: string; category: string | null;
  score: number | null; priority: string | null; discard_reason: string | null; updated_at: string; original_es?: string | null;
}

export interface RawItem {
  externalId: string;
  url: string;
  title?: string;
  text: string;
  publishedAt?: string;
  mediaType?: 'image' | 'video' | 'none';
  mediaUrl?: string;
}

export interface Issue {
  severity: 'alta' | 'media' | 'baja';
  type: 'voseo' | 'vosotros' | 'lexico' | 'ortografia' | 'gramatica' | 'coherencia' | 'exactitud' | 'formato' | 'traduccion_pendiente';
  message: string;
}

export interface AccountConfig {
  lines?: string[];
  listUrl?: string;
  linkPattern?: string;
  allowedHosts?: string[];
  maxItems?: number;
  viaReader?: boolean;     // leer lista y artículos mediante el lector público
  channelId?: string;      // youtube_api
}
