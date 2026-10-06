export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export const MAX_PARENTS = 2;

interface EdgeRow {
	id: string;
	child_id: string;
	parent_id: string;
	type: "parent" | "partner";
}

export function toEdge(row: EdgeRow) {
	return {
		id: row.id,
		childId: row.child_id,
		parentId: row.parent_id,
		type: row.type,
	};
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

	const found = await db
		.prepare("SELECT COUNT(*) AS n FROM people WHERE id IN (?1, ?2)")
		.bind(childId, parentId)
		.first<{ n: number }>();
	if (found?.n !== 2) throw new ApiError(404, "Person not found");

	if (type === "parent") {
		const parents = await db
			.prepare(
				"SELECT COUNT(*) AS n FROM edges WHERE child_id = ? AND type = 'parent'",
			)
			.bind(childId)
			.first<{ n: number }>();
		if ((parents?.n ?? 0) >= MAX_PARENTS) {
			throw new ApiError(409, `A person can have at most ${MAX_PARENTS} parents`);
		}
		// the new parent must not already descend from the child
		if (await isAncestor(db, childId, parentId)) {
			throw new ApiError(409, "That link would create a cycle");
		}
	}

	const id = crypto.randomUUID();
	try {
		await db
			.prepare(
				"INSERT INTO edges (id, child_id, parent_id, type) VALUES (?, ?, ?, ?)",
			)
			.bind(id, childId, parentId, type)
			.run();
	} catch {
		throw new ApiError(409, "Those two people are already linked");
	}
	return { id, childId, parentId, type };
}

export async function deleteEdge(db: D1Database, id: string) {
	await db.prepare("DELETE FROM edges WHERE id = ?").bind(id).run();
}
