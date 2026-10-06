import type { Link, Person, PersonFields, Tree } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.error ?? `Request failed (${res.status})`);
	}
	return res.status === 204 ? (undefined as T) : res.json();
}

const json = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

export const api = {
	tree: () => request<Tree>("/api/tree"),
	createPerson: (fields: PersonFields) =>
		request<Person>("/api/people", json("POST", fields)),
	updatePerson: (id: string, fields: PersonFields) =>
		request<Person>(`/api/people/${id}`, json("PATCH", fields)),
	deletePerson: (id: string) =>
		request<void>(`/api/people/${id}`, { method: "DELETE" }),
	addLink: (childId: string, parentId: string) =>
		request<Link>("/api/edges", json("POST", { childId, parentId })),
	deleteLink: (id: string) =>
		request<void>(`/api/edges/${id}`, { method: "DELETE" }),
	uploadPhoto: (id: string, blob: Blob) =>
		request<{ photoVersion: number }>(`/api/people/${id}/photo`, {
			method: "PUT",
			headers: { "content-type": blob.type },
			body: blob,
		}),
};

export const photoUrl = (p: Pick<Person, "id" | "photoVersion">) =>
	p.photoVersion > 0 ? `/api/people/${p.id}/photo?v=${p.photoVersion}` : null;

/** Center-crops to a square and downsizes so uploads stay small. */
export async function preparePhoto(file: File, size = 512): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const side = Math.min(bitmap.width, bitmap.height);
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = Math.min(size, side);
	canvas
		.getContext("2d")!
		.drawImage(
			bitmap,
			(bitmap.width - side) / 2,
			(bitmap.height - side) / 2,
			side,
			side,
			0,
			0,
			canvas.width,
			canvas.height,
		);
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error("Could not read image"))),
			"image/jpeg",
			0.85,
		),
	);
}
