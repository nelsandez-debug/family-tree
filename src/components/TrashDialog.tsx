import { useEffect, useState } from "react";
import { api } from "../api";
import type { TrashedPerson } from "../types";

interface Props {
	onClose: () => void;
	onRestored: () => void;
	onError: (err: unknown) => void;
}

/** Everyone who was deleted, with a one-tap way to bring them back. */
export function TrashDialog({ onClose, onRestored, onError }: Props) {
	const [items, setItems] = useState<TrashedPerson[] | null>(null);

	useEffect(() => {
		api.trash().then(setItems).catch(onError);
	}, [onError]);

	const restore = async (p: TrashedPerson) => {
		try {
			await api.restorePerson(p.id);
			setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null);
			onRestored();
		} catch (err) {
			onError(err);
		}
	};

	const purge = async (p: TrashedPerson) => {
		if (!confirm(`Permanently delete ${p.name}? This cannot be undone.`)) return;
		try {
			await api.purgePerson(p.id);
			setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null);
		} catch (err) {
			onError(err);
		}
	};

	return (
		<div
			className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-label="Trash"
				className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-lg font-semibold">Trash</h2>
					<button onClick={onClose} aria-label="Close" className="px-2 text-xl">
						×
					</button>
				</div>
				<div className="overflow-y-auto">
					{items === null && <p className="text-sm text-neutral-500">Loading…</p>}
					{items?.length === 0 && (
						<p className="text-sm text-neutral-500">
							Nothing here. Deleted badges show up here so they can be restored.
						</p>
					)}
					<ul className="space-y-2">
						{items?.map((p) => (
							<li
								key={p.id}
								className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-700"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">{p.name}</div>
									<div className="text-xs text-neutral-500">
										Deleted {new Date(p.deletedAt).toLocaleString()}
									</div>
								</div>
								<button
									onClick={() => void restore(p)}
									className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700"
								>
									Restore
								</button>
								<button
									onClick={() => void purge(p)}
									className="px-2 text-xs text-red-600 hover:underline"
								>
									Delete forever
								</button>
							</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
}
