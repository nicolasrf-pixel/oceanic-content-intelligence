-- Datos iniciales. Idempotente. Amplia marcas/cuentas desde la app (Monitor de marcas) o aqui.
-- Incluye las 11 lineas y 10 cuentas de Instagram del listado del cliente (Beneteau Vela y Power comparten cuenta).
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

-- Marcas y cuentas adicionales (listado del cliente, 2026-11-24)
INSERT OR IGNORE INTO brands (id,name,category,country,editorial_profile,keywords,sort_order) VALUES
('excess','Excess','Catamaranes a vela','Francia','Catamaranes a vela Excess.','[]',5),
('solaris','Solaris','Veleros de alta gama','Italia','Veleros de alta gama Solaris.','[]',6),
('saffier','Saffier','Day sailers','Países Bajos','Day sailers Saffier.','[]',7),
('xo-boats','XO Boats','Lanchas de aluminio','Finlandia','Lanchas de aluminio XO Boats.','[]',8),
('aquila','Aquila','Catamaranes a motor','China / EE. UU.','Catamaranes a motor Aquila.','[]',9),
('vx-one','VX One','Velero one-design','EE. UU.','Velero one-design VX One.','[]',10),
('switch-one-design','Switch One Design','Foiler one-design de carbono','Italia','Foiler one-design de carbono Switch.','[]',11);

INSERT OR IGNORE INTO social_accounts (id,brand_id,platform,handle,url,connector,config_json,enabled,permission_status) VALUES
('ig-excess','excess','instagram','excess_catamarans','https://www.instagram.com/excess_catamarans/','instagram_discovery','{}',0,'requires_meta_credentials'),
('ig-solaris','solaris','instagram','solarisyachts','https://www.instagram.com/solarisyachts/','instagram_discovery','{}',0,'requires_meta_credentials'),
('ig-saffier','saffier','instagram','saffieryachts','https://www.instagram.com/saffieryachts/','instagram_discovery','{}',0,'requires_meta_credentials'),
('ig-xo','xo-boats','instagram','xoboatsofficial','https://www.instagram.com/xoboatsofficial/','instagram_discovery','{}',0,'requires_meta_credentials'),
('ig-aquila','aquila','instagram','aquilaboats','https://www.instagram.com/aquilaboats/','instagram_discovery','{}',0,'requires_meta_credentials'),
('ig-vxone','vx-one','instagram','vxone','https://www.instagram.com/vxone/','instagram_discovery','{}',0,'requires_meta_credentials'),
('ig-switch','switch-one-design','instagram','switchonedesign','https://www.instagram.com/switchonedesign/','instagram_discovery','{}',0,'requires_meta_credentials'),
('web-excess','excess','web',NULL,'https://www.excess-catamarans.com/','html_news','{"listUrl":"https://www.excess-catamarans.com/our-news","linkPattern":"/our-news/","maxItems":5}',1,'public_site_robots_respected'),
('web-axopar','axopar','web',NULL,'https://www.axopar.com/','html_news','{"listUrl":"https://www.axopar.com/discover-axopar/adventure-stories/","linkPattern":"/adventure-stories/","maxItems":5}',1,'public_site_robots_respected'),
('web-aquila','aquila','web',NULL,'https://www.aquilaboats.com/','html_news','{"listUrl":"https://www.aquilaboats.com/news","linkPattern":"/news","maxItems":5}',1,'public_site_robots_respected');

INSERT OR IGNORE INTO settings (key,value) VALUES
('monitoring_enabled','1'),
('monitoring_hours_local','8'),
('max_new_per_account','5'),
('max_new_per_run','12'),
('max_age_days','45'),
('tone_guide','Tono Oceanic: cercano, aspiracional y preciso. Espanol de Chile con tuteo (tu), sin voseo ni argentinismos ni espanolismos. Mantener el tono del original. No inventar datos tecnicos, cifras ni precios.');
