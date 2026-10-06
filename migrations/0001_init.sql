CREATE TABLE IF NOT EXISTS people (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL DEFAULT 'New person',
	birth TEXT,
	death TEXT,
	location TEXT,
	bio TEXT NOT NULL DEFAULT '',
	photo_version INTEGER NOT NULL DEFAULT 0,
	x REAL NOT NULL DEFAULT 0,
	y REAL NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
	id TEXT PRIMARY KEY,
	child_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
	parent_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
	type TEXT NOT NULL DEFAULT 'parent' CHECK (type IN ('parent', 'partner')),
	UNIQUE (child_id, parent_id, type)
);

CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_id);
CREATE INDEX IF NOT EXISTS idx_edges_parent ON edges(parent_id);
