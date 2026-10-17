# OpenInc

An open-source company tool you host yourself: shareholder registry, cap table, document signing, dataroom and fundraising (investor CRM and tracked links). It ships as **one Docker image**; all it needs is a Postgres database and an S3-compatible bucket.

> **Status:** the foundation is in place: install and setup wizard, accounts with two-factor, roles, audit log, Admin settings, files, notifications, background jobs, the AI assistant and the MCP server. The company modules (Shareholders, Cap table, Signing, Dataroom, Fundraising) are placeholders in the navigation and are specified and built next.

## Install

You need:

- an **empty Postgres database** (14 or newer), and
- an **S3-compatible bucket** (AWS S3, Cloudflare R2, MinIO, RustFS, Backblaze B2, …) with an access key that can read and write it.

Then run the image `ghcr.io/nielsbosma/openinc:latest` with these environment variables:

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgres://user:password@host:5432/openinc`. The user must own the database (it creates its tables). |
| `S3_BUCKET` | yes | Bucket name. Files and database backups go here. |
| `S3_ACCESS_KEY` | yes | Access key for the bucket. |
| `S3_SECRET_KEY` | yes | Its secret. |
| `S3_ENDPOINT` | for non-AWS | e.g. `https://<account>.r2.cloudflarestorage.com`. Leave empty for AWS. |
| `S3_REGION` | no | Defaults to `us-east-1` (use `auto` for R2). |
| `APP_SECRET` | yes | Encrypts stored credentials (SMTP password, AI key). Generate it once and never change it. |
| `APP_URL` | no | Public address, e.g. `https://openinc.example.com`. Worked out from requests when empty; set it when you are behind a proxy. |

Generate `APP_SECRET`:

```sh
openssl rand -base64 48
# or, without openssl:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Everything else (company details, email, AI provider, error tracking, security rules) is set in the browser.

### On Sliplane

1. Create a **Postgres** service. Copy its connection string.
2. Create a bucket (Sliplane, Cloudflare R2, AWS, …) and an access key for it.
3. Create a service from the image `ghcr.io/nielsbosma/openinc:latest`, port `3000`, and paste the variables above.
4. Deploy and open the service URL.

### Anywhere else

```sh
docker run -d --name openinc -p 3000:3000 \
  -e DATABASE_URL=postgres://openinc:secret@db:5432/openinc \
  -e S3_ENDPOINT=https://s3.example.com -e S3_BUCKET=openinc \
  -e S3_ACCESS_KEY=... -e S3_SECRET_KEY=... \
  -e APP_SECRET="$(openssl rand -base64 48)" \
  ghcr.io/nielsbosma/openinc:latest
```

Images are multi-arch (amd64 and arm64). Tags: `:latest` and `:1.2.3` / `:1.2` for releases, `:edge` for the main branch.

### First run

Open the app. It checks the database and the bucket; if something is wrong it shows what and how to fix it, and keeps retrying. On an empty database a **setup wizard** starts:

1. **Setup code.** The container log prints a one-time code, so nobody else can claim a fresh install on the internet (`docker logs openinc`, or Logs on Sliplane).
2. **Database.** One click installs it, with progress.
3. **Admin account**, with an offer to turn on two-factor authentication.
4. **Company:** name, registration number, country, currency, time zone, logo.
5. **Email:** SMTP details and a test email, or skip.
6. **Optional:** AI provider and error tracking.

The wizard locks for good once the first admin exists. The dashboard then shows a checklist of what is left.

## Upgrading

Deploy a newer image tag (or let your host pull `:latest`). On start, OpenInc:

1. takes a `pg_dump` backup into the bucket under `backups/` (the newest five are kept),
2. applies every pending migration in order, each in its own transaction, under a Postgres advisory lock so only one container migrates,
3. starts serving. Skipping versions is fine: 1.0 → 1.5 runs every migration in between.

If a migration fails it is rolled back, the app shows a maintenance page with the error, and the previous image still runs against the untouched database. An image older than the database refuses to start and says which version it needs. **Admin settings → System** shows the running version, whether a newer release exists, applied migrations and backups.

Restore a backup with `pg_restore --clean --if-exists -d "$DATABASE_URL" openinc-<date>.dump`.

### Scaling and options

- The default runs the web app and the job worker in one process. Set `ROLE=web` on one service and `ROLE=worker` on another to scale them separately.
- Any Admin setting can be pinned by an environment variable, e.g. `OPENINC_EMAIL_HOST`, `OPENINC_EMAIL_PASSWORD`, `OPENINC_AI_API_KEY`, `OPENINC_SECURITY_ENFORCE_TWO_FACTOR=true` (pattern: `OPENINC_<GROUP>_<FIELD>`). Pinned fields show as locked in the UI.
- `/api/health` answers whenever the process is up (use it for liveness); `/api/ready` answers 200 once the database is installed and current.

## Connecting Claude and other MCP clients

Everything you can do in the app is also available over MCP, with your permissions, and audited. In Claude, add a custom connector with the URL from **Account → MCP** (`https://<your-install>/mcp`), sign in and click Allow. It uses OAuth 2.1 with dynamic client registration, over Streamable HTTP. Connected clients are listed, and can be disconnected, on the same page.

## Architecture

```
            ┌────────── one container ───────────────────────────────┐
 browser ──▶│ React SPA ─ tRPC ┐                                      │
 Claude  ──▶│ MCP (OAuth 2.1) ─┼─▶ service layer ─▶ Postgres (Drizzle) │──▶ Postgres
 assistant─▶│ AI chat ─────────┤   (permissions,    pg-boss jobs       │
            │ worker (pg-boss)─┘    audit, settings) S3 files, backups  │──▶ S3 bucket
            └────────────────────────────────────────────────────────┘──▶ SMTP / LLM / Sentry (optional)
```

All logic lives in one service layer of plain functions (`packages/core/src/services`). The web UI (tRPC), the MCP server, the AI assistant and the worker are thin wrappers, so permissions and the audit log are enforced once and the surfaces cannot drift apart.

| Path | What |
| --- | --- |
| `apps/server` | Express: tRPC, file uploads, `/api/chat`, MCP and OAuth, startup and the worker |
| `apps/web` | React, shadcn/ui, Tailwind, TanStack Query; Storybook and Playwright |
| `packages/core` | Services, settings, auth, jobs, email, storage, AI, startup lifecycle |
| `packages/db` | Drizzle schema, generated SQL migrations, the migrator |
| `packages/shared` | Zod schemas, roles and permissions, formatting; used by browser and server |

Stack: TypeScript, pnpm + Turborepo, React 19, shadcn/ui, Tailwind 4, tRPC 11, Zod 4, Drizzle, Postgres, pg-boss, Vercel AI SDK, Nodemailer, Sentry SDK (works with Bugsink), Vitest, Playwright, Storybook, Biome.

## Development

Requirements: Node 22.12+, pnpm 10 (`corepack enable`), Docker.

```sh
pnpm install
pnpm infra:up             # Postgres :5470, S3 (RustFS) :9300, Mailpit :8025
cp .env.example .env
pnpm db:reset             # wipe, install and seed; or `pnpm db:reset -- --empty` to try the wizard
pnpm dev                  # http://localhost:5173 with hot reload (API on :3000)
```

| URL | What |
| --- | --- |
| http://localhost:5173 | The app (`pnpm dev`) |
| http://localhost:8025 | Mailpit: every email the app sends (SMTP on `localhost:1025`) |
| http://localhost:6006 | Storybook (`pnpm storybook`) |
| http://localhost:9300 | S3 (RustFS), user `openinc` / `openinc-secret` |
| http://localhost:8080 | The production image (`docker compose --profile prod up -d --build`) |

The dev server applies new migrations itself when it restarts, as production does; after `pnpm db:generate` it restarts on its own.

Seeded accounts: `admin@openinc.local` / `openinc-admin-1` (Admin), `maria@openinc.local` / `openinc-member-1` (Member), `board@openinc.local` / `openinc-reader-1` (Read-only). All email lands in Mailpit at http://localhost:8025. To try the assistant, put `SEED_AI_PROVIDER`, `SEED_AI_MODEL` and `SEED_AI_API_KEY` in `.env.local` and run `pnpm db:reset` again.

| Command | |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Checks; tests use the local Postgres and S3 and skip DB tests if they are down |
| `pnpm test:e2e` | Playwright: the full wizard, invites, MCP OAuth. Needs `pnpm dev` on an empty database |
| `pnpm storybook` | Every UI component, light and dark, at http://localhost:6006 |
| `pnpm db:generate` | Write a migration after changing `packages/db/src/schema` (no database needed) |
| `pnpm --filter @openinc/web screenshots` | Screenshots of the main screens for reviewing UI changes |
| `docker compose --profile prod up -d --build` | The production image at http://localhost:8080, the way Sliplane runs it |

See [CLAUDE.md](CLAUDE.md) for conventions and [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## Releasing

Releases are GitHub Releases; GitHub Actions builds and publishes the image.

1. Bump `version` in the root `package.json` (e.g. `0.2.0`), move the **Unreleased** notes in `CHANGELOG.md` under that version, and merge to `main`.
2. On GitHub, **Releases → Draft a new release**, create the tag `v0.2.0` on `main`, name the release `v0.2.0`, paste the changelog section and click **Publish release**.
3. The workflow builds `linux/amd64` and `linux/arm64`, runs the end-to-end and upgrade tests, and pushes `ghcr.io/nielsbosma/openinc:0.2.0`, `:0.2` and `:latest`. The image reports exactly `0.2.0` (sidebar and Admin Settings → System); installs that check for updates see it as soon as the release is published.

Every merge to `main` publishes `:edge` (version `0.2.0-<commit>`). Local builds without the build arg show `<version>-dev`.

### One-time GitHub settings

- **Make the image public** after the first publish: GitHub → your profile → **Packages → openinc → Package settings → Change visibility → Public**. Until then `docker pull` and Sliplane need a registry login. In the same page, under **Manage Actions access**, make sure the `OpenInc` repository has **Write** access (it does when the workflow created the package).
- **Actions permissions**: Settings → Actions → General. Keep **Allow all actions** (the workflow uses `actions/*`, `docker/*` and `pnpm/action-setup`). The default **Workflow permissions: read** is fine: the workflow asks for `packages: write` itself and publishes with `GITHUB_TOKEN`, so no personal access token or secret is needed.
- Optional: protect `main` and `v*` tags (Settings → Rules) so releases only come from reviewed code.

## License

[MIT](LICENSE)
