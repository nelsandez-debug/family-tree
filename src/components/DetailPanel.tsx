import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, photoUrl, preparePhoto } from "../api";
import { extendedFamily } from "../family";
import {
	PARENT_KINDS,
	PARTNER_KINDS,
	type Link,
	type LinkFields,
	type Person,
	type PersonFields,
} from "../types";

export type RelativeKind = "parent" | "child" | "spouse" | "sibling";
export type ExistingRelation = "parent" | "child" | "spouse";

interface Props {
	person: Person;
	people: Person[];
	links: Link[];
	saving: boolean;
	onChange: (id: string, fields: PersonFields) => void;
	onPhoto: (id: string, photoVersion: number) => void;
	onSelect: (id: string) => void;
	onAddRelative: (id: string, kind: RelativeKind) => void;
	onLinkExisting: (id: string, relation: ExistingRelation, otherId: string) => void;
	onUpdateLink: (linkId: string, fields: LinkFields) => void;
	onRemoveLink: (linkId: string) => void;
	onDelete: (id: string) => void;
	onClose: () => void;
	onError: (message: string) => void;
}

const inputClass =
	"w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-600";
const primaryBtn =
	"rounded-md bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-700";
const sectionTitle =
	"text-xs font-semibold uppercase tracking-wide text-neutral-400";

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="block text-xs font-medium text-neutral-500">
			{label}
			<div className="mt-1">{children}</div>
		</label>
	);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One saved relationship, with its kind and (for spouses) marriage details. */
function LinkRow({
	link,
	other,
	role,
	onSelect,
	onUpdate,
	onRemove,
}: {
	link: Link;
	other: Person;
	role: string;
	onSelect: (id: string) => void;
	onUpdate: (fields: LinkFields) => void;
	onRemove: () => void;
}) {
	const [draft, setDraft] = useState({
		startDate: link.startDate ?? "",
		startPlace: link.startPlace ?? "",
		endDate: link.endDate ?? "",
	});
	const kinds = link.type === "parent" ? PARENT_KINDS : PARTNER_KINDS;
	const save = (key: keyof typeof draft) => {
		if (draft[key] !== (link[key] ?? "")) onUpdate({ [key]: draft[key] || null });
	};
	const small =
		"w-full rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-600";

	return (
		<div className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-700">
			<div className="flex items-center gap-2">
				<span className="w-16 shrink-0 text-xs text-neutral-500">{role}</span>
				<button
					onClick={() => onSelect(other.id)}
					className="min-w-0 flex-1 truncate text-left text-sm font-medium text-sky-700 hover:underline dark:text-sky-300"
				>
					{other.name}
				</button>
				<select
					aria-label={`${role} kind`}
					value={link.subtype}
					onChange={(e) => onUpdate({ subtype: e.target.value as Link["subtype"] })}
					className="rounded border border-neutral-300 bg-transparent px-1 py-1 text-xs dark:border-neutral-600"
				>
					{kinds.map((k) => (
						<option key={k} value={k}>
							{cap(k)}
						</option>
					))}
				</select>
				<button
					onClick={onRemove}
					aria-label={`Remove link to ${other.name}`}
					title="Remove this link (nobody is deleted)"
					className="px-1 text-lg leading-none text-neutral-400 hover:text-red-600"
				>
					×
				</button>
			</div>
			{link.type === "partner" && (
				<div className="mt-2 grid grid-cols-3 gap-2">
					<input
						className={small}
						placeholder="Married"
						aria-label="Marriage date"
						value={draft.startDate}
						onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
						onBlur={() => save("startDate")}
					/>
					<input
						className={small}
						placeholder="Where"
						aria-label="Marriage place"
						value={draft.startPlace}
						onChange={(e) => setDraft({ ...draft, startPlace: e.target.value })}
						onBlur={() => save("startPlace")}
					/>
					<input
						className={small}
						placeholder="Ended"
						aria-label="Relationship end date"
						value={draft.endDate}
						onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
						onBlur={() => save("endDate")}
					/>
				</div>
			)}
		</div>
	);
}

export function DetailPanel(props: Props) {
	const { person, people, links, onChange, onPhoto, onError } = props;
	const [draft, setDraft] = useState(person);
	const [uploading, setUploading] = useState(false);
	const [relation, setRelation] = useState<ExistingRelation>("parent");
	const [otherId, setOtherId] = useState("");
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
		setOtherId("");
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

	const text = (key: keyof PersonFields & keyof Person, label: string, placeholder = "") => (
		<Field label={label}>
			<input
				className={inputClass}
				placeholder={placeholder}
				value={(draft[key] as string | null) ?? ""}
				onChange={(e) => edit({ [key]: e.target.value || null })}
			/>
		</Field>
	);

	const byId = (id: string) => people.find((p) => p.id === id);
	const direct = links.flatMap((l) => {
		if (l.type === "partner" && (l.childId === person.id || l.parentId === person.id)) {
			const other = byId(l.childId === person.id ? l.parentId : l.childId);
			return other ? [{ link: l, other, role: "Spouse" }] : [];
		}
		if (l.type === "parent" && l.childId === person.id) {
			const other = byId(l.parentId);
			return other ? [{ link: l, other, role: "Parent" }] : [];
		}
		if (l.type === "parent" && l.parentId === person.id) {
			const other = byId(l.childId);
			return other ? [{ link: l, other, role: "Child" }] : [];
		}
		return [];
	});
	const family = extendedFamily(person.id, people, links);
	const candidates = people
		.filter((p) => p.id !== person.id)
		.sort((a, b) => a.name.localeCompare(b.name));

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

	const src = photoUrl(person);
	return (
		<aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-5 shadow-2xl dark:bg-neutral-900">
			<div className="flex items-start justify-between">
				<h2 className="text-lg font-semibold">Edit badge</h2>
				<div className="flex items-center gap-3">
					<span className="text-xs text-neutral-400" aria-live="polite">
						{props.saving ? "Saving…" : "All changes saved"}
					</span>
					<button onClick={props.onClose} aria-label="Close" className="px-2 text-xl">
						×
					</button>
				</div>
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

			<div className="space-y-3">
				<div className={sectionTitle}>Name</div>
				<Field label="Name shown on badge">
					<input
						className={inputClass}
						value={draft.name}
						onChange={(e) => edit({ name: e.target.value })}
					/>
				</Field>
				<div className="grid grid-cols-2 gap-3">
					{text("middleName", "Middle name")}
					{text("nickname", "Nickname")}
				</div>
				{text("maidenName", "Maiden name (birth name)")}
			</div>

			<div className="space-y-3">
				<div className={sectionTitle}>Life</div>
				<div className="grid grid-cols-2 gap-3">
					{text("birth", "Date of birth", "1950 or 1950-03-12")}
					{text("birthPlace", "Place of birth")}
					{text("death", "Date of death")}
					{text("deathPlace", "Place of death / resting place")}
				</div>
				<div className="grid grid-cols-2 gap-3">
					{text("occupation", "Occupation")}
					{text("location", "Lives in")}
				</div>
				<Field label="Bio">
					<textarea
						className={`${inputClass} min-h-40`}
						value={draft.bio}
						onChange={(e) => edit({ bio: e.target.value })}
					/>
				</Field>
			</div>

			<div className="space-y-2">
				<div className={sectionTitle}>Relationships</div>
				{direct.length === 0 && (
					<p className="text-sm text-neutral-500">
						No links yet. Add one below, or drag between badge dots on the canvas.
					</p>
				)}
				{direct.map(({ link, other, role }) => (
					<LinkRow
						key={link.id}
						link={link}
						other={other}
						role={role}
						onSelect={props.onSelect}
						onUpdate={(fields) => props.onUpdateLink(link.id, fields)}
						onRemove={() => props.onRemoveLink(link.id)}
					/>
				))}

				<div className="flex flex-wrap gap-2 pt-1">
					{(["parent", "child", "spouse", "sibling"] as RelativeKind[]).map((k) => (
						<button
							key={k}
							className={primaryBtn}
							onClick={() => props.onAddRelative(person.id, k)}
						>
							+ {cap(k)}
						</button>
					))}
				</div>

				{candidates.length > 0 && (
					<div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
						<span className="text-neutral-500">Link existing:</span>
						<select
							aria-label="Relationship"
							value={relation}
							onChange={(e) => setRelation(e.target.value as ExistingRelation)}
							className="rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-600"
						>
							<option value="parent">is a parent of {draft.name || "this person"}</option>
							<option value="child">is a child of {draft.name || "this person"}</option>
							<option value="spouse">is a spouse/partner of {draft.name || "this person"}</option>
						</select>
						<select
							aria-label="Person to link"
							value={otherId}
							onChange={(e) => setOtherId(e.target.value)}
							className="min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-600"
						>
							<option value="">Choose person…</option>
							{candidates.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
									{p.birth ? ` (${p.birth})` : ""}
								</option>
							))}
						</select>
						<button
							disabled={!otherId}
							className={`${primaryBtn} disabled:opacity-40`}
							onClick={() => {
								props.onLinkExisting(person.id, relation, otherId);
								setOtherId("");
							}}
						>
							Link
						</button>
					</div>
				)}
			</div>

			{family.length > 0 && (
				<div className="space-y-3">
					<div className={sectionTitle}>Family (worked out from the links)</div>
					{family.map((g) => (
						<div key={g.label}>
							<div className="text-xs font-medium text-neutral-500">{g.label}</div>
							<div className="mt-1 flex flex-wrap gap-2">
								{g.people.map((p) => (
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
					))}
				</div>
			)}

			<div className="mt-auto flex justify-end border-t border-neutral-200 pt-3 dark:border-neutral-700">
				<button
					className="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-neutral-800"
					onClick={() => {
						if (
							confirm(
								`Move ${person.name} to the Trash? You can restore them from Trash at any time.`,
							)
						) {
							props.onDelete(person.id);
						}
					}}
				>
					Move to Trash
				</button>
			</div>
		</aside>
	);
}
