# Deploy Veriq to Cloudflare Workers + Supabase

This deployment serves the admin page and its API on the same HTTPS domain. It runs on Cloudflare independently of your computer; PostgreSQL records live in Supabase. Use **Workers**, not a static Pages upload: uploading only `admin.html` cannot run the API.

## Verified live deployment

Admin console: [https://veriq.a230323mo.workers.dev/admin](https://veriq.a230323mo.workers.dev/admin)

Health: [https://veriq.a230323mo.workers.dev/health](https://veriq.a230323mo.workers.dev/health)

This is the address returned by Wrangler for the authenticated Cloudflare account. Health, admin authentication, company reads, and the dashboard were verified against Supabase after deployment. Use `ADMIN_TOKEN` from your ignored `.env` or `.dev.vars` file to sign in. The previously supplied `veriq.a230863rn.workers.dev` is a different Workers subdomain; this login/deployment did not update that address.

## Fix the live "Service is unavailable" error

Local `.env` and `.dev.vars` files do not automatically become Cloudflare Worker secrets. A deployed Worker needs `ADMIN_TOKEN`, a database connection, and the bindings in `wrangler.jsonc`. Supabase also needs the Hyperdrive configuration described below.

In this repository's terminal, run:

```sh
npx wrangler login
npm run cf:setup
npm run cf:deploy
```

`cf:setup` reads the existing ignored environment files, uploads the Supabase CA certificate, creates Hyperdrive using the session pooler with verified TLS and query caching disabled, adds the `HYPERDRIVE` binding to `wrangler.jsonc`, and uploads the Worker secrets. It uses an existing HYPERDRIVE binding if already configured. If you belong to multiple Cloudflare accounts, set `CLOUDFLARE_ACCOUNT_ID` to the account containing your Worker before setup. Review/commit the updated `wrangler.jsonc` after setup so future Git deployments keep that binding. Your passwords and admin token stay out of Git.

After deploying, open `https://veriq.a230323mo.workers.dev/health`. It should report `status: "ok"` and `database: "ok"`. Open `/admin` and sign in using `ADMIN_TOKEN` from the local ignored environment file. If you previously used a different admin token online, use the token that setup uploaded.

New deployments identify missing secrets/bindings with specific errors instead of the generic message. `DEPLOYMENT_NOT_CONFIGURED` lists missing settings; `HYPERDRIVE_REQUIRED` means the Supabase binding has not been configured. These messages never include secret values. Authentication must be completed in the same environment that runs setup.

## Your Supabase project

Project URL: `https://flmiawgapelpymjoxbcf.supabase.co`

Project dashboard: [Open your Supabase project](https://supabase.com/dashboard/project/flmiawgapelpymjoxbcf)

The supplied anon API key is for Supabase's browser/Data API. This app connects through Prisma and requires the PostgreSQL connection URI instead. The API key is not used or stored by the app. The transaction pooler hostname is confirmed as `aws-0-eu-west-1.pooler.supabase.com`. The database connection has been configured in ignored local `.env` and `.dev.vars` files and verified against Supabase. The live Node/Prisma connection works. Cloudflare requires the Hyperdrive setup below because its raw PostgreSQL socket adapter does not use the custom CA certificate.

Open the project dashboard, click **Connect → Transaction pooler**, and copy the URI. The pooled username for this project is `postgres.flmiawgapelpymjoxbcf`. Use the exact hostname shown in that panel. Enter the completed URI privately with `npx wrangler secret put DATABASE_URL` for the deployed Worker, or in an ignored `.dev.vars` file for local preview. `.dev.vars.example` contains your project reference and confirmed pooler hostname. Replace `ENCODED_PASSWORD` with your URL-encoded database password. Use your actual database password only in ignored environment files or Cloudflare secrets.

## 1. Create the Supabase database

1. Create a Supabase project and save its database password.
2. In **SQL Editor → New query**, paste the entire contents of [`supabase/setup.sql`](../supabase/setup.sql) and run it once.
3. Use a fresh project with no Veriq tables. The SQL runs in one transaction and fails safely if application tables already exist. It includes all 10 application tables, enums, foreign keys, indexes, RLS, and the Prisma migration ledger. Do not use this initial setup file for upgrades.
4. In **Connect → Transaction pooler**, copy the PostgreSQL URI (port **6543**). Use the `postgres.PROJECT_REF` username and actual hostname shown in your dashboard. URL-encode special characters in your password. Append `?sslmode=verify-full` to verify TLS certificates. A Supabase anon/publishable/service-role API key is **not** a database password or a `DATABASE_URL`.

Your project connection template (replace `ENCODED_PASSWORD`):

```text
postgresql://postgres.flmiawgapelpymjoxbcf:ENCODED_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full
```

The backend connects through Prisma's PostgreSQL driver adapter. For Supabase shared pooler hosts, the adapter includes Supabase's public CA certificate and explicitly verifies TLS certificates and hostnames; Node's default trust store alone does not trust this pooler's CA. Keep the bundled public certificate current when Supabase rotates it. [Supabase TLS documentation](https://supabase.com/docs/guides/platform/ssl-enforcement). Browser clients have no table permissions or RLS policies, and no database credentials appear in `admin.html`. The backend uses the PostgreSQL account, which bypasses RLS; keep that credential in secrets only.

## 2. Configure Hyperdrive for the Supabase pooler

Live testing confirmed that Node/Prisma connects with the bundled Supabase CA. The Workers raw PostgreSQL socket adapter failed with `UnknownIssuer` even when that CA was supplied. Use Hyperdrive with an uploaded CA for the deployed Worker; adding only `DATABASE_URL` is insufficient for this pooler.

1. Authenticate with `npx wrangler login`.
2. Download [Supabase's public CA certificate](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
3. In the Cloudflare dashboard, create a Hyperdrive configuration for a PostgreSQL database using the Supabase **session pooler**: host `aws-0-eu-west-1.pooler.supabase.com`, port `5432`, database `postgres`, username `postgres.flmiawgapelpymjoxbcf`, and your database password. Use the session pooler rather than stacking transaction poolers.
4. Configure TLS as **Verify full**, uploading the Supabase CA certificate. Disable Hyperdrive query caching so the admin console reads current records.
5. Copy the configuration ID and add this top-level property to `wrangler.jsonc` (replace the placeholder):

```json
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "YOUR_HYPERDRIVE_ID" }]
```

The Worker prefers `HYPERDRIVE.connectionString` over `DATABASE_URL`. Hyperdrive handles TLS to Supabase. See [Cloudflare's CA certificate configuration](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/) for dashboard and CLI instructions. This workspace now has a provisioned `HYPERDRIVE` binding in `wrangler.jsonc`. Other accounts/environments need their own login and setup.

## 3. Deploy the Worker

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

## 4. Populate real company data online

The default cloud provider is `ur_open_data`. The SQL creates empty tables; it does not copy your local records or invent real company data. Registration-number lookups missing from Supabase now fetch and save basic records from the official UR public DataStore. Company-name searches use the existing mirror; run the bulk import for broad name-search coverage, historical names, financials, and the other available enrichment.

To import and refresh data without leaving your computer running, push this repository to GitHub, then configure the included **Sync Latvian company data to Supabase** workflow:

1. Add repository Actions secret `SUPABASE_DATABASE_URL` containing your Supabase **session pooler** connection URI (port **5432**, with `?sslmode=verify-full`). The importer is a Node process, so session mode is appropriate.
2. Add repository Actions variable `ENABLE_UR_SYNC` with value `true`.
3. Run the workflow once through **Actions → Sync Latvian company data to Supabase → Run workflow**. It then runs daily at 04:20 UTC (06:20 in Riga in winter, 07:20 in summer). GitHub schedules can be delayed and are subject to Actions limits.

The import downloads the UR datasets and writes directly to Supabase. Allow enough Supabase storage and Actions runtime for the full registry; monitor the first run. If importing fails, inspect its Actions logs. Changing the provider to `mock` in `wrangler.jsonc` enables fictional test fixtures instead; do not present those as real businesses.

If you need existing local users, reports, or history, transfer those separately after running the SQL and before starting imports. Back up the local database, export only application data with `pg_dump --data-only --schema=public --exclude-table=public._prisma_migrations`, and restore that export into Supabase using `psql` with the session pooler connection. The setup SQL itself contains no existing local data. Do not import Supabase `auth` or `storage` schemas or overwrite the migration ledger.

## 5. Telegram webhook

Configured bot: [@Veriq_bot_bot](https://t.me/Veriq_bot_bot). Its webhook is registered at `https://veriq.a230323mo.workers.dev/api/v1/telegram/webhook`. Open the bot in Telegram and send `/start`. Credentials are stored in ignored local environment files and Cloudflare Worker secrets.

For a new environment or token change:

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
npm run dev
```

For this Supabase pooler, `npm run dev` is the verified local Node preview at `http://localhost:3000/admin` (it reads `.env`). The raw Workers preview cannot validate the pooler CA; use a configured Hyperdrive binding with remote preview to test the cloud database path.

```sh
npm run cf:dev
```

The Workers preview listens at `http://localhost:8787/admin`; its database path requires the Hyperdrive configuration above. The preview uses the database you configure, so use a separate Supabase development project when needed. `.dev.vars` is ignored by Git. `.env` remains the configuration for standalone Node commands, seeds, and imports.

For later releases, apply new committed Prisma migrations using `npm run db:migrate:deploy` with `DATABASE_URL` set to the session pooler URI, then run `npm run cf:deploy`. The initial SQL has already recorded the three existing migrations, so they will not be replayed. Do not run `db:migrate` against production. The Node server still serves Swagger UI at `/docs`; the Worker serves the API and admin console without Swagger UI. Same-origin access needs no CORS configuration.

Cloudflare Workers run on demand and remain accessible when your computer is off. Availability still depends on the providers and your plans: [free Supabase projects may pause after inactivity](https://supabase.com/docs/guides/platform/free-project-pausing), and free Cloudflare requests/CPU and Supabase storage/connection quotas apply. Choose plans that support your uptime needs; this setup does not guarantee uninterrupted service. Check Cloudflare Worker logs and Supabase database metrics after deployment.

References: [Prisma on Workers](https://www.prisma.io/docs/orm/v6/prisma-client/deployment/edge/deploy-to-cloudflare), [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Cloudflare static assets](https://developers.cloudflare.com/workers/static-assets/binding/).
