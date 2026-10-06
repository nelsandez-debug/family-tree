import { addEdge, deleteEdge, updateEdge, ApiError } from "./edges";
import {
	createPerson,
	loadTree,
	loadTrash,
	purgePerson,
	restorePerson,
	trashPerson,
	updatePerson,
} from "./people";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (body && typeof body === "object") {
			return body as Record<string, unknown>;
		}
	} catch {
		// fall through
	}
	throw new ApiError(400, "Invalid JSON body");
}

async function putPhoto(env: Env, id: string, request: Request) {
	const type = request.headers.get("content-type") ?? "";
	if (!type.startsWith("image/")) throw new ApiError(415, "Expected an image");
	const body = await request.arrayBuffer();
	if (body.byteLength === 0 || body.byteLength > MAX_PHOTO_BYTES) {
		throw new ApiError(413, "Photo must be under 2MB");
	}
	const exists = await env.DB.prepare(
		"SELECT 1 FROM people WHERE id = ? AND deleted_at IS NULL",
	)
		.bind(id)
		.first();
	if (!exists) throw new ApiError(404, "Person not found");
	await env.PHOTOS.put(`photos/${id}`, body, {
		httpMetadata: { contentType: type },
	});
	const row = await env.DB.prepare(
		"UPDATE people SET photo_version = photo_version + 1, updated_at = ? WHERE id = ? RETURNING photo_version",
	)
		.bind(Date.now(), id)
		.first<{ photo_version: number }>();
	return Response.json({ photoVersion: row?.photo_version ?? 0 });
}

async function getPhoto(env: Env, id: string) {
	const object = await env.PHOTOS.get(`photos/${id}`);
	if (!object) return new Response("Not found", { status: 404 });
	return new Response(object.body, {
		headers: {
			"content-type": object.httpMetadata?.contentType ?? "image/jpeg",
			// URL carries ?v=<photoVersion>, so it is safe to cache hard
			"cache-control": "public, max-age=31536000, immutable",
		},
	});
}

async function route(request: Request, env: Env): Promise<Response> {
	const { pathname } = new URL(request.url);
	const method = request.method;
	const parts = pathname.split("/").filter(Boolean); // ["api", ...]

	if (method === "GET" && pathname === "/api/tree") {
		return Response.json(await loadTree(env.DB));
	}

	if (method === "GET" && pathname === "/api/trash") {
		return Response.json(await loadTrash(env.DB));
	}

	if (parts[1] === "trash" && parts.length === 3 && method === "DELETE") {
		await purgePerson(env.DB, parts[2]);
		await env.PHOTOS.delete(`photos/${parts[2]}`);
		return new Response(null, { status: 204 });
	}

	if (parts[1] === "people") {
		if (parts.length === 2 && method === "POST") {
			return Response.json(
				await createPerson(env.DB, await readJson(request)),
				{ status: 201 },
			);
		}
		const id = parts[2];
		if (parts.length === 3 && method === "PATCH") {
			return Response.json(
				await updatePerson(env.DB, id, await readJson(request)),
			);
		}
		// Soft delete: the person moves to the Trash and can be restored.
		if (parts.length === 3 && method === "DELETE") {
			await trashPerson(env.DB, id);
			return new Response(null, { status: 204 });
		}
		if (parts[3] === "restore" && method === "POST") {
			return Response.json(await restorePerson(env.DB, id));
		}
		if (parts[3] === "photo" && method === "PUT") {
			return putPhoto(env, id, request);
		}
		if (parts[3] === "photo" && method === "GET") {
			return getPhoto(env, id);
		}
	}

	if (parts[1] === "edges") {
		if (parts.length === 2 && method === "POST") {
			return Response.json(await addEdge(env.DB, await readJson(request)), {
				status: 201,
			});
		}
		if (parts.length === 3 && method === "PATCH") {
			return Response.json(
				await updateEdge(env.DB, parts[2], await readJson(request)),
			);
		}
		if (parts.length === 3 && method === "DELETE") {
			await deleteEdge(env.DB, parts[2]);
			return new Response(null, { status: 204 });
		}
	}

	throw new ApiError(404, "Not found");
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			return await route(request, env);
		} catch (err) {
			if (err instanceof ApiError) {
				return Response.json({ error: err.message }, { status: err.status });
			}
			console.error(err);
			return Response.json({ error: "Internal error" }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
