import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import init from "../migrations/0001_init.sql?raw";
import profiles from "../migrations/0002_profiles_relationships_trash.sql?raw";

async function api(path: string, method = "GET", body?: unknown) {
	const res = await SELF.fetch(`https://example.com${path}`, {
		method,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, json: text ? JSON.parse(text) : null };
}

const person = async (name: string, extra: object = {}) =>
	(await api("/api/people", "POST", { name, ...extra })).json as { id: string };

const link = (childId: string, parentId: string, extra: object = {}) =>
	api("/api/edges", "POST", { childId, parentId, ...extra });

const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe("family tree API", () => {
	beforeAll(async () => {
		for (const sql of [init, profiles]) {
			const statements = sql
				.split("\n")
				.filter((l) => !l.trim().startsWith("--"))
				.join("\n")
				.split(";")
				.map((s) => s.trim())
				.filter(Boolean);
			for (const s of statements) await env.DB.prepare(s).run();
		}
	});

	it("creates, updates and lists people with the full profile", async () => {
		const p = await person("Ada");
		const patched = await api(`/api/people/${p.id}`, "PATCH", {
			bio: "Hello",
			maidenName: "Byron",
			middleName: "Augusta",
			nickname: "Countess",
			birth: "1815-12-10",
			birthPlace: "London",
			occupation: "Mathematician",
			x: 10,
			y: 20,
		});
		expect(patched.json).toMatchObject({
			name: "Ada",
			bio: "Hello",
			maidenName: "Byron",
			middleName: "Augusta",
			nickname: "Countess",
			birth: "1815-12-10",
			birthPlace: "London",
			occupation: "Mathematician",
			x: 10,
		});
		// fields can be cleared back to null
		const cleared = await api(`/api/people/${p.id}`, "PATCH", { maidenName: null });
		expect(cleared.json.maidenName).toBeNull();
		const tree = await api("/api/tree");
		expect(ids(tree.json.people)).toContain(p.id);
	});

	it("rejects invalid fields", async () => {
		const p = await person("Bad");
		expect((await api(`/api/people/${p.id}`, "PATCH", { x: "no" })).status).toBe(400);
		expect((await api(`/api/people/${p.id}`, "PATCH", { name: null })).status).toBe(400);
		expect((await api(`/api/people/missing`, "PATCH", { name: "x" })).status).toBe(404);
	});

	it("links parents, caps each kind at two, and blocks cycles", async () => {
		const [child, mom, dad, extra, stepdad] = await Promise.all(
			["c", "m", "d", "e", "s"].map((n) => person(n)),
		);
		expect((await link(child.id, mom.id)).status).toBe(201);
		expect((await link(child.id, mom.id)).status).toBe(409); // duplicate
		expect((await link(child.id, dad.id)).status).toBe(201);
		expect((await link(child.id, extra.id)).status).toBe(409); // 3rd biological
		// other kinds have their own cap
		const step = await link(child.id, stepdad.id, { subtype: "step" });
		expect(step.status).toBe(201);
		expect(step.json.subtype).toBe("step");
		expect((await link(mom.id, child.id)).status).toBe(409); // cycle
		expect((await link(mom.id, mom.id)).status).toBe(400); // self
		expect((await link(child.id, extra.id, { subtype: "bogus" })).status).toBe(400);
	});

	it("links spouses in either direction only once, with marriage details", async () => {
		const [a, b] = await Promise.all(["a", "b"].map((n) => person(n)));
		const first = await api("/api/edges", "POST", {
			type: "partner",
			childId: a.id,
			parentId: b.id,
			startDate: "1975-06-01",
			startPlace: "Boston",
		});
		expect(first.status).toBe(201);
		expect(first.json).toMatchObject({ subtype: "married", startDate: "1975-06-01" });
		const reverse = await api("/api/edges", "POST", {
			type: "partner",
			childId: b.id,
			parentId: a.id,
		});
		expect(reverse.status).toBe(409);

		const updated = await api(`/api/edges/${first.json.id}`, "PATCH", {
			subtype: "divorced",
			endDate: "1990",
		});
		expect(updated.json).toMatchObject({ subtype: "divorced", endDate: "1990" });
		expect(
			(await api(`/api/edges/${first.json.id}`, "PATCH", { subtype: "adoptive" })).status,
		).toBe(400); // parent subtype on a partner link
	});

	it("moves deleted people to the Trash and restores them with their links", async () => {
		const [c, p] = await Promise.all(["c", "p"].map((n) => person(n)));
		await link(c.id, p.id);

		expect((await api(`/api/people/${p.id}`, "DELETE")).status).toBe(204);
		const tree = await api("/api/tree");
		expect(ids(tree.json.people)).not.toContain(p.id);
		expect(tree.json.edges.filter((e: { parentId: string }) => e.parentId === p.id)).toHaveLength(0);
		expect(ids((await api("/api/trash")).json)).toContain(p.id);
		// a trashed person can't be edited or linked
		expect((await api(`/api/people/${p.id}`, "PATCH", { name: "x" })).status).toBe(404);
		expect((await link(c.id, p.id, { subtype: "adoptive" })).status).toBe(404);

		const restored = await api(`/api/people/${p.id}/restore`, "POST");
		expect(restored.json.id).toBe(p.id);
		const after = await api("/api/tree");
		expect(ids(after.json.people)).toContain(p.id);
		// the original link came back with them
		expect(
			after.json.edges.some(
				(e: { childId: string; parentId: string }) => e.childId === c.id && e.parentId === p.id,
			),
		).toBe(true);
	});

	it("only purges people who are already in the Trash", async () => {
		const [c, p] = await Promise.all(["c", "p"].map((n) => person(n)));
		await link(c.id, p.id);
		expect((await api(`/api/trash/${p.id}`, "DELETE")).status).toBe(404); // not trashed
		await api(`/api/people/${p.id}`, "DELETE");
		expect((await api(`/api/trash/${p.id}`, "DELETE")).status).toBe(204);
		expect(ids((await api("/api/trash")).json)).not.toContain(p.id);
		const edge = await env.DB.prepare("SELECT COUNT(*) AS n FROM edges WHERE parent_id = ?")
			.bind(p.id)
			.first<{ n: number }>();
		expect(edge?.n).toBe(0);
	});
});
