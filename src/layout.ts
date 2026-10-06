import type { Link, Person } from "./types";

export const NODE_W = 180;
export const NODE_H = 220;
const GAP_X = 40;
const GAP_Y = 80;

/**
 * Places people in generations: roots on top, each child below its deepest
 * parent. Spouses share a row and sit side by side, and siblings stay together.
 */
export function autoLayout(people: Person[], edges: Link[]) {
	const parentsOf = new Map<string, string[]>();
	const partnersOf = new Map<string, string[]>();
	const push = (map: Map<string, string[]>, key: string, value: string) =>
		map.set(key, [...(map.get(key) ?? []), value]);
	for (const e of edges) {
		if (e.type === "parent") push(parentsOf, e.childId, e.parentId);
		else {
			push(partnersOf, e.childId, e.parentId);
			push(partnersOf, e.parentId, e.childId);
		}
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
	for (const p of people) depthOf(p.id);

	// A spouse who married in (no parents on the tree) joins their partner's row.
	for (let pass = 0; pass < people.length; pass++) {
		let changed = false;
		for (const p of people) {
			if ((parentsOf.get(p.id) ?? []).length > 0) continue;
			const target = Math.max(0, ...(partnersOf.get(p.id) ?? []).map((id) => depth.get(id) ?? 0));
			if (target > (depth.get(p.id) ?? 0)) {
				depth.set(p.id, target);
				changed = true;
			}
		}
		if (!changed) break;
	}

	const byRow = new Map<number, Person[]>();
	for (const p of people) {
		const d = depth.get(p.id) ?? 0;
		byRow.set(d, [...(byRow.get(d) ?? []), p]);
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const [d, row] of byRow) {
		// order: siblings together (by first parent), then pull each person's spouses next to them
		const key = (p: Person) => (parentsOf.get(p.id) ?? [])[0] ?? "";
		const sorted = [...row].sort((a, b) => key(a).localeCompare(key(b)));
		const inRow = new Set(row.map((p) => p.id));
		const placed = new Set<string>();
		const ordered: Person[] = [];
		const place = (p: Person) => {
			if (placed.has(p.id)) return;
			placed.add(p.id);
			ordered.push(p);
			for (const id of partnersOf.get(p.id) ?? []) {
				const partner = row.find((r) => r.id === id);
				if (partner && inRow.has(id)) place(partner);
			}
		};
		sorted.forEach(place);

		const width = ordered.length * (NODE_W + GAP_X) - GAP_X;
		ordered.forEach((p, i) =>
			positions.set(p.id, {
				x: -width / 2 + i * (NODE_W + GAP_X),
				y: d * (NODE_H + GAP_Y),
			}),
		);
	}
	return positions;
}
