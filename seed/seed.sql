-- Datos iniciales. Idempotente. Amplia marcas/cuentas desde la app (Monitor de marcas) o aqui.
-- Solo se incluyen las lineas y cuentas confirmadas en el MVP 0.1; el resto se agrega segun el listado del cliente.
INSERT OR IGNORE INTO brands (id,name,category,country,editorial_profile,keywords,sort_order) VALUES
('beneteau-sail','Beneteau Vela','Veleros monocasco','Francia','Navegacion a vela, Oceanis y First: confort, desempeno y vida a bordo.','["oceanis","first","sailing","sail","voile","voilier","velero","vela","mainsail","genoa","regata","regatta"]',1),
('beneteau-power','Beneteau Power','Lanchas a motor','Francia','Motoryachts y lanchas (Antares, Gran Turismo, Swift Trawler, Flyer): confort, velocidad y diseno.','["antares","gran turismo","swift trawler","flyer","barracuda","power","motor","outboard","fueraborda","yacht a motor"]',2),
('lagoon','Lagoon','Catamaranes a vela y motor','Francia','Catamaranes Lagoon: espacio, estabilidad y vida a bordo en familia.','[]',3),
('axopar','Axopar','Lanchas deportivas y adventure boats','Finlandia','Boats deportivas y de aventura: versatilidad, rendimiento y estilo de vida activo.','[]',4);

INSERT OR IGNORE INTO social_accounts (id,brand_id,platform,handle,url,connector,config_json,enabled,permission_status) VALUES
('ig-beneteau','beneteau-sail','instagram','beneteau_official','https://www.instagram.com/beneteau_official/','instagram_discovery','{"lines":["beneteau-sail","beneteau-power"]}',0,'requires_meta_credentials'),
('ig-lagoon','lagoon','instagram','lagooncatamarans','https://www.instagram.com/lagooncatamarans/','instagram_discovery','{}',0,'requires_meta_credentials'),
('ig-axopar','axopar','instagram','axopar','https://www.instagram.com/axopar/','instagram_discovery','{}',0,'requires_meta_credentials'),
('web-beneteau','beneteau-sail','web',NULL,'https://www.beneteau.com/','html_news','{"lines":["beneteau-sail","beneteau-power"],"linkPattern":"/(news|actualit|blog|press|stories|story|magazine)","maxItems":5}',1,'public_site_robots_respected'),
('web-lagoon','lagoon','web',NULL,'https://www.catamarans-lagoon.com/','html_news','{"listUrl":"https://www.catamarans-lagoon.com/news","linkPattern":"/news/article/","maxItems":5}',1,'public_site_robots_respected');

INSERT OR IGNORE INTO settings (key,value) VALUES
('monitoring_enabled','1'),
('monitoring_hours_local','8'),
('max_new_per_account','5'),
('max_new_per_run','12'),
('max_age_days','45'),
('tone_guide','Tono Oceanic: cercano, aspiracional y preciso. Espanol de Chile con tuteo (tu), sin voseo ni argentinismos ni espanolismos. Mantener el tono del original. No inventar datos tecnicos, cifras ni precios.');
