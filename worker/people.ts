import { ApiError, toEdge } from "./edges";

interface PersonRow {
	id: string;
	name: string;
	nickname: string | null;
	middle_name: string | null;
	maiden_name: string | null;
	birth: string | null;
	birth_place: string | null;
	death: string | null;
	death_place: string | null;
	location: string | null;
	occupation: string | null;
	bio: string;
	photo_version: number;
	x: number;
	y: number;
	deleted_at: number | null;
}

function toPerson(row: PersonRow) {
	return {
		id: row.id,
		name: row.name,
		nickname: row.nickname,
		middleName: row.middle_name,
		maidenName: row.maiden_name,
		birth: row.birth,
		birthPlace: row.birth_place,
		death: row.death,
		deathPlace: row.death_place,
		location: row.location,
		occupation: row.occupation,
		bio: row.bio,
		photoVersion: row.photo_version,
		x: row.x,
		y: row.y,
	};
}

/** API field -> column, max length, and whether it may be cleared to null. */
const TEXT_FIELDS: Record<string, { column: string; max: number; nullable: boolean }> = {
	name: { column: "name", max: 120, nullable: false },
	nickname: { column: "nickname", max: 80, nullable: true },
	middleName: { column: "middle_name", max: 80, nullable: true },
	maidenName: { column: "maiden_name", max: 80, nullable: true },
	birth: { column: "birth", max: 40, nullable: true },
	birthPlace: { column: "birth_place", max: 160, nullable: true },
	death: { column: "death", max: 40, nullable: true },
	deathPlace: { column: "death_place", max: 160, nullable: true },
	location: { column: "location", max: 160, nullable: true },
	occupation: { column: "occupation", max: 120, nullable: true },
	bio: { column: "bio", max: 20000, nullable: false },
};
const NUMBER_FIELDS = ["x", "y"] as const;

/** Validates a partial person payload into column -> value pairs. */
function parseFields(body: Record<string, unknown>) {
	const out: Record<string, string | number | null> = {};
	for (const [key, { column, max, nullable }] of Object.entries(TEXT_FIELDS)) {
		if (!(key in body)) continue;
		const value = body[key];
		if (value === null && nullable) {
			out[column] = null;
		} else if (typeof value === "string" && value.length <= max) {
			out[column] = value;
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

/** Active tree: people in the Trash, and links touching them, are left out. */
export async function loadTree(db: D1Database) {
	const [people, edges] = await Promise.all([
		db
			.prepare("SELECT * FROM people WHERE deleted_at IS NULL ORDER BY updated_at")
			.all<PersonRow>(),
		db
			.prepare(
				`SELECT e.* FROM edges e
				 JOIN people c ON c.id = e.child_id AND c.deleted_at IS NULL
				 JOIN people p ON p.id = e.parent_id AND p.deleted_at IS NULL`,
			)
			.all<Parameters<typeof toEdge>[0]>(),
	]);
	return {
		people: people.results.map(toPerson),
		edges: edges.results.map(toEdge),
	};
}

export async function loadTrash(db: D1Database) {
	const rows = await db
		.prepare("SELECT * FROM people WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
		.all<PersonRow>();
	return rows.results.map((r) => ({ ...toPerson(r), deletedAt: r.deleted_at }));
}

export async function createPerson(
	db: D1Database,
	body: Record<string, unknown>,
) {
	const fields = parseFields(body);
	const id = crypto.randomUUID();
	const columns = ["id", "updated_at", ...Object.keys(fields)];
	await db
		.prepare(
			`INSERT INTO people (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
		)
		.bind(id, Date.now(), ...Object.values(fields))
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
		.prepare(
			`UPDATE people SET ${sets}, updated_at = ? WHERE id = ? AND deleted_at IS NULL RETURNING *`,
		)
		.bind(...Object.values(fields), Date.now(), id)
		.first<PersonRow>();
	if (!row) throw new ApiError(404, "Person not found");
	return toPerson(row);
}

/** Moves a person to the Trash. Their links and photo are kept so they can be restored. */
export async function trashPerson(db: D1Database, id: string) {
	const now = Date.now();
	const row = await db
		.prepare(
			"UPDATE people SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL RETURNING id",
		)
		.bind(now, now, id)
		.first();
	if (!row) throw new ApiError(404, "Person not found");
}

export async function restorePerson(db: D1Database, id: string) {
	const row = await db
		.prepare(
			"UPDATE people SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL RETURNING *",
		)
		.bind(Date.now(), id)
		.first<PersonRow>();
	if (!row) throw new ApiError(404, "Person not in Trash");
	return toPerson(row);
}

/** Permanently deletes someone who is already in the Trash. Links cascade. */
export async function purgePerson(db: D1Database, id: string) {
	const row = await db
		.prepare("DELETE FROM people WHERE id = ? AND deleted_at IS NOT NULL RETURNING id")
		.bind(id)
		.first();
	if (!row) throw new ApiError(404, "Person not in Trash");
}
