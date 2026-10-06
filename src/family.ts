import type { Link, Person } from "./types";

export interface RelativeGroup {
	label: string;
	people: Person[];
}

/**
 * Works out everyone related to `personId` from the stored parent and partner
 * links. Nothing here is saved: in-laws, step-relations, cousins and so on are
 * derived, so they can never get out of sync with the tree.
 */
export function extendedFamily(
	personId: string,
	people: Person[],
	links: Link[],
): RelativeGroup[] {
	const byId = new Map(people.map((p) => [p.id, p]));
	const parentsOf = new Map<string, Set<string>>();
	const childrenOf = new Map<string, Set<string>>();
	const partnersOf = new Map<string, Set<string>>();
	const add = (map: Map<string, Set<string>>, key: string, value: string) =>
		map.set(key, (map.get(key) ?? new Set()).add(value));

	for (const l of links) {
		if (l.type === "parent") {
			add(parentsOf, l.childId, l.parentId);
			add(childrenOf, l.parentId, l.childId);
		} else {
			add(partnersOf, l.childId, l.parentId);
			add(partnersOf, l.parentId, l.childId);
		}
	}

	const of = (map: Map<string, Set<string>>, id: string) => [...(map.get(id) ?? [])];
	const flat = (ids: string[], map: Map<string, Set<string>>) =>
		ids.flatMap((id) => of(map, id));
	const siblingsOf = (id: string) =>
		flat(of(parentsOf, id), childrenOf).filter((s) => s !== id);

	const me = personId;
	const parents = of(parentsOf, me);
	const children = of(childrenOf, me);
	const partners = of(partnersOf, me);
	const siblings = siblingsOf(me);

	const groups: [string, string[]][] = [
		["Spouses & partners", partners],
		["Parents", parents],
		["Siblings", siblings],
		["Children", children],
		["Grandparents", flat(parents, parentsOf)],
		["Grandchildren", flat(children, childrenOf)],
		["Aunts & uncles", parents.flatMap(siblingsOf)],
		["Cousins", parents.flatMap(siblingsOf).flatMap((a) => of(childrenOf, a))],
		["Nieces & nephews", siblings.flatMap((s) => of(childrenOf, s))],
		// parents' partners who aren't themselves a parent of this person
		["Step-parents", flat(parents, partnersOf).filter((s) => !parents.includes(s))],
		// partners' children who aren't this person's own children
		["Step-children", flat(partners, childrenOf).filter((c) => !children.includes(c))],
		["Parents-in-law", flat(partners, parentsOf)],
		// partners' siblings, and siblings' partners
		["Siblings-in-law", [...partners.flatMap(siblingsOf), ...flat(siblings, partnersOf)]],
		["Children-in-law", flat(children, partnersOf)],
	];

	return groups
		.map(([label, ids]) => ({
			label,
			people: [...new Set(ids)]
				.filter((id) => id !== me)
				.map((id) => byId.get(id))
				.filter((p): p is Person => !!p),
		}))
		.filter((g) => g.people.length > 0);
}
