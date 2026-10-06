export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export const PARENT_SUBTYPES = ["biological", "adoptive", "step", "foster"];
export const PARTNER_SUBTYPES = [
	"married",
	"partner",
	"engaged",
	"divorced",
	"separated",
	"widowed",
];
/** A person can have at most this many parents of each kind (e.g. 2 biological). */
export const MAX_PARENTS_PER_SUBTYPE = 2;

type EdgeType = "parent" | "partner";

interface EdgeRow {
	id: string;
	child_id: string;
	parent_id: string;
	type: EdgeType;
	subtype: string | null;
	start_date: string | null;
	start_place: string | null;
	end_date: string | null;
}

const defaultSubtype = (type: EdgeType) =>
	type === "parent" ? "biological" : "married";

// For partner edges the two people are stored in child_id/parent_id; order is irrelevant.
export function toEdge(row: EdgeRow) {
	return {
		id: row.id,
		childId: row.child_id,
		parentId: row.parent_id,
		type: row.type,
		subtype: row.subtype ?? defaultSubtype(row.type),
		startDate: row.start_date,
		startPlace: row.start_place,
		endDate: row.end_date,
	};
}

const optionalText = (body: Record<string, unknown>, key: string, max: number) => {
	if (!(key in body)) return undefined;
	const value = body[key];
	if (value === null || value === "") return null;
	if (typeof value === "string" && value.length <= max) return value;
	throw new ApiError(400, `Invalid ${key}`);
};

function parseSubtype(type: EdgeType, value: unknown) {
	if (value === undefined || value === null) return defaultSubtype(type);
	const allowed = type === "parent" ? PARENT_SUBTYPES : PARTNER_SUBTYPES;
	if (typeof value !== "string" || !allowed.includes(value)) {
		throw new ApiError(400, `subtype must be one of: ${allowed.join(", ")}`);
	}
	return value;
}

/** True if `ancestorId` is reachable by walking up from `personId`. */
async function isAncestor(db: D1Database, ancestorId: string, personId: string) {
	const row = await db
		.prepare(
			`WITH RECURSIVE up(id) AS (
				SELECT parent_id FROM edges WHERE child_id = ?1 AND type = 'parent'
				UNION
				SELECT e.parent_id FROM edges e JOIN up ON e.child_id = up.id
				WHERE e.type = 'parent'
			) SELECT 1 AS found FROM up WHERE id = ?2 LIMIT 1`,
		)
		.bind(personId, ancestorId)
		.first();
	return row !== null;
}

/** Counts a child's current parents of one subtype, ignoring Trash and one edge. */
async function countParents(
	db: D1Database,
	childId: string,
	subtype: string,
	exceptEdgeId = "",
) {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS n FROM edges e
			 JOIN people p ON p.id = e.parent_id AND p.deleted_at IS NULL
			 WHERE e.child_id = ?1 AND e.type = 'parent' AND e.id <> ?3
			   AND COALESCE(e.subtype, 'biological') = ?2`,
		)
		.bind(childId, subtype, exceptEdgeId)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

const capMessage = (subtype: string) =>
	`A person can have at most ${MAX_PARENTS_PER_SUBTYPE} ${subtype} parents`;

export async function addEdge(db: D1Database, body: Record<string, unknown>) {
	const { childId, parentId } = body;
	const type = body.type ?? "parent";
	if (typeof childId !== "string" || typeof parentId !== "string") {
		throw new ApiError(400, "childId and parentId are required");
	}
	if (type !== "parent" && type !== "partner") {
		throw new ApiError(400, "type must be 'parent' or 'partner'");
	}
	if (childId === parentId) throw new ApiError(400, "Cannot link to self");
	const subtype = parseSubtype(type, body.subtype);
	const startDate = optionalText(body, "startDate", 40) ?? null;
	const startPlace = optionalText(body, "startPlace", 160) ?? null;
	const endDate = optionalText(body, "endDate", 40) ?? null;

	const found = await db
		.prepare(
			"SELECT COUNT(*) AS n FROM people WHERE id IN (?1, ?2) AND deleted_at IS NULL",
		)
		.bind(childId, parentId)
		.first<{ n: number }>();
	if (found?.n !== 2) throw new ApiError(404, "Person not found");

	if (type === "parent") {
		if ((await countParents(db, childId, subtype)) >= MAX_PARENTS_PER_SUBTYPE) {
			throw new ApiError(409, capMessage(subtype));
		}
		// the new parent must not already descend from the child
		if (await isAncestor(db, childId, parentId)) {
			throw new ApiError(409, "That link would create a cycle");
		}
	} else {
		const dup = await db
			.prepare(
				`SELECT 1 FROM edges WHERE type = 'partner' AND
				 ((child_id = ?1 AND parent_id = ?2) OR (child_id = ?2 AND parent_id = ?1))`,
			)
			.bind(childId, parentId)
			.first();
		if (dup) throw new ApiError(409, "Those two people are already linked");
	}

	const id = crypto.randomUUID();
	try {
		await db
			.prepare(
				`INSERT INTO edges (id, child_id, parent_id, type, subtype, start_date, start_place, end_date)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(id, childId, parentId, type, subtype, startDate, startPlace, endDate)
			.run();
	} catch {
		throw new ApiError(409, "Those two people are already linked");
	}
	return toEdge({
		id,
		child_id: childId,
		parent_id: parentId,
		type,
		subtype,
		start_date: startDate,
		start_place: startPlace,
		end_date: endDate,
	});
}

export async function updateEdge(
	db: D1Database,
	id: string,
	body: Record<string, unknown>,
) {
	const row = await db
		.prepare("SELECT * FROM edges WHERE id = ?")
		.bind(id)
		.first<EdgeRow>();
	if (!row) throw new ApiError(404, "Link not found");

	const sets: string[] = [];
	const values: (string | null)[] = [];
	if ("subtype" in body) {
		const subtype = parseSubtype(row.type, body.subtype);
		if (
			row.type === "parent" &&
			(await countParents(db, row.child_id, subtype, id)) >=
				MAX_PARENTS_PER_SUBTYPE
		) {
			throw new ApiError(409, capMessage(subtype));
		}
		sets.push("subtype = ?");
		values.push(subtype);
	}
	for (const [key, column, max] of [
		["startDate", "start_date", 40],
		["startPlace", "start_place", 160],
		["endDate", "end_date", 40],
	] as const) {
		const value = optionalText(body, key, max);
		if (value !== undefined) {
			sets.push(`${column} = ?`);
			values.push(value);
		}
	}
	if (sets.length === 0) throw new ApiError(400, "No fields to update");
	await db
		.prepare(`UPDATE edges SET ${sets.join(", ")} WHERE id = ?`)
		.bind(...values, id)
		.run();
	const updated = await db
		.prepare("SELECT * FROM edges WHERE id = ?")
		.bind(id)
		.first<EdgeRow>();
	return toEdge(updated!);
}

export async function deleteEdge(db: D1Database, id: string) {
	await db.prepare("DELETE FROM edges WHERE id = ?").bind(id).run();
}
