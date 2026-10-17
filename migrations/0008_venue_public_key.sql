-- Slug público da arena pra galeria /g/:key (quadra continua em /q/:key).
ALTER TABLE venues ADD COLUMN public_key TEXT;

UPDATE venues
SET public_key = lower(replace(replace(id, 'venue-', ''), '_', '-'))
WHERE public_key IS NULL;

UPDATE venues SET public_key = 'demo' WHERE id = 'venue-demo';

CREATE UNIQUE INDEX venues_public_key_idx ON venues(public_key)
  WHERE public_key IS NOT NULL;
