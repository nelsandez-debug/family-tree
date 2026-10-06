import type { Link, Person } from "./types";

export const NODE_W = 180;
export const NODE_H = 220;
const GAP_X = 40;
const GAP_Y = 80;

/** Places people in generations: roots on top, each child below its deepest parent. */
export function autoLayout(people: Person[], edges: Link[]) {
	const parentsOf = new Map<string, string[]>();
	for (const e of edges) {
		if (e.type !== "parent") continue;
		parentsOf.set(e.childId, [...(parentsOf.get(e.childId) ?? []), e.parentId]);
	}

	const depth = new Map<string, number>();
	const depthOf = (id: string, seen = new Set<string>()): number => {
		if (depth.has(id)) return depth.get(id)!;
		if (seen.has(id)) return 0; // defensive: server blocks cycles
		seen.add(id);
		const ps = parentsOf.get(id) ?? [];
		const d = ps.length ? 1 + Math.max(...ps.map((p) => depthOf(p, seen))) : 0;
		depth.set(id, d);
		return d;
	};

	const rows = new Map<number, Person[]>();
	for (const p of people) {
		const d = depthOf(p.id);
		rows.set(d, [...(rows.get(d) ?? []), p]);
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const [d, row] of rows) {
		const width = row.length * (NODE_W + GAP_X) - GAP_X;
		row.forEach((p, i) =>
			positions.set(p.id, {
				x: -width / 2 + i * (NODE_W + GAP_X),
				y: d * (NODE_H + GAP_Y),
			}),
		);
	}
	return positions;
}
