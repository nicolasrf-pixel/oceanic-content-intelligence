# Oceanic Content Intelligence 1.0

Sistema editorial que monitorea fuentes de marcas náuticas, analiza cada publicación, la adapta al español de Chile y la deja lista para que una persona decida. **Nada se publica sin aprobación humana**: el sistema no tiene ninguna función de publicación en redes.

## Flujo de trabajo actual (reels)
1. Descargas los reels de las representadas con tus propias herramientas.
2. En **Reels** → «+ Agregar reels» subes uno o varios videos (MP4/MOV, hasta 100 MB c/u), eliges la marca y confirmas los derechos. Opcional: enlace original y caption.
3. Abres un reel, pegas o corriges el texto original («Editar») y el sistema genera el copy en español de Chile.
4. Eliges cuál publicar («Listo para publicar»), pulsas **Descargar video** y **Copiar copy + hashtags**.
5. Tú agregas el cierre con el logo de Oceanic y lo subes desde Meta. Luego «Marcar como publicado» deja el registro.

La detección automática de nuevos reels (Instagram Business Discovery) se suma cuando haya credenciales de Meta: aparecerán en el mismo panel con su enlace y miniatura, y tú adjuntas el archivo descargado.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | React + Vite + TypeScript (`web/`), servido por el mismo Worker (Static Assets) |
| API | Cloudflare Worker en TypeScript (`src/`), 100 % bajo `/api/*` |
| Datos | Cloudflare D1 (`migrations/`) |
| Medios propios | Cloudflare R2, solo con confirmación de derechos |
| Automatización | Cron Trigger horario; el Worker decide si toca correr según la hora de Santiago configurada |
| IA | Anthropic u OpenAI-compatible; sin `AI_API_KEY` funciona en modo heurístico |

### Agentes (`src/agents/`)
- **Scout**: separa publicaciones nuevas de duplicadas (id externo, URL canónica y hash de contenido, incluso entre cuentas).
- **Curador**: clasifica en 6 categorías (lanzamiento, producto, evento, estilo de vida, tecnología, corporativo), puntúa 0–100 con explicación, descarta lo irrelevante y reparte cuentas compartidas (Beneteau Vela/Power).
- **Copywriter**: adapta a español de Chile (tuteo, sin voseo/argentinismos/españolismos), conserva el tono, no inventa datos.
- **Editor**: controles deterministas (voseo, vosotros, léxico, cifras que no están en el original, largo) + revisión por IA de ortografía, gramática, coherencia y exactitud. Una cifra inventada o un voseo bloquean.
- **Coordinador**: orquesta el flujo, candado contra ejecuciones simultáneas, reintentos con backoff, límites por cuenta y por ejecución.

### Modo sin IA (honesto)
Sin `AI_API_KEY` el Curador puntúa por reglas y el Copywriter solo ajusta tuteo/léxico **si el original ya está en español**. Si está en inglés o francés **no traduce ni inventa**: deja el copy marcado «PENDIENTE DE ADAPTACIÓN CON IA» y no permite aprobarlo. Al configurar la IA, «Reprocesar con IA» (Monitor de marcas) rehace esos copies.

### Conectores (`src/connectors/`)
- `html_news`: sitios públicos de noticias; respeta `robots.txt`, valida SSRF, filtra páginas de sección y toma imagen/fecha.
- `rss`: feeds RSS/Atom.
- `instagram_discovery`: Instagram Business Discovery con una cuenta profesional propia autorizada (`META_ACCESS_TOKEN`, `META_IG_USER_ID`). Sin credenciales queda «Requiere credenciales»; **no se hace scraping de Instagram**.
- Manual: URL o texto pegado desde la app. Los enlaces a redes sociales exigen pegar el texto.

## Puesta en marcha

Requiere Node 20+ y una cuenta Cloudflare con `wrangler login` (o `CLOUDFLARE_API_TOKEN`).

```bash
npm install
npx wrangler d1 create oceanic-content-db        # copia database_id a wrangler.toml
npx wrangler r2 bucket create oceanic-content-media
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
curl https://<tu-worker>.workers.dev/api/health
```

### Secretos (nunca en el repositorio ni por chat)
```bash
npx wrangler secret put ADMIN_AUTH_SECRET   # clave de acceso del editor (≥12 caracteres); también firma las sesiones
npx wrangler secret put AI_API_KEY          # clave del proveedor de IA
npx wrangler secret put META_ACCESS_TOKEN   # opcional (Instagram)
npx wrangler secret put META_IG_USER_ID     # opcional (Instagram)
```
Variables no secretas en `wrangler.toml`: `AI_PROVIDER` (`anthropic` | `openai`), `AI_MODEL`, `AI_BASE_URL` (solo OpenAI-compatible), `ADMIN_EMAIL`.

### Desarrollo local
```bash
cp .dev.vars.example .dev.vars   # edita ADMIN_AUTH_SECRET y agrega ENVIRONMENT=development
npm run db:migrate:local && npm run db:seed:local
npm run build && npm run dev     # http://localhost:8787
npm test                         # pruebas unitarias
```

## Seguridad
- Sesión JWT HS256 en cookie `HttpOnly; Secure; SameSite=Strict` (o `Authorization: Bearer`); expira en 12 h. Cabecera `X-Requested-With` obligatoria en mutaciones (defensa CSRF). Bloqueo tras 5 intentos fallidos en 15 min por IP.
- Todos los endpoints salvo `/api/health` y el login exigen sesión.
- Consultas D1 siempre con parámetros; sin concatenar entrada de usuario en SQL.
- SSRF: solo `https`, sin credenciales ni puertos, sin IPs ni hosts internos, redirecciones revalidadas (máx. 3), lista de dominios permitidos por fuente, tope de 2 MB y 10 s.
- `robots.txt` respetado (4xx = permitido, 5xx/red = denegado).
- Texto de las publicaciones se entrega a la IA como dato no confiable (anti prompt-injection) y la salida se valida (categorías, puntaje, cifras).
- Cabeceras CSP, `X-Frame-Options`, `nosniff`. Subidas a R2: tipos y tamaño limitados (25 MB) y confirmación explícita de derechos.
- Los secretos no se registran en logs.

## API (resumen)
`POST /api/auth/login` · `GET /api/health` · `GET /api/dashboard` · `GET /api/publications` (filtros: `brand, category, status, priority, from, to, q, sort`) · `GET /api/publications/:id` · `POST /api/publications/:id/action` (`approve|discard|save|reset`) · `PUT /api/publications/:id/copy` · `POST /api/publications/:id/regenerate` · `POST /api/publications/:id/media` · `POST /api/publications/manual` · `POST /api/reels` · `PUT /api/publications/:id/original` · `POST /api/publications/:id/media-file` (subida en streaming) · `GET /api/publications/:id/media[?download=1]` · `GET /api/library` · `GET|POST|PUT|DELETE /api/calendar` · `GET|POST|PUT /api/brands`, `/api/accounts` · `POST /api/monitor/run` · `POST /api/monitor/reprocess` · `GET /api/logs?type=monitoring|agents|audit` · `GET|PUT /api/settings`.

Estado de avance y pendientes: ver `IMPLEMENTATION_STATUS.md`.
