# Veriq

**Business Verification & Intelligence**

Veriq is a modular TypeScript app for Latvian company lookup and transparent business verification. It can use fictional fixtures or daily open datasets published by the Latvian Register of Enterprises (UR). Results are decision support, not a legally authoritative determination, credit rating, sanctions clearance, or cybersecurity scan.

## Cloud hosting (Cloudflare + Supabase)

Follow [the deployment guide](docs/cloudflare-supabase.md) to publish the admin console and API on one Cloudflare Worker. Run [supabase/setup.sql](supabase/setup.sql) once in a fresh Supabase project for the complete database setup, then configure the Worker secrets and deploy with `npm run cf:deploy`. An optional GitHub Actions workflow refreshes company data directly in Supabase daily.

## Architecture

```text
Telegram / REST API / future WhatsApp
               ↓
       Application services
               ↓
       Verification engine
               ↓
       CompanyDataProvider
               ↓
       Mock provider (MVP)
               ↓
      PostgreSQL via Prisma
```

The Telegram adapter formats messages and handles user interaction only. The WhatsApp adapter is an inactive interface stub. Channels share `CompanyApplicationService` and `VerificationEngine`.

## Features

- Search by Latvian registration number and normalized company name.
- Optional local mirror of daily UR open data (CC0): commercial-register entities, current and previous names, legal form, registration and termination dates, legal address, and latest annual financial fields when published.
- Structured checks for registration, name, status, legal form, VAT, insolvency, sanctions, and financial-data availability.
- Explicit `VERIFIED`, `WARNING`, `NOT_VERIFIED`, `NOT_FOUND`, and `DATA_UNAVAILABLE` states; no arbitrary trust score.
- Multiple company-name matches with Telegram selection buttons.
- PostgreSQL lookup history, saved verification reports, audit events, provider request telemetry, and expiring cache entries.
- Configurable API and Telegram search limits, structured request logging, request IDs, HTTPS webhook secret validation, and duplicate Telegram update handling.
- Read-only admin console at `/admin` for dashboard metrics, lookup activity, companies, trust reports, analytics, settings, API-key status, and users.
- OpenAPI UI at `/docs`.

## Tech stack

Node.js 22+, TypeScript strict mode, Fastify 5, Prisma 6, PostgreSQL 16, grammY, Zod, Vitest, Docker Compose.

## Local setup

Requirements: Node.js 22 or newer, npm, and Docker Compose (or a PostgreSQL 16 database).

```sh
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The API listens on `http://localhost:3000`. Health check: `GET http://localhost:3000/health`. OpenAPI: `http://localhost:3000/docs`.

Open the admin console at `http://localhost:3000/admin`. In development, admin data endpoints are available only to loopback requests unless `ADMIN_TOKEN` is set; with a token configured, enter it in the console when prompted. Production requires `ADMIN_TOKEN`. When PostgreSQL is available, the dashboard reads persisted lookup, company, report, and user data. In development, without it, the dashboard automatically switches to the built-in fictional company fixtures; lookups and verification reports created in this mode are held in memory for the current server process only, and user records/prior lookup history remain unavailable. Conversation entries represent lookup activity (the MVP does not store chat transcripts); trust reports display the existing verification checks. API-key inventory is informational because keys are not stored by this application.

`db:migrate` uses `prisma migrate dev` and creates a migration if needed. For production use the committed migration history with `npm run db:migrate:deploy`. Do not run development migrations against production.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `DATABASE_URL` | PostgreSQL connection string | local Veriq database |
| `COMPANY_PROVIDER` | Active company provider (`mock` or `ur_open_data`) | `mock` |
| `TELEGRAM_BOT_TOKEN` | Token from Telegram BotFather | empty, bot disabled |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret header value | empty |
| `TELEGRAM_WEBHOOK_URL` | Public HTTPS webhook URL ending in `/api/v1/telegram/webhook` | empty |
| `ADMIN_TOKEN` | Bearer token protecting admin dashboard data endpoints; required in production | empty (loopback-only admin access in development) |
| `RATE_LIMIT_REQUESTS` | Searches allowed per identity per window | `20` |
| `RATE_LIMIT_WINDOW_SECONDS` | Search rate window | `3600` |
| `LOG_LEVEL` | Fastify structured log level | `info` |
| `CORS_ORIGINS` | Comma-separated allowed browser origins; blank disables cross-origin access | empty |
| `WHATSAPP_ENABLED` | Reserved switch for future WhatsApp setup | `false` |
| `WHATSAPP_ACCESS_TOKEN` | Reserved for official WhatsApp Business API | empty |
| `WHATSAPP_PHONE_NUMBER_ID` | Reserved official phone number ID | empty |

Do not commit `.env`. Real provider keys are intentionally not required.

## Database and mock data

PostgreSQL runs from `docker-compose.yml`. Prisma schema: `prisma/schema.prisma`. Seed fixtures: `src/modules/providers/mock/companies.data.ts`; `npm run db:seed` safely upserts 16 fictional companies and can be repeated. To add real open records, follow “UR open data” below; mock records are retained but are not returned when `COMPANY_PROVIDER=ur_open_data`.

Data includes active/clean companies, warning and incomplete records, a liquidated company, insolvency and potential-sanctions examples, historical names, and duplicate possible name matches. Fictional test names do not represent actual people. Company model fields are nullable where sources may omit information.

## REST API

All API endpoints are under `/api/v1` except the top-level `/health` convenience endpoint.

```sh
curl -s http://localhost:3000/api/v1/health
curl -s -X POST http://localhost:3000/api/v1/companies/search \
  -H 'content-type: application/json' -d '{"query":"SIA Baltic Example"}'
curl -s -X POST http://localhost:3000/api/v1/companies/verify \
  -H 'content-type: application/json' -d '{"query":"40103999999"}'
```

Other routes include `GET /api/v1/companies/:id`, company and user history, `POST /api/v1/verification`, and `GET /api/v1/verification/:id`. The API has no customer authentication yet; user history must not be exposed publicly until authentication and authorization are implemented. Keep the service behind a trusted gateway until then.

## Telegram setup

1. Create a bot with Telegram's official BotFather and copy its token.
2. Set `TELEGRAM_BOT_TOKEN` in `.env`; never paste it into source code or commit it.
3. Start PostgreSQL and run migrations plus the mock seed.
4. In another terminal, run `npm run bot:dev` to use Telegram long polling locally.
5. In Telegram, open the bot and send `/start`, then `/assess 40103999999`, `/check`, `/history`, or `/help`. Direct text such as `40103999999` also runs a lookup. `/assess` is an alias for `/check`: it gives a plain-language due-diligence summary from the same verification checks, not a business ranking, credit rating, or cybersecurity scan.

For webhook mode, deploy behind public HTTPS, set `TELEGRAM_WEBHOOK_URL` to the public endpoint including `/api/v1/telegram/webhook`, set a long random `TELEGRAM_WEBHOOK_SECRET`, and run `npm run bot:webhook`. That process registers the webhook and runs the API. Polling and webhook modes should not run for the same bot at the same time. Local polling is the simplest development path.

## UR open data

The app can mirror UR’s official daily open datasets from the Latvian Open Data Portal. They are marked CC0-1.0 and do not need an API key. This is the public bulk-data download/API offered by the catalog; it is separate from UR’s authenticated VISS/API Manager services, which require an application and access approval.

```sh
npm run db:migrate:deploy
npm run data:sync:ur
```

The initial sync downloads the full register, historical-name, registered-activity, paid-up-capital, annual-statement, income-statement, balance-sheet, and sanctions-risk files. It can take several minutes and hundreds of megabytes of network traffic. It upserts Latvian Commercial Register entries with 11-digit registration numbers, then joins the latest financial filing by registration number. Fields are left unknown when the source does not publish them. The sanctions-risk file is used only to flag a company that appears as the listed legal entity itself; a company merely linked to a listed person is not labeled sanctioned.

After sync, set `COMPANY_PROVIDER=ur_open_data` in `.env` and restart the API and Telegram bot. Run `npm run data:sync:ur` again to refresh the mirror; the source files are updated daily, but Veriq does not schedule this command automatically. Check `sourceLastUpdated` and `financialYear` on each record. NACE industry codes, VAT data, board members, and ownership are not filled from these source files. The statistics portal publishes free official aggregate tables, not firm-level accounts, so those statistics are not assigned to individual companies.

The direct UR system-to-system services are a separate integration: UR publishes service docs, but consumers must apply for permission and be provisioned through the VISS/API Manager process. See [UR service list](https://www.ur.gov.lv/lv/registra-api-timekla-pakalpju-servisu-saraksts), [UR free-access information](https://www.ur.gov.lv/lv/informacija-e-pakalpojuma-infourgovlv), and the [open data catalogue](https://data.gov.lv/dati/dataset/uz).

## WhatsApp setup

WhatsApp is **not connected** in this MVP. `src/channels/whatsapp/whatsapp.adapter.ts` provides an explicit inactive adapter stub and will throw until implemented. To make it work in the apps later:

1. Set up a Meta WhatsApp Business account and an approved WhatsApp Business Platform/API provider.
2. Obtain the provider's official access token, phone number ID, inbound webhook verification settings, and message/template requirements.
3. Implement outbound delivery, inbound webhook verification, and button/list conversion in `WhatsAppChannelAdapter`; do not use unofficial WhatsApp Web automation.
4. Map incoming messages to the shared user/channel services and call `CompanyApplicationService`, never duplicate verification rules.
5. Add webhook signature validation, idempotency, delivery/error handling, rate limits, privacy/consent handling, and integration tests.
6. Only then configure WhatsApp credentials and enable the adapter in the app composition.

No WhatsApp credentials or provider are needed to run the current application.

## Testing and development commands

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The tests cover query normalization, mock lookup, provider failure mapping, verification outcomes, rate limits, and Telegram command parsing. A database-backed integration run additionally needs PostgreSQL and migrations. Telegram live checks need bot credentials.

## Docker deployment

Start only the database during local development with `docker compose up -d postgres`. The backend service in Compose expects a built Docker image, `.env`, and a production database schema. Build and start with `docker compose up --build`; the container runs `prisma migrate deploy` before starting the server. Terminate TLS at a trusted reverse proxy/load balancer, use managed secrets, and keep the database private.

## Security

Secrets come from environment variables. Fastify applies secure headers, request size limits, schema validation, CORS configuration, and general request throttling. Search limits use PostgreSQL-backed buckets. Telegram webhooks check `X-Telegram-Bot-Api-Secret-Token`; update IDs are deduplicated. Request and provider logs avoid raw provider responses and query contents; audit entries hash lookup text. Do not expose unauthenticated user-history routes to the public internet.

## Privacy

The MVP stores internal user IDs and Telegram identifiers to associate history, and records lookup query text in a length-limited history entry. It does not store inbound message payloads or full provider responses. Add retention, export/deletion workflows, privacy notices, and a legal review before production use. This design does not by itself establish GDPR compliance.

## Future real API integrations

The UR public open-data mirror is implemented at `src/modules/providers/ur/`; see [docs/providers.md](docs/providers.md). Additional UR authenticated APIs and Firmas.lv require approved or commercial access. Add new provider composition behind the interface without changing channel logic or the verification engine.

## Roadmap

- **Phase 1:** mock provider, Telegram, PostgreSQL, verification engine, history, REST API.
- **Phase 2:** UR open-data mirror, authenticated UR/Firmas.lv access, multi-source conflict handling.
- **Phase 3:** official WhatsApp Business integration, expanded dashboard, customer authentication, API keys.
- **Phase 4:** usage limits, billing, team accounts, expanded audit and enterprise reporting.

## Known MVP limitations

- UR open data provides registration and published annual-report facts, but it does not cover every verification field or prove that a company is a safe counterparty.
- Customer API authentication, API-key management, and per-user authorization are not implemented; admin access control applies only to the dashboard endpoints.
- WhatsApp is only an interface stub.
- The default provider remains mock until `COMPANY_PROVIDER=ur_open_data` is selected. The UR mirror is only as fresh as the last manual sync.
- Metrics are structured logs and persisted provider request rows; there is no Prometheus/OpenTelemetry stack.
- No automatic retention or GDPR export/deletion workflow exists.
