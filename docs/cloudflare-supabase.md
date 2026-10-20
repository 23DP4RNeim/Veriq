# Deploy Veriq to Cloudflare Workers + Supabase

This deployment serves the admin page and its API on the same HTTPS domain. It runs on Cloudflare independently of your computer; PostgreSQL records live in Supabase. Use **Workers**, not a static Pages upload: uploading only `admin.html` cannot run the API.

## 1. Create the Supabase database

1. Create a Supabase project and save its database password.
2. In **SQL Editor → New query**, paste the entire contents of [`supabase/setup.sql`](../supabase/setup.sql) and run it once.
3. Use a fresh project with no Veriq tables. The SQL runs in one transaction and fails safely if application tables already exist. It includes all 10 application tables, enums, foreign keys, indexes, RLS, and the Prisma migration ledger. Do not use this initial setup file for upgrades.
4. In **Connect → Transaction pooler**, copy the PostgreSQL URI (port **6543**). Use the `postgres.PROJECT_REF` username and actual hostname shown in your dashboard. URL-encode special characters in your password. Append `?sslmode=verify-full` to verify TLS certificates. A Supabase anon/publishable/service-role API key is **not** a database password or a `DATABASE_URL`.

Example only:

```text
postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=verify-full
```

The backend connects through Prisma's PostgreSQL driver adapter. Browser clients have no table permissions or RLS policies, and no database credentials appear in `admin.html`. The backend uses the PostgreSQL account, which bypasses RLS; keep that credential in secrets only.

## 2. Deploy the Worker

Use Node.js 22+ (Node.js 24 recommended):

```sh
npm ci
npx wrangler login
npx wrangler secret put DATABASE_URL
npx wrangler secret put ADMIN_TOKEN
npm run cf:check
npm run cf:deploy
```

Paste the Supabase pooler URI when asked for `DATABASE_URL`. Generate a random admin token with `openssl rand -hex 32`, save it in your password manager, and paste it when asked for `ADMIN_TOKEN`. The secret commands can create the Worker before its first deployment. Do not commit secrets or add them to `wrangler.jsonc`.

The deployment prints a URL like `https://veriq.YOUR_SUBDOMAIN.workers.dev`. Open `/admin` or `/admin.html` and enter the admin token. `/` opens the same console. All admin and v1 data endpoints require the same bearer token online; health endpoints are public, and Telegram authenticates with its own webhook secret. Responses containing data are not cached.

Check `/health`: it should return `status: "ok"` and `database: "ok"`. The console should report database mode. Production returns 503 during database failures rather than storing temporary in-memory records.

For automatic deployments from GitHub, create a **Workers** project connected to this repository. Use build command `npm run db:generate && npm run typecheck` and deploy command `npm run cf:deploy`; set the two secrets on that Worker first. `wrangler.jsonc` is the deployment configuration. You can add a custom domain under the Worker's **Settings → Domains & Routes**.

## 3. Populate real company data online

The default cloud provider is `ur_open_data`. The SQL creates empty tables; it does not copy your local records or invent real company data. Until the import completes, company searches return no matches.

To import and refresh data without leaving your computer running, push this repository to GitHub, then configure the included **Sync Latvian company data to Supabase** workflow:

1. Add repository Actions secret `SUPABASE_DATABASE_URL` containing your Supabase **session pooler** connection URI (port **5432**, with `?sslmode=verify-full`). The importer is a Node process, so session mode is appropriate.
2. Add repository Actions variable `ENABLE_UR_SYNC` with value `true`.
3. Run the workflow once through **Actions → Sync Latvian company data to Supabase → Run workflow**. It then runs daily at 04:20 UTC (06:20 in Riga in winter, 07:20 in summer). GitHub schedules can be delayed and are subject to Actions limits.

The import downloads the UR datasets and writes directly to Supabase. Allow enough Supabase storage and Actions runtime for the full registry; monitor the first run. If importing fails, inspect its Actions logs. Changing the provider to `mock` in `wrangler.jsonc` enables fictional test fixtures instead; do not present those as real businesses.

If you need existing local users, reports, or history, transfer those separately after running the SQL and before starting imports. Back up the local database, export only application data with `pg_dump --data-only --schema=public --exclude-table=public._prisma_migrations`, and restore that export into Supabase using `psql` with the session pooler connection. The setup SQL itself contains no existing local data. Do not import Supabase `auth` or `storage` schemas or overwrite the migration ledger.

## 4. Optional Telegram webhook

Cloudflare uses webhook mode; it does not run the local polling process.

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Use a random Telegram webhook secret containing only letters, digits, underscores, and hyphens. Register `https://YOUR_WORKER_DOMAIN/api/v1/telegram/webhook` with Telegram's `setWebhook` API, supplying the same `secret_token`. Stop any local polling process for that bot. Register the webhook from your own secure terminal; do not paste the bot token into browser URLs, source control, or logs. `TELEGRAM_WEBHOOK_URL` is only used by the standalone Node webhook launcher; the Worker receives the URL registered with Telegram.

## Local preview and later updates

```sh
cp .dev.vars.example .dev.vars
# Fill in the real database URI and your admin token in .dev.vars.
npm run cf:dev
```

Preview at `http://localhost:8787/admin`. The preview uses the database you configure, so use a separate Supabase development project when needed. `.dev.vars` is ignored by Git. `.env` remains the configuration for standalone Node commands, seeds, and imports.

For later releases, apply new committed Prisma migrations using `npm run db:migrate:deploy` with `DATABASE_URL` set to the session pooler URI, then run `npm run cf:deploy`. The initial SQL has already recorded the three existing migrations, so they will not be replayed. Do not run `db:migrate` against production. The Node server still serves Swagger UI at `/docs`; the Worker serves the API and admin console without Swagger UI. Same-origin access needs no CORS configuration.

Cloudflare Workers run on demand and remain accessible when your computer is off. Availability still depends on the providers and your plans: [free Supabase projects may pause after inactivity](https://supabase.com/docs/guides/platform/free-project-pausing), and free Cloudflare requests/CPU and Supabase storage/connection quotas apply. Choose plans that support your uptime needs; this setup does not guarantee uninterrupted service. Check Cloudflare Worker logs and Supabase database metrics after deployment.

References: [Prisma on Workers](https://www.prisma.io/docs/orm/v6/prisma-client/deployment/edge/deploy-to-cloudflare), [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/binding/).
