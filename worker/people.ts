import { ApiError, toEdge } from "./edges";

interface PersonRow {
	id: string;
	name: string;
	birth: string | null;
	death: string | null;
	location: string | null;
	bio: string;
	photo_version: number;
	x: number;
	y: number;
}

function toPerson(row: PersonRow) {
	return {
		id: row.id,
		name: row.name,
		birth: row.birth,
		death: row.death,
		location: row.location,
		bio: row.bio,
		photoVersion: row.photo_version,
		x: row.x,
		y: row.y,
	};
}

const TEXT_FIELDS = {
	name: 120,
	birth: 40,
	death: 40,
	location: 160,
	bio: 20000,
} as const;
const NUMBER_FIELDS = ["x", "y"] as const;

/** Validates a partial person payload into column -> value pairs. */
function parseFields(body: Record<string, unknown>) {
	const out: Record<string, string | number | null> = {};
	for (const [key, max] of Object.entries(TEXT_FIELDS)) {
		if (!(key in body)) continue;
		const value = body[key];
		if (value === null && key !== "name" && key !== "bio") {
			out[key] = null;
		} else if (typeof value === "string" && value.length <= max) {
			out[key] = value;
		} else {
			throw new ApiError(400, `Invalid ${key}`);
		}
	}
	for (const key of NUMBER_FIELDS) {
		if (!(key in body)) continue;
		const value = body[key];
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new ApiError(400, `Invalid ${key}`);
		}
		out[key] = value;
	}
	return out;
}

export async function loadTree(db: D1Database) {
	const [people, edges] = await Promise.all([
		db.prepare("SELECT * FROM people ORDER BY updated_at").all<PersonRow>(),
		db.prepare("SELECT * FROM edges").all<Parameters<typeof toEdge>[0]>(),
	]);
	return {
		people: people.results.map(toPerson),
		edges: edges.results.map(toEdge),
	};
}

export async function createPerson(
	db: D1Database,
	body: Record<string, unknown>,
) {
	const fields = parseFields(body);
	const id = crypto.randomUUID();
	await db
		.prepare(
			"INSERT INTO people (id, name, birth, death, location, bio, x, y, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.bind(
			id,
			fields.name ?? "New person",
			fields.birth ?? null,
			fields.death ?? null,
			fields.location ?? null,
			fields.bio ?? "",
			fields.x ?? 0,
			fields.y ?? 0,
			Date.now(),
		)
		.run();
	const row = await db
		.prepare("SELECT * FROM people WHERE id = ?")
		.bind(id)
		.first<PersonRow>();
	return toPerson(row!);
}

export async function updatePerson(
	db: D1Database,
	id: string,
	body: Record<string, unknown>,
) {
	const fields = parseFields(body);
	const columns = Object.keys(fields);
	if (columns.length === 0) throw new ApiError(400, "No fields to update");
	const sets = columns.map((c) => `${c} = ?`).join(", ");
	const row = await db
		.prepare(`UPDATE people SET ${sets}, updated_at = ? WHERE id = ? RETURNING *`)
		.bind(...columns.map((c) => fields[c]), Date.now(), id)
		.first<PersonRow>();
	if (!row) throw new ApiError(404, "Person not found");
	return toPerson(row);
}

export async function deletePerson(db: D1Database, id: string) {
	// D1 enforces foreign keys, so edges cascade
	await db.prepare("DELETE FROM people WHERE id = ?").bind(id).run();
}
