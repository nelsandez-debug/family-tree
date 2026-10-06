import { useEffect, useRef, useState } from "react";
import { api, photoUrl, preparePhoto } from "../api";
import type { Link, Person, PersonFields } from "../types";

interface Props {
	person: Person;
	people: Person[];
	edges: Link[];
	onChange: (id: string, fields: PersonFields) => void;
	onPhoto: (id: string, photoVersion: number) => void;
	onSelect: (id: string) => void;
	onAddRelative: (id: string, kind: "parent" | "child") => void;
	onDelete: (id: string) => void;
	onClose: () => void;
	onError: (message: string) => void;
}

const inputClass =
	"w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-600";
const primaryBtn =
	"rounded-md bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700";

export function DetailPanel(props: Props) {
	const { person, people, edges, onChange, onPhoto, onError } = props;
	const [draft, setDraft] = useState(person);
	const [uploading, setUploading] = useState(false);
	const timer = useRef<number>(undefined);
	const pending = useRef<{ id: string; fields: PersonFields }>({
		id: person.id,
		fields: {},
	});
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const flush = () => {
		window.clearTimeout(timer.current);
		const { id, fields } = pending.current;
		if (Object.keys(fields).length) {
			onChangeRef.current(id, fields);
			pending.current = { id, fields: {} };
		}
	};

	// Switching person: save what was typed for the previous one, then reset the
	// draft. Remote refreshes of the same person never overwrite typing.
	useEffect(() => {
		setDraft(person);
		pending.current = { id: person.id, fields: {} };
		return flush;
	}, [person.id]); // eslint-disable-line react-hooks/exhaustive-deps

	const edit = (fields: PersonFields) => {
		setDraft((d) => ({ ...d, ...fields }));
		pending.current = {
			id: person.id,
			fields: { ...pending.current.fields, ...fields },
		};
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, 600);
	};

	const byId = (id: string) => people.find((p) => p.id === id);
	const parents = edges
		.filter((e) => e.type === "parent" && e.childId === person.id)
		.map((e) => byId(e.parentId))
		.filter((p): p is Person => !!p);
	const children = edges
		.filter((e) => e.type === "parent" && e.parentId === person.id)
		.map((e) => byId(e.childId))
		.filter((p): p is Person => !!p);

	const upload = async (file: File | undefined) => {
		if (!file) return;
		setUploading(true);
		try {
			const blob = await preparePhoto(file);
			const { photoVersion } = await api.uploadPhoto(person.id, blob);
			onPhoto(person.id, photoVersion);
		} catch (err) {
			onError(err instanceof Error ? err.message : "Upload failed");
		} finally {
			setUploading(false);
		}
	};

	const field = (label: string, key: "birth" | "death" | "location", ph = "") => (
		<label className="block text-xs font-medium text-neutral-500">
			{label}
			<input
				className={`${inputClass} mt-1`}
				placeholder={ph}
				value={draft[key] ?? ""}
				onChange={(e) => edit({ [key]: e.target.value || null })}
			/>
		</label>
	);

	const relatives = (title: string, list: Person[]) =>
		list.length > 0 && (
			<div>
				<div className="text-xs font-medium text-neutral-500">{title}</div>
				<div className="mt-1 flex flex-wrap gap-2">
					{list.map((p) => (
						<button
							key={p.id}
							onClick={() => props.onSelect(p.id)}
							className="rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-800 hover:bg-sky-200 dark:bg-neutral-700 dark:text-sky-200"
						>
							{p.name}
						</button>
					))}
				</div>
			</div>
		);

	const src = photoUrl(person);
	return (
		<aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col gap-4 overflow-y-auto bg-white p-5 shadow-2xl dark:bg-neutral-900">
			<div className="flex items-start justify-between">
				<h2 className="text-lg font-semibold">Edit badge</h2>
				<button onClick={props.onClose} aria-label="Close" className="px-2 text-xl">
					×
				</button>
			</div>

			<div className="flex items-center gap-4">
				{src ? (
					<img src={src} alt="" className="h-20 w-20 rounded-full object-cover" />
				) : (
					<div className="flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 text-2xl font-semibold text-sky-700">
						{draft.name.trim().slice(0, 1).toUpperCase() || "?"}
					</div>
				)}
				<label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800">
					{uploading ? "Uploading…" : src ? "Change photo" : "Add photo"}
					<input
						type="file"
						accept="image/*"
						className="hidden"
						disabled={uploading}
						onChange={(e) => {
							void upload(e.target.files?.[0]);
							e.target.value = "";
						}}
					/>
				</label>
			</div>

			<label className="block text-xs font-medium text-neutral-500">
				Name
				<input
					className={`${inputClass} mt-1`}
					value={draft.name}
					onChange={(e) => edit({ name: e.target.value })}
				/>
			</label>
			<div className="grid grid-cols-2 gap-3">
				{field("Born", "birth", "1950")}
				{field("Died", "death")}
			</div>
			{field("Location", "location")}
			<label className="block text-xs font-medium text-neutral-500">
				Bio
				<textarea
					className={`${inputClass} mt-1 min-h-40`}
					value={draft.bio}
					onChange={(e) => edit({ bio: e.target.value })}
				/>
			</label>

			{relatives("Parents", parents)}
			{relatives("Children", children)}

			<div className="flex gap-2">
				<button className={primaryBtn} onClick={() => props.onAddRelative(person.id, "parent")}>
					+ Parent
				</button>
				<button className={primaryBtn} onClick={() => props.onAddRelative(person.id, "child")}>
					+ Child
				</button>
				<button
					className="ml-auto rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-neutral-800"
					onClick={() => {
						if (confirm(`Delete ${person.name}?`)) props.onDelete(person.id);
					}}
				>
					Delete
				</button>
			</div>
		</aside>
	);
}
