# Family Tree

An infinite canvas of personal badges. Drag from a parent's bottom dot to a child's top dot to connect them, then click a badge to edit its photo, dates, location and bio. Changes are shared with everyone using the app.

- **Frontend:** React, Vite, Tailwind, [React Flow](https://reactflow.dev)
- **API:** a Cloudflare Worker (`worker/`)
- **Data:** D1 (`people`, `edges`), schema in `migrations/`
- **Photos:** R2, center-cropped and resized in the browser before upload

## Develop

```bash
npm install
npm run db:migrate:local   # create the local D1 schema
npm run dev                # http://localhost:5173
npm test                   # API tests (vitest in the Workers runtime)
```

## Deploy

```bash
npx wrangler d1 create family-tree            # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create family-tree-photos
npm run db:migrate                            # apply schema to the remote D1
npm run deploy
```

**Access control:** the app has no login of its own. Before sharing the URL, protect it with
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) and an
email allowlist for your family.

## Rules enforced by the API

- A person has at most 2 parents, and links cannot form a cycle.
- Deleting a person removes their links and photo.
- Photos must be images under 2MB. Concurrent edits are last-write-wins; the canvas refreshes when you return to the tab.

## Ideas for later

Partner links in the UI (the API already supports `type: "partner"`), rich-text bios, image export, live sync via Durable Objects.
