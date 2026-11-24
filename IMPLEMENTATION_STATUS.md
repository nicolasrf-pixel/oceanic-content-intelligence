# Estado de implementación — MVP 1.0

> Reconstruido desde el resumen de la sesión anterior (el código original no quedó en el repositorio). La estructura y el comportamiento siguen ese resumen; los detalles internos pueden diferir del código perdido.

## Verificado en esta sesión
- `tsc` (Worker y frontend) sin errores; `vite build` correcto.
- 46 pruebas unitarias (español de Chile, SSRF, robots.txt, HTML/RSS, Curador, Copywriter, Editor, cron/DST, rutas de IA con API simulada).
- Prueba de humo con D1 local: login, 401 sin sesión, CSRF, rate limit de login, flujo manual → análisis → copy → aprobar/descartar/guardar/editar/regenerar, calendario, biblioteca, subida a R2 con y sin derechos, bloqueo SSRF, candado de ejecución simultánea, deduplicación en segunda corrida.
- Monitoreo **real** contra beneteau.com y catamarans-lagoon.com: 8 artículos con imagen, fecha y reparto Beneteau Vela/Power.
- Interfaz revisada en navegador (escritorio y móvil, sin desborde horizontal).

## Panel de reels (2026-11-24)
- Página **Reels**: subida múltiple con progreso, filtros por estado/marca/texto, reproducción en el panel (soporta Range), descarga con nombre de marca, copiar copy+hashtags, estado «Publicado por mí» (solo registro).
- Subida en streaming a R2 (sin cargar el archivo en memoria); límite 100 MB por video (límite de solicitud de Workers).
- Probado en local con videos reales y en navegador. No se probó aún con la IA real.

## Fuentes y traducción (2026-11-24)
- Filtro de índices: se excluyen `/tag/`, `/page/`, `/category/`, `/author/`, feeds, y páginas `og:type=blog` (caso Aquila).
- Lectura de respaldo mediante lector para sitios que bloquean al Worker (caso Lagoon, verificado en local).
- Workers AI como motor y traductor sin clave externa; **no se pudo probar en local** (el binding solo corre en Cloudflare). Se valida tras el despliegue vía cron.
- **Sin lectura automática posible:** Solaris (CAPTCHA), Saffier (desafío anti-bot, sus noticias no aparecen como enlaces), XO Boats, VX One, Switch One Design (sin sección de noticias legible). Quedan desactivadas o solo con Instagram/YouTube.
- YouTube: canales resueltos para 9 marcas (falta Solaris); conector con API oficial listo, en espera de `YOUTUBE_API_KEY`.

## Verificado en producción (cron 01:00, 2026-11-24)
- Lagoon: 5 artículos leídos mediante el lector. Workers AI: 5 copies en español de Chile con traducción de referencia; el Editor marcó exageraciones del modelo.
- **Límite del plan gratuito de Workers:** 50 subsolicitudes por ejecución (D1, fetch y IA cuentan). 10 de 17 llamadas de IA fallaron con «Too many subrequests» y cayeron a modo heurístico.
- Respuesta: presupuesto por ejecución (`SUBREQUEST_BUDGET`, 45 en plan gratuito; subir a 900 con plan de pago). Si no alcanza, lo pendiente queda en estado «new» y se retoma en el siguiente cron horario; las fuentes se revisan de la menos reciente a la más reciente, y el cron horario retoma las que llevan más de 20 h sin revisar y rehace copies sin IA. Con el plan gratuito el sistema converge, pero lento (≈1–2 publicaciones por hora).
- Hashtags ahora deterministas (el modelo cometía errores de tipeo) y prompt más estricto contra adjetivos/afirmaciones que el original no dice.

## Decisión del cliente: plan gratuito para siempre, revisión cada 2 días
Ajuste `monitoring_every_days` (por defecto 2) + ciclo (`monitoring_cycle_start`, interno). Probado con pruebas unitarias de la lógica de ciclo; el comportamiento real se verá en el primer ciclo (8:00 Santiago).

## NO verificado todavía
- Despliegue real en Cloudflare (D1/R2 remotos, cron en producción).
- Llamadas a un proveedor de IA real (solo probado con API simulada). Los copies reales en español de Chile deben revisarse con el usuario.
- Conector de Instagram (requiere credenciales Meta; sin ellas queda en espera).
- Cron: lógica de hora de Santiago probada con pruebas unitarias, no en producción.

## Datos semilla
Quedaron sembradas las 11 líneas comerciales y 10 cuentas de Instagram del listado del cliente (Beneteau Vela y Power comparten `@beneteau_official`). Además hay fuentes web verificadas para Beneteau, Lagoon, Excess, Axopar y Aquila. Solaris (dominio no resuelto), Saffier (bloquea bots, 403), XO Boats, VX One y Switch One Design no exponen noticias legibles: quedan solo con Instagram, que requiere credenciales de Meta.

## Pasos en la nube (pendientes)
1. Crear D1 `oceanic-content-db` y R2 `oceanic-content-media`; poner `database_id` en `wrangler.toml`; migrar y sembrar en remoto.
2. `npm run deploy` y probar `/api/health`.
3. Cargar secretos `ADMIN_AUTH_SECRET` y `AI_API_KEY` (los entrega el usuario, nunca por chat) y definir `AI_PROVIDER`/`AI_MODEL`.
4. Con IA real, usar «Reprocesar con IA» y revisar los copies con el usuario.

## Decisiones y límites conocidos
- Una sola identidad de editor (correo `ADMIN_EMAIL` + clave `ADMIN_AUTH_SECRET`); no hay multiusuario.
- El rate limit de login usa una tabla extra (`login_attempts`), por lo que el esquema tiene 11 tablas.
- Las ejecuciones manuales son síncronas; con muchas cuentas conviene ejecutarlas por marca o fuente.
- Las imágenes de fuentes web se enlazan (solo referencia); sólo el material subido a R2 con derechos confirmados se considera usable.
- Sin cola: el procesamiento de IA ocurre dentro de la ejecución; las publicaciones que fallan quedan en estado «Procesando» y se rehacen con «Reprocesar».
