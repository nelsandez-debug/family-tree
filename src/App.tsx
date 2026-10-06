import {
	Background,
	BackgroundVariant,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { BadgeNode, type BadgeNodeType } from "./components/BadgeNode";
import { DetailPanel } from "./components/DetailPanel";
import { NODE_H, NODE_W, autoLayout } from "./layout";
import type { Link, Person, PersonFields } from "./types";

const nodeTypes = { badge: BadgeNode };

function Canvas() {
	const [people, setPeople] = useState<Person[]>([]);
	const [links, setLinks] = useState<Link[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	// Live drag positions, kept apart from `people` until the drag ends.
	const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
	const flow = useReactFlow();

	const fail = useCallback((err: unknown) => {
		setError(err instanceof Error ? err.message : "Something went wrong");
		window.setTimeout(() => setError(null), 4000);
	}, []);

	const refresh = useCallback(async () => {
		try {
			const tree = await api.tree();
			setPeople(tree.people);
			setLinks(tree.edges);
		} catch (err) {
			fail(err);
		} finally {
			setLoading(false);
		}
	}, [fail]);

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

	const edges: Edge[] = useMemo(
		() =>
			links
				.filter((l) => l.type === "parent")
				.map((l) => ({
					id: l.id,
					source: l.parentId,
					target: l.childId,
					type: "smoothstep",
				})),
		[links],
	);

	const patchLocal = (id: string, fields: PersonFields) =>
		setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, ...fields } : p)));

	const save = useCallback(
		async (id: string, fields: PersonFields) => {
			patchLocal(id, fields);
			try {
				await api.updatePerson(id, fields);
			} catch (err) {
				fail(err);
				void refresh();
			}
		},
		[fail, refresh],
	);

	const onNodesChange = useCallback(
		(changes: NodeChange<BadgeNodeType>[]) => {
			for (const c of changes) {
				if (c.type === "position" && c.position) {
					const { id, position } = c;
					setDragging((d) => ({ ...d, [id]: position }));
					if (c.dragging === false) {
						setDragging(({ [id]: _done, ...rest }) => rest);
						void save(id, { x: position.x, y: position.y });
					}
				}
				if (c.type === "select" && c.selected) setSelectedId(c.id);
			}
		},
		[save],
	);

	const addPerson = useCallback(
		async (fields: PersonFields = {}) => {
			const bounds = document.querySelector(".react-flow")?.getBoundingClientRect();
			const center = flow.screenToFlowPosition({
				x: (bounds?.left ?? 0) + (bounds?.width ?? 600) / 2,
				y: (bounds?.top ?? 0) + (bounds?.height ?? 400) / 2,
			});
			try {
				const person = await api.createPerson({
					x: center.x - NODE_W / 2,
					y: center.y - NODE_H / 2,
					...fields,
				});
				setPeople((ps) => [...ps, person]);
				setSelectedId(person.id);
				return person;
			} catch (err) {
				fail(err);
			}
		},
		[flow, fail],
	);

	const addRelative = async (id: string, kind: "parent" | "child") => {
		const anchor = people.find((p) => p.id === id);
		if (!anchor) return;
		const offset = kind === "parent" ? -(NODE_H + 80) : NODE_H + 80;
		const relative = await addPerson({ x: anchor.x, y: anchor.y + offset });
		if (!relative) return;
		try {
			const link =
				kind === "parent"
					? await api.addLink(id, relative.id)
					: await api.addLink(relative.id, id);
			setLinks((ls) => [...ls, link]);
		} catch (err) {
			fail(err);
			await api.deletePerson(relative.id).catch(() => {});
			void refresh();
		}
	};

	const onConnect = async (c: Connection) => {
		// parent's bottom handle (source) -> child's top handle (target)
		try {
			const link = await api.addLink(c.target, c.source);
			setLinks((ls) => [...ls, link]);
		} catch (err) {
			fail(err);
		}
	};

	const removeEdges = async (removed: Edge[]) => {
		setLinks((ls) => ls.filter((l) => !removed.some((e) => e.id === l.id)));
		await Promise.all(removed.map((e) => api.deleteLink(e.id))).catch(fail);
	};

	const removePeople = async (ids: string[]) => {
		setPeople((ps) => ps.filter((p) => !ids.includes(p.id)));
		setLinks((ls) =>
			ls.filter((l) => !ids.includes(l.childId) && !ids.includes(l.parentId)),
		);
		setSelectedId((s) => (s && ids.includes(s) ? null : s));
		await Promise.all(ids.map((id) => api.deletePerson(id))).catch(fail);
	};

	const tidy = async () => {
		const positions = autoLayout(people, links);
		setPeople((ps) =>
			ps.map((p) => ({ ...p, ...(positions.get(p.id) ?? {}) })),
		);
		await Promise.all(
			[...positions].map(([id, pos]) => api.updatePerson(id, pos)),
		).catch(fail);
		window.setTimeout(() => void flow.fitView({ duration: 300 }), 50);
	};

	const select = (id: string) => {
		setSelectedId(id);
		const p = people.find((x) => x.id === id);
		if (p) {
			void flow.setCenter(p.x + NODE_W / 2, p.y + NODE_H / 2, {
				zoom: flow.getZoom(),
				duration: 300,
			});
		}
	};

	const selected = people.find((p) => p.id === selectedId);

	return (
		<div className="relative h-screen w-screen overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onConnect={onConnect}
				onEdgesDelete={removeEdges}
				onNodesDelete={(ns) => void removePeople(ns.map((n) => n.id))}
				onNodeClick={(_, n) => setSelectedId(n.id)}
				onPaneClick={() => setSelectedId(null)}
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

			<div className="absolute left-4 top-4 z-10 flex items-center gap-2">
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
			</div>

			{!loading && people.length === 0 && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center text-neutral-500">
					Add your first person to start the tree.
				</div>
			)}

			{error && (
				<div
					role="alert"
					className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
				>
					{error}
				</div>
			)}

			{selected && (
				<DetailPanel
					person={selected}
					people={people}
					edges={links}
					onChange={(id, fields) => void save(id, fields)}
					onPhoto={(id, photoVersion) => patchLocal(id, { photoVersion } as PersonFields)}
					onSelect={select}
					onAddRelative={(id, kind) => void addRelative(id, kind)}
					onDelete={(id) => void removePeople([id])}
					onClose={() => setSelectedId(null)}
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
