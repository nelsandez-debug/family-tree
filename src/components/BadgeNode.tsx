import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { photoUrl } from "../api";
import type { Person } from "../types";

export type BadgeData = { person: Person } & Record<string, unknown>;
export type BadgeNodeType = Node<BadgeData, "badge">;

const years = (p: Person) =>
	p.birth || p.death ? `${p.birth ?? "?"} – ${p.death ?? ""}`.trim() : "";

export function BadgeNode({ data, selected }: NodeProps<BadgeNodeType>) {
	const { person } = data;
	const src = photoUrl(person);
	return (
		<div
			className={`flex w-[180px] flex-col items-center rounded-2xl bg-white px-4 pb-4 pt-5 text-center shadow-float ring-glass dark:bg-neutral-800 ${
				selected ? "outline-2 outline-offset-2 outline-sky-500" : ""
			}`}
		>
			<Handle type="target" position={Position.Top} className="!h-3 !w-3" />
			{src ? (
				<img
					src={src}
					alt=""
					className="h-24 w-24 rounded-full object-cover ring-4 ring-sky-100 dark:ring-neutral-700"
				/>
			) : (
				<div className="flex h-24 w-24 items-center justify-center rounded-full bg-sky-100 text-3xl font-semibold text-sky-700 dark:bg-neutral-700 dark:text-sky-300">
					{person.name.trim().slice(0, 1).toUpperCase() || "?"}
				</div>
			)}
			<div className="mt-3 w-full truncate font-semibold">{person.name}</div>
			<div className="h-5 text-xs text-neutral-500">{years(person)}</div>
			<Handle type="source" position={Position.Bottom} className="!h-3 !w-3" />
		</div>
	);
}
