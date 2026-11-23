export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  ENVIRONMENT: string;
  AI_API_KEY?: string;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json; charset=utf-8',...cors}});
const slug = (v:string) => v.toLowerCase().replace(/[^a-z0-9-]/g,'-');

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null,{headers:cors});
    if (url.pathname === '/api/health') return json({ok:true,service:'oceanic-content-intelligence',environment:env.ENVIRONMENT||'unknown',timestamp:new Date().toISOString()});
    if (url.pathname === '/api/brands' && request.method === 'GET') {
      const {results} = await env.DB.prepare('SELECT * FROM brands ORDER BY sort_order, name').all();
      return json({data:results});
    }
    if (url.pathname === '/api/posts' && request.method === 'GET') {
      const status = url.searchParams.get('status');
      const query = status ? env.DB.prepare('SELECT posts.*, brands.name AS brand_name, brands.account AS brand_account FROM posts JOIN brands ON brands.id=posts.brand_id WHERE posts.status=? ORDER BY posts.published_at DESC').bind(status) : env.DB.prepare('SELECT posts.*, brands.name AS brand_name, brands.account AS brand_account FROM posts JOIN brands ON brands.id=posts.brand_id ORDER BY posts.published_at DESC');
      const {results} = await query.all(); return json({data:results});
    }
    const postMatch = url.pathname.match(/^\/api\/posts\/([a-zA-Z0-9_-]+)\/status$/);
    if (postMatch && request.method === 'PATCH') {
      const body = await request.json() as {status?:string};
      if (!['pending','approved','rejected'].includes(body.status||'')) return json({error:'Invalid status'},400);
      const result = await env.DB.prepare('UPDATE posts SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.status,postMatch[1]).run();
      if (!result.meta.changes) return json({error:'Post not found'},404);
      await env.DB.prepare('INSERT INTO activity_log (entity_type,entity_id,action,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)').bind('post',postMatch[1],body.status).run();
      return json({ok:true,id:postMatch[1],status:body.status});
    }
    if (url.pathname === '/api/scan' && request.method === 'POST') {
      // Connector implementation intentionally separated: no scraping of social networks is
      // attempted until source permissions, API credentials and approved acquisition methods exist.
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO scan_runs (id,status,source,started_at,notes) VALUES (?,?,?,?,?)').bind(id,'blocked','hybrid',new Date().toISOString(),'Connectors are not configured. Add approved source adapters and credentials before enabling collection.').run();
      return json({ok:false,run_id:id,status:'blocked',message:'No hay conectores de fuentes configurados. No se realizó scraping.'},409);
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    return json({error:'Not found'},404);
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    // Scheduled job scaffold. Activate adapters only after permissions and credentials are verified.
    await env.DB.prepare("INSERT INTO scan_runs (id,status,source,started_at,notes) VALUES (?,?,?,?,?)")
      .bind(crypto.randomUUID(),'blocked','hybrid',new Date().toISOString(),'Scheduled scan skipped: source adapters not configured.').run();
  }
};
