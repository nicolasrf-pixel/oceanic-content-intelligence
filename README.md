# Oceanic Content Intelligence — MVP 0.1

Aplicación editorial para monitorear fuentes de marcas náuticas, preparar adaptaciones locales y dejar la decisión de publicación en manos del editor.

## Qué incluye esta entrega

- Panel web responsive en español.
- Bandeja editorial con tarjetas, puntuación, clasificación y motivo de recomendación.
- Acciones funcionales locales: aprobar, descartar, editar copy y consultar biblioteca.
- Marcas piloto: Beneteau Vela, Beneteau Power, Lagoon y Axopar. Beneteau comparte una cuenta, pero conserva dos perfiles editoriales.
- Persistencia de demostración mediante `localStorage`.
- Worker API inicial con endpoints de salud, marcas, contenidos y cambio de estado.
- Esquema D1 y bucket R2 configurables.
- Cron Trigger diario como andamiaje, deliberadamente bloqueado mientras no haya conectores autorizados.

**Importante:** los cuatro contenidos precargados son datos ficticios de demostración. No se han extraído de Instagram ni Facebook. La versión actual no realiza scraping, no descarga medios y no publica en redes.

## Arquitectura

- Aplicación full-stack: Cloudflare Workers con Static Assets (frontend servido desde el mismo Worker).
- API: rutas `/api/*` en Cloudflare Workers.
- Datos: Cloudflare D1.
- Medios: Cloudflare R2 (solo material con autorización de uso).
- Programación: Cloudflare Cron Triggers.
- IA: adaptador de proveedor pendiente de definir y configurar como secreto del Worker.

Se eligió frontend estático en esta primera entrega para evitar complejidad y costos de build innecesarios. Se puede migrar a React si el producto crece.

## Probar localmente

Abre `public/index.html` directamente en un navegador o sirve la carpeta `public` con un servidor estático. La experiencia de demostración funciona sin backend.

## Desplegar en Cloudflare Workers

1. Crea un repositorio Git y sube el contenido de esta carpeta.
2. Instala Node.js LTS.
3. Ejecuta `npm install`.
4. Crea D1: `npm run db:create`.
5. Copia el `database_id` devuelto a `wrangler.toml`.
6. Crea el bucket R2 `oceanic-content-media`.
7. Crea el bucket: `npx wrangler r2 bucket create oceanic-content-media`.
8. Aplica migraciones: `npm run db:migrate`.
9. Inserta marcas y fuentes piloto: `npm run db:seed`.
10. Despliega frontend y API juntos: `npm run deploy`.

La configuración usa Workers Static Assets para servir `public/` y resolver `/api/*` desde el Worker. Cloudflare recomienda Workers para proyectos nuevos con assets estáticos y backend integrado.

## Configurar recursos del Worker

Crea el bucket R2 con el nombre configurado en `wrangler.toml`.

Antes de producción, restringe CORS al dominio real de la aplicación, añade autenticación, rate limiting y secretos mediante `wrangler secret put`.

## Poblar marcas

La migración crea las tablas. Inserta las marcas iniciales con SQL (ver `docs/seed.sql`) después de aplicar la migración.

## Fuentes y permisos

La arquitectura híbrida no equivale a scraping indiscriminado. Instagram/Meta limita el acceso a datos de cuentas ajenas; los endpoints de Instagram Graph API normalmente se centran en cuentas profesionales autorizadas y permisos concretos. Antes de activar un adaptador hay que validar la elegibilidad de la cuenta, permisos, términos, derechos de reutilización de imágenes/videos y disponibilidad técnica. Si no existe acceso autorizado, se conserva el enlace original y se usa revisión asistida.

## Próximos hitos

1. Añadir autenticación de editor.
2. Crear adaptadores por fuente: Meta API si aplica, páginas oficiales/RSS/newsroom, y revisión asistida de URLs.
3. Normalizar publicaciones y deduplicar por URL/ID.
4. Integrar IA para clasificación y adaptación de copy con guía de tono de Oceanic.
5. Sustituir el modo local por API D1.
6. Activar Cron únicamente cuando los conectores estén probados y autorizados.
7. Añadir flujo de permisos de medios y luego programación Meta.
