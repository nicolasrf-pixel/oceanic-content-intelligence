# Implementación y decisiones técnicas

## MVP 0.1 — alcance

El objetivo inmediato es validar la operación editorial: revisar oportunidades, editar copy y decidir. No se considera terminado el monitoreo automático hasta que se conecten fuentes reales con acceso permitido.

## Perfiles de marca piloto

- Beneteau Vela y Beneteau Power: dos perfiles editoriales, una cuenta de Instagram compartida.
- Lagoon: @lagooncatamarans.
- Axopar: @axopar.

Son cuatro perfiles editoriales y tres cuentas únicas de Instagram.

## Contrato mínimo de contenido

`id, brand_id, source_url, source_post_id, published_at, detected_at, original_caption, adapted_copy, content_type, relevance_score, editorial_reason, media_object_key, media_rights_status, status`.

## Estados editoriales

- `pending`: requiere revisión.
- `approved`: aprobado por el editor.
- `rejected`: descartado.

La API no incluye endpoint de publicación social. Esa omisión es intencional.

## Criterios para activar una fuente

1. Fuente oficial identificada.
2. Método de adquisición documentado.
3. Permisos/condiciones de uso revisados.
4. Derechos de reutilización del material confirmados o autorización obtenida.
5. Prueba de deduplicación y registro de procedencia.

## Pendientes antes de producción

- Autenticación y autorización de usuario.
- CORS restringido al dominio real.
- Conector IA y prompt editorial de Oceanic aprobado.
- Adaptadores reales y credenciales.
- Registro de consentimiento/derechos de medios.
- Observabilidad, alertas, backup D1 y políticas de retención.
- Verificación del horario de verano/invierno de Chile para Cron.
