import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import schema from "../migrations/0001_init.sql?raw";

async function api(path: string, method = "GET", body?: unknown) {
	const res = await SELF.fetch(`https://example.com${path}`, {
		method,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, json: text ? JSON.parse(text) : null };
}

const person = async (name: string) =>
	(await api("/api/people", "POST", { name })).json as { id: string };

describe("family tree API", () => {
	beforeAll(async () => {
		await env.DB.exec(schema.replace(/\n\s*/g, " "));
	});

	it("creates, updates and lists people", async () => {
		const p = await person("Ada");
		const patched = await api(`/api/people/${p.id}`, "PATCH", {
			bio: "Hello",
			x: 10,
			y: 20,
		});
		expect(patched.json).toMatchObject({ name: "Ada", bio: "Hello", x: 10 });
		const tree = await api("/api/tree");
		expect(tree.json.people.some((x: { id: string }) => x.id === p.id)).toBe(true);
	});

	it("rejects invalid fields", async () => {
		const p = await person("Bad");
		expect((await api(`/api/people/${p.id}`, "PATCH", { x: "no" })).status).toBe(400);
		expect((await api(`/api/people/missing`, "PATCH", { name: "x" })).status).toBe(404);
	});

	it("links parents, caps at two, and blocks cycles", async () => {
		const [child, mom, dad, extra] = await Promise.all(
			["c", "m", "d", "e"].map(person),
		);
		const link = (c: string, p: string) =>
			api("/api/edges", "POST", { childId: c, parentId: p });

		expect((await link(child.id, mom.id)).status).toBe(201);
		expect((await link(child.id, mom.id)).status).toBe(409); // duplicate
		expect((await link(child.id, dad.id)).status).toBe(201);
		expect((await link(child.id, extra.id)).status).toBe(409); // 3rd parent
		expect((await link(mom.id, child.id)).status).toBe(409); // cycle
		expect((await link(mom.id, mom.id)).status).toBe(400); // self
	});

	it("cascades edge deletion when a person is deleted", async () => {
		const [c, p] = await Promise.all(["c", "p"].map(person));
		await api("/api/edges", "POST", { childId: c.id, parentId: p.id });
		expect((await api(`/api/people/${p.id}`, "DELETE")).status).toBe(204);
		const tree = await api("/api/tree");
		expect(
			tree.json.edges.filter((e: { parentId: string }) => e.parentId === p.id),
		).toHaveLength(0);
	});
});
