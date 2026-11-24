# Estado de implementación — MVP 1.0

> Reconstruido desde el resumen de la sesión anterior (el código original no quedó en el repositorio). La estructura y el comportamiento siguen ese resumen; los detalles internos pueden diferir del código perdido.

## Verificado en esta sesión
- `tsc` (Worker y frontend) sin errores; `vite build` correcto.
- 46 pruebas unitarias (español de Chile, SSRF, robots.txt, HTML/RSS, Curador, Copywriter, Editor, cron/DST, rutas de IA con API simulada).
- Prueba de humo con D1 local: login, 401 sin sesión, CSRF, rate limit de login, flujo manual → análisis → copy → aprobar/descartar/guardar/editar/regenerar, calendario, biblioteca, subida a R2 con y sin derechos, bloqueo SSRF, candado de ejecución simultánea, deduplicación en segunda corrida.
- Monitoreo **real** contra beneteau.com y catamarans-lagoon.com: 8 artículos con imagen, fecha y reparto Beneteau Vela/Power.
- Interfaz revisada en navegador (escritorio y móvil, sin desborde horizontal).

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
