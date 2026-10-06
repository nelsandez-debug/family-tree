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

## Relationships

- **Parents and children:** drag from a parent's bottom dot to a child's top dot, or use **+ Parent / + Child / + Sibling** in the panel. Each link has a kind (biological, adoptive, step, foster); a person can have at most 2 of each kind, and links cannot form a cycle.
- **Spouses and partners:** drag between the pink side dots, or use **+ Spouse**. Kinds: married, partner, engaged, divorced, separated, widowed, with optional marriage date, place and end date.
- **Link existing:** pick a relationship and a person in the panel to connect two badges that already exist.
- **Everyone else is worked out for you** and shown under *Family* in the panel: siblings, grandparents, grandchildren, aunts and uncles, cousins, nieces and nephews, step-parents, step-children, and in-laws (parents-, siblings- and children-in-law). Nothing extra is stored, so these can't drift out of sync.

## Profiles

Name, middle name, nickname, maiden name (shown as "née …" on the badge), date and place of birth, date and place of death or resting place, occupation, where they live, bio, and a photo. Dates are free text so `1950` and `1950-03-12` both work.

## Keeping work safe

- Backspace/Delete never removes anyone. The panel's **Move to Trash** is the only way, and the **Trash** button restores people with all their links. *Delete forever* exists only inside Trash.
- Edits autosave; the panel shows "Saving…" / "All changes saved". The canvas won't refresh over a save that is still in flight.
- D1 keeps point-in-time history for 30 days, so even a mistaken permanent delete can be rolled back:
  `npx wrangler d1 time-travel info family-tree` then `npx wrangler d1 time-travel restore family-tree --timestamp=<ISO time>`.

## Database migrations

Cloudflare's Git build only runs `wrangler deploy`; it does **not** change the database. When a change adds a file under `migrations/`, apply it **before** deploying the code that needs it:

```bash
npm run db:migrate
```

Migrations here are additive, so the previous version of the app keeps working during the switch.

## Other rules

- Photos must be images under 2MB. Concurrent edits are last-write-wins; the canvas refreshes when you return to the tab.

## Ideas for later

Rich-text bios, image export, live sync via Durable Objects, sharing a read-only view.
