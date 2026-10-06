-- Richer profiles, relationship details, and soft delete (Trash).
-- All additive: existing rows keep working (NULLs read as defaults).
ALTER TABLE people ADD COLUMN nickname TEXT;
ALTER TABLE people ADD COLUMN middle_name TEXT;
ALTER TABLE people ADD COLUMN maiden_name TEXT;
ALTER TABLE people ADD COLUMN birth_place TEXT;
ALTER TABLE people ADD COLUMN death_place TEXT;
ALTER TABLE people ADD COLUMN occupation TEXT;
ALTER TABLE people ADD COLUMN deleted_at INTEGER;

-- parent edges: subtype biological|adoptive|step|foster (NULL = biological)
-- partner edges: subtype married|partner|engaged|divorced|separated|widowed (NULL = married)
ALTER TABLE edges ADD COLUMN subtype TEXT;
ALTER TABLE edges ADD COLUMN start_date TEXT;
ALTER TABLE edges ADD COLUMN start_place TEXT;
ALTER TABLE edges ADD COLUMN end_date TEXT;

CREATE INDEX IF NOT EXISTS idx_people_deleted ON people(deleted_at);
