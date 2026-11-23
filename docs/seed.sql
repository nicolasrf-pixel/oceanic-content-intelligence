INSERT OR IGNORE INTO brands (id,name,account,category,country,channel,status,editorial_profile,sort_order) VALUES
('beneteau-sail','Beneteau Vela','@beneteau_official','Veleros monocasco','Francia','instagram','active','Vela',1),
('beneteau-power','Beneteau Power','@beneteau_official','Lanchas a motor','Francia','instagram','active','Motor',2),
('lagoon','Lagoon','@lagooncatamarans','Catamaranes a vela y motor','Francia','instagram','active','Catamaranes',3),
('axopar','Axopar','@axopar','Lanchas deportivas y adventure boats','Finlandia','instagram','active','Adventure',4);
INSERT OR IGNORE INTO sources (id,brand_id,platform,source_url,acquisition_method,permission_status,enabled) VALUES
('ig-beneteau','beneteau-sail','instagram','https://www.instagram.com/beneteau_official/','manual_or_approved_api','unverified',0),
('ig-lagoon','lagoon','instagram','https://www.instagram.com/lagooncatamarans/','manual_or_approved_api','unverified',0),
('ig-axopar','axopar','instagram','https://www.instagram.com/axopar/','manual_or_approved_api','unverified',0);
