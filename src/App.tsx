import {
	Background,
	BackgroundVariant,
	ConnectionMode,
	Controls,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Connection,
	type Edge,
	type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { BadgeNode, type BadgeNodeType } from "./components/BadgeNode";
import {
	DetailPanel,
	type ExistingRelation,
	type RelativeKind,
} from "./components/DetailPanel";
import { TrashDialog } from "./components/TrashDialog";
import { NODE_H, NODE_W, autoLayout } from "./layout";
import type { Link, LinkFields, Person, PersonFields } from "./types";

const nodeTypes = { badge: BadgeNode };
const GAP = 80;
const PANEL_PX = 448; // width of the detail panel (max-w-md) on wide screens

/** Only non-biological parent links get a label; marriage details live in the panel. */
const label = (l: Link) =>
	l.type === "parent" && l.subtype !== "biological" ? l.subtype : undefined;

function Canvas() {
	const [people, setPeople] = useState<Person[]>([]);
	const [links, setLinks] = useState<Link[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [trashOpen, setTrashOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	// Live drag positions, kept apart from `people` until the drag ends.
	const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
	const flow = useReactFlow();
	const peopleRef = useRef(people);
	peopleRef.current = people;
	const linksRef = useRef(links);
	linksRef.current = links;
	const inflight = useRef(0);
	const firstLoad = useRef(true);

	// Space the detail panel covers, so badges are centered in what's actually visible.
	const panelOpen = useRef(false);
	const panelPx = () => (panelOpen.current && window.innerWidth > 768 ? PANEL_PX : 0);

	const fitAll = useCallback(
		(duration = 300) =>
			void flow.fitView({
				maxZoom: 1,
				duration,
				padding: {
					top: "90px",
					left: "40px",
					bottom: "40px",
					right: `${panelPx() + 40}px`,
				},
			}),
		[flow],
	);

	const fail = useCallback((err: unknown) => {
		setError(err instanceof Error ? err.message : "Something went wrong");
		window.setTimeout(() => setError(null), 5000);
	}, []);

	/** Runs a server write while showing "Saving…"; refreshes are held back meanwhile. */
	const track = useCallback(async <T,>(work: Promise<T>) => {
		inflight.current += 1;
		setSaving(true);
		try {
			return await work;
		} finally {
			inflight.current -= 1;
			if (inflight.current === 0) setSaving(false);
		}
	}, []);

	const refresh = useCallback(async () => {
		// Never replace the screen with server data while one of our own saves is in flight.
		if (inflight.current > 0) return;
		try {
			const tree = await api.tree();
			if (inflight.current > 0) return;
			setPeople(tree.people);
			setLinks(tree.edges);
			if (firstLoad.current && tree.people.length > 0) {
				firstLoad.current = false;
				window.setTimeout(() => fitAll(0), 50);
			}
		} catch (err) {
			fail(err);
		} finally {
			setLoading(false);
		}
	}, [fail, fitAll]);

	useEffect(() => {
		void refresh();
		// Pick up other family members' edits whenever you come back to the tab.
		const onFocus = () => void refresh();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [refresh]);

	const nodes: BadgeNodeType[] = useMemo(
		() =>
			people.map((person) => ({
				id: person.id,
				type: "badge",
				position: dragging[person.id] ?? { x: person.x, y: person.y },
				data: { person },
				selected: person.id === selectedId,
			})),
		[people, dragging, selectedId],
	);

	const edges: Edge[] = useMemo(() => {
		const at = (id: string) => dragging[id]?.x ?? people.find((p) => p.id === id)?.x ?? 0;
		return links.map((l): Edge => {
			const common = { id: l.id, label: label(l), labelStyle: { fontSize: 11 } };
			if (l.type === "parent") {
				const dashed = l.subtype !== "biological";
				return {
					...common,
					source: l.parentId,
					target: l.childId,
					sourceHandle: "bottom",
					targetHandle: "top",
					type: "smoothstep",
					style: dashed ? { strokeDasharray: "6 4" } : undefined,
				};
			}
			// spouses: join the facing sides, left person's right dot to right person's left dot
			const [left, right] = at(l.childId) <= at(l.parentId) ? [l.childId, l.parentId] : [l.parentId, l.childId];
			const ended = l.subtype === "divorced" || l.subtype === "separated" || l.subtype === "widowed";
			return {
				...common,
				source: left,
				target: right,
				sourceHandle: "right",
				targetHandle: "left",
				type: "straight",
				style: { stroke: "#e11d48", strokeDasharray: ended ? "2 4" : undefined, strokeWidth: 2 },
			};
		});
	}, [links, people, dragging]);

	const patchLocal = (id: string, fields: Partial<Person>) =>
		setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...fields } : p)));

	const save = useCallback(
		async (id: string, fields: PersonFields) => {
			patchLocal(id, fields);
			try {
				await track(api.updatePerson(id, fields));
			} catch (err) {
				fail(err);
				void refresh();
			}
		},
		[fail, refresh, track],
	);

	const onNodesChange = useCallback(
		(changes: NodeChange<BadgeNodeType>[]) => {
			for (const c of changes) {
				if (c.type !== "position" || !c.position) continue;
				const { id, position } = c;
				setDragging((d) => ({ ...d, [id]: position }));
				if (c.dragging === false) {
					setDragging(({ [id]: _done, ...rest }) => rest);
					void save(id, { x: position.x, y: position.y });
				}
			}
		},
		[save],
	);

	const showPerson = useCallback(
		(p: Pick<Person, "x" | "y">) => {
			const zoom = Math.max(flow.getZoom(), 0.6);
			void flow.setCenter(p.x + NODE_W / 2 + panelPx() / 2 / zoom, p.y + NODE_H / 2, {
				zoom,
				duration: 300,
			});
		},
		[flow],
	);

	/** Nudges right until the spot isn't on top of another badge. */
	const freeSpot = (x: number, y: number) => {
		for (let i = 0; i < 60; i++) {
			const taken = peopleRef.current.some(
				(p) => Math.abs(p.x - x) < NODE_W + 20 && Math.abs(p.y - y) < NODE_H - 40,
			);
			if (!taken) break;
			x += NODE_W + 40;
		}
		return { x, y };
	};

	const addPerson = useCallback(
		async (at?: { x: number; y: number }) => {
			let spot = at;
			if (!spot) {
				const bounds = document.querySelector(".react-flow")?.getBoundingClientRect();
				const center = flow.screenToFlowPosition({
					x: (bounds?.left ?? 0) + (bounds?.width ?? 600) / 2,
					y: (bounds?.top ?? 0) + (bounds?.height ?? 400) / 2,
				});
				spot = { x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 };
			}
			const { x, y } = freeSpot(spot.x, spot.y);
			try {
				const person = await track(api.createPerson({ x, y }));
				setPeople((ps) => [...ps, person]);
				setSelectedId(person.id);
				showPerson(person);
				return person;
			} catch (err) {
				fail(err);
			}
		},
		[flow, fail, showPerson, track],
	);

	const link = useCallback(
		async (childId: string, parentId: string, type: "parent" | "partner", extra: LinkFields = {}) => {
			const created = await track(api.addLink({ childId, parentId, type, ...extra }));
			setLinks((ls) => [...ls, created]);
			return created;
		},
		[track],
	);

	const addRelative = async (id: string, kind: RelativeKind) => {
		const anchor = peopleRef.current.find((p) => p.id === id);
		if (!anchor) return;
		const parentLinks = linksRef.current.filter((l) => l.type === "parent" && l.childId === id);

		if (kind === "sibling" && parentLinks.length === 0) {
			return fail(new Error("Add a parent first, then siblings can share them."));
		}
		if (
			kind === "parent" &&
			parentLinks.filter((l) => l.subtype === "biological").length >= 2
		) {
			return fail(
				new Error('Already has two biological parents. Use "Link existing" to add a step, adoptive or foster parent.'),
			);
		}

		const spot = {
			parent: { x: anchor.x, y: anchor.y - (NODE_H + GAP) },
			child: { x: anchor.x, y: anchor.y + NODE_H + GAP },
			spouse: { x: anchor.x + NODE_W + 60, y: anchor.y },
			sibling: { x: anchor.x + NODE_W + 40, y: anchor.y },
		}[kind];
		const relative = await addPerson(spot);
		if (!relative) return;
		try {
			if (kind === "parent") await link(id, relative.id, "parent");
			if (kind === "child") await link(relative.id, id, "parent");
			if (kind === "spouse") await link(id, relative.id, "partner");
			if (kind === "sibling") {
				for (const l of parentLinks) {
					await link(relative.id, l.parentId, "parent", { subtype: l.subtype });
				}
			}
		} catch (err) {
			fail(err);
			// the new badge never got linked: remove it entirely instead of leaving it behind
			await api.trashPerson(relative.id).then(() => api.purgePerson(relative.id)).catch(() => {});
			void refresh();
		}
	};

	const linkExisting = async (id: string, relation: ExistingRelation, otherId: string) => {
		try {
			if (relation === "parent") await link(id, otherId, "parent");
			if (relation === "child") await link(otherId, id, "parent");
			if (relation === "spouse") await link(id, otherId, "partner");
		} catch (err) {
			fail(err);
		}
	};

	const onConnect = async (c: Connection) => {
		const { source, target, sourceHandle: sh, targetHandle: th } = c;
		try {
			if (sh === "bottom" && th === "top") await link(target, source, "parent");
			else if (sh === "top" && th === "bottom") await link(source, target, "parent");
			else if ((sh === "left" || sh === "right") && (th === "left" || th === "right"))
				await link(source, target, "partner");
			else
				fail(new Error("Connect a parent's bottom dot to a child's top dot, or the pink side dots for spouses."));
		} catch (err) {
			fail(err);
		}
	};

	const updateLink = async (linkId: string, fields: LinkFields) => {
		try {
			const updated = await track(api.updateLink(linkId, fields));
			setLinks((ls) => ls.map((l) => (l.id === linkId ? updated : l)));
		} catch (err) {
			fail(err);
		}
	};

	const removeLink = async (linkId: string) => {
		const before = linksRef.current;
		setLinks((ls) => ls.filter((l) => l.id !== linkId));
		try {
			await track(api.deleteLink(linkId));
		} catch (err) {
			setLinks(before);
			fail(err);
		}
	};

	/** Moves to the Trash: nothing is erased, and Trash can restore it. */
	const trashPerson = async (id: string) => {
		const before = { people: peopleRef.current, links: linksRef.current };
		setPeople((ps) => ps.filter((p) => p.id !== id));
		setLinks((ls) => ls.filter((l) => l.childId !== id && l.parentId !== id));
		setSelectedId(null);
		try {
			await track(api.trashPerson(id));
		} catch (err) {
			setPeople(before.people);
			setLinks(before.links);
			fail(err);
		}
	};

	const tidy = async () => {
		const positions = autoLayout(people, links);
		setPeople((ps) => ps.map((p) => ({ ...p, ...(positions.get(p.id) ?? {}) })));
		await track(
			Promise.all([...positions].map(([id, pos]) => api.updatePerson(id, pos))),
		).catch(fail);
		window.setTimeout(() => fitAll(), 50);
	};

	const select = (id: string) => {
		setSelectedId(id);
		const p = peopleRef.current.find((x) => x.id === id);
		if (p) showPerson(p);
	};

	const selected = people.find((p) => p.id === selectedId);
	panelOpen.current = !!selected;

	return (
		<div className="relative h-screen w-screen overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onConnect={onConnect}
				onNodeClick={(_, n) => setSelectedId(n.id)}
				onEdgeClick={(_, e) => {
					const l = links.find((x) => x.id === e.id);
					if (l) setSelectedId(l.childId);
				}}
				onPaneClick={() => setSelectedId(null)}
				// Backspace/Delete must never erase anyone; removal is explicit (panel > Move to Trash).
				deleteKeyCode={null}
				connectionMode={ConnectionMode.Loose}
				fitView
				minZoom={0.1}
				snapToGrid
				snapGrid={[20, 20]}
				proOptions={{ hideAttribution: true }}
			>
				<Background variant={BackgroundVariant.Dots} gap={20} />
				<Controls />
				<MiniMap pannable zoomable />
			</ReactFlow>

			<div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
				<h1 className="mr-2 text-lg font-semibold">Family Tree</h1>
				<button
					onClick={() => void addPerson()}
					className="rounded-md bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700"
				>
					+ Add person
				</button>
				<button
					onClick={() => void tidy()}
					className="rounded-md bg-white px-3 py-2 text-sm shadow-float ring-glass dark:bg-neutral-800"
				>
					Auto-arrange
				</button>
				<button
					onClick={() => fitAll()}
					className="rounded-md bg-white px-3 py-2 text-sm shadow-float ring-glass dark:bg-neutral-800"
				>
					Show everyone
				</button>
				<button
					onClick={() => setTrashOpen(true)}
					className="rounded-md bg-white px-3 py-2 text-sm shadow-float ring-glass dark:bg-neutral-800"
				>
					Trash
				</button>
			</div>

			{!loading && people.length === 0 && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center text-neutral-500">
					Add your first person to start the tree.
				</div>
			)}

			{error && (
				<div
					role="alert"
					className="absolute bottom-4 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
				>
					{error}
				</div>
			)}

			{selected && (
				<DetailPanel
					person={selected}
					people={people}
					links={links}
					saving={saving}
					onChange={(id, fields) => void save(id, fields)}
					onPhoto={(id, photoVersion) => patchLocal(id, { photoVersion })}
					onSelect={select}
					onAddRelative={(id, kind) => void addRelative(id, kind)}
					onLinkExisting={(id, rel, other) => void linkExisting(id, rel, other)}
					onUpdateLink={(id, fields) => void updateLink(id, fields)}
					onRemoveLink={(id) => void removeLink(id)}
					onDelete={(id) => void trashPerson(id)}
					onClose={() => setSelectedId(null)}
					onError={(m) => fail(new Error(m))}
				/>
			)}

			{trashOpen && (
				<TrashDialog
					onClose={() => setTrashOpen(false)}
					onRestored={() => void refresh()}
					onError={fail}
				/>
			)}
		</div>
	);
}

export default function App() {
	return (
		<ReactFlowProvider>
			<Canvas />
		</ReactFlowProvider>
	);
}
