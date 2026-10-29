# Working on OpenInc

Instructions for coding agents and people. Read the README first.

## Golden rules

- **All logic lives in a service** in `packages/core/src/services`. tRPC, MCP, the assistant and the worker never touch the database themselves. A new capability is:
  1. a Zod input schema in `packages/shared/src/schemas`,
  2. a `defineService({ name, description, kind, access, input, handler })` in core,
  3. an entry in `packages/core/src/registry.ts`,
  4. a `query(...)` or `mutation(...)` line in `apps/server/src/web/router.ts` (`router.test.ts` fails if one is missing).
  MCP and the assistant pick it up automatically.
- **Every service declares `access`**: a permission from `packages/shared/src/permissions.ts`, `'authenticated'` or `'public'`. Add new permissions there and to the roles that need them. The UI only hides things (`useCan`); the service decides.
- **Every mutation calls `audit(ctx, { action, entityType, entityId, before, after })`.** Actions are `<area>.<verb_snake>`. Secrets are masked by key name.
- **Descriptions are written for a model**: they become MCP and assistant tool descriptions. Say what it does and when to use it.
- Mutations run in a transaction. Use `transaction: false` only when a failure must still persist writes (failed-login counters) or the service manages its own (settings).
- `tool: false` for anything with credentials or the caller's own session. Public services are never tools.

## Settings and configuration

- Environment variables are only `DATABASE_URL`, `S3_*`, `APP_SECRET`, `APP_URL`, `PORT`, `ROLE`. Do not add more: runtime configuration belongs in Admin settings.
- A new setting: add the field to its group schema in `packages/shared/src/schemas/settings.ts` (mark secrets in `SETTINGS`), read it with `getSettings(group)` in core, and add it to the form in `apps/web/src/pages/admin/settings`. It is stored in Postgres, encrypted if secret, cached, refreshed in every process on change, audited, and can be pinned with `OPENINC_<GROUP>_<FIELD>`.

## Data

- Change the schema in `packages/db/src/schema`, then `pnpm db:generate --name <what>`. It needs no database. Commit the SQL. Never edit a released migration. CI fails if the schema and migrations disagree.
- Slow backfills are data migrations (`packages/core/src/system/data-migrations.ts`), run by the worker, not SQL migrations.
- Money is integer minor units in `bigint` (`minorUnits()`), share counts `bigint` (`shareCount()`), prices and percentages `numeric` (`pricePerShare()`, `percentage()`). Timestamps are `timestamptz`, shown in the company time zone (`useFormat()`). Calendar dates are `date`, kept as `YYYY-MM-DD` strings.
- Columns are camelCase in TypeScript and snake_case in SQL. Import drizzle operators (`eq`, `and`, `sql`) from `@openinc/db`, never `drizzle-orm`, so there is one copy.

## UI

- Components are shadcn/ui in `apps/web/src/components/ui` (add more with `pnpm dlx shadcn@latest add <name>` from `apps/web`). Every component has a story in a `*.stories.tsx`.
- Data: `const trpc = useTRPC(); useQuery(trpc.x.y.queryOptions(input))`, `useMutation(trpc.x.y.mutationOptions())`. Mutation errors toast automatically; pass `meta: { silent: true }` to handle them yourself. Validate forms with the shared Zod schema via `validate()`.
- A new page: a file in `apps/web/src/pages`, a route in `App.tsx`, a nav item in `components/layout/nav.ts`, and an entry in `packages/core/src/ai/ui-guide.ts` (the assistant explains the app from it; `ui-guide.test.ts` checks routes and nav items). Update the guide whenever a label, button or flow changes.
- **Labels use AP-style Title Case**: headings, nav items, card and dialog titles, buttons, tabs, field labels, table headers, badges, menu and command palette entries, wizard steps, email buttons. Capitalize words of four or more letters ("People With Access", "Sign In", "Set Up Two-Factor"); lowercase a, an, the, and, but, or, for, of, in, on, to, at, by unless first or last ("Keep the Audit Log for (Days)"). Descriptions, helper text, placeholders, toasts and full sentences stay in sentence case. `apTitleCase()` in `@openinc/shared` does it; `labels.test.ts` checks the labels that live in data (nav, settings sections, checklist, UI guide).
- Look: neutral greys, one indigo accent, Hanken Grotesk, Source Code Pro for numbers and ids (`font-mono`), subtle borders, no heavy shadows, light and dark. English only. Use the Combobox for long lists and Select for short ones, never a native `<select>`.
- To check a UI change visually: `pnpm --filter @openinc/web screenshots <dir>` with `pnpm dev` running and a seeded database.

## Checks before you finish

```sh
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e      # with pnpm infra:up, an empty database (pnpm db:reset -- --empty) and pnpm dev
```

## Style

- Comments only where they say why, never what. Keep them rare.
- Follow the nearest existing example; consistency beats cleverness.
- Never commit secrets. `.env` and `.env.local` are gitignored.
