# Veriq

**Business Verification & Intelligence**

Veriq is a modular TypeScript MVP for company lookup and transparent business verification. The first release uses fictional Latvian test companies through a mock provider. It is not a legally authoritative determination and does not integrate UR, Firmas.lv, VID, sanctions, or financial APIs.

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

- Search by Latvian registration number (`40103999999`, `LV40103999999`, or spaced digits) and normalized company name.
- Structured checks for registration, name, status, legal form, VAT, insolvency, sanctions, and financial-data availability.
- Explicit `VERIFIED`, `WARNING`, `NOT_VERIFIED`, `NOT_FOUND`, and `DATA_UNAVAILABLE` states; no arbitrary trust score.
- Multiple company-name matches with Telegram selection buttons.
- PostgreSQL lookup history, saved verification reports, audit events, provider request telemetry, and expiring cache entries.
- Configurable API and Telegram search limits, structured request logging, request IDs, HTTPS webhook secret validation, and duplicate Telegram update handling.
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

`db:migrate` uses `prisma migrate dev` and creates a migration if needed. For production use the committed migration history with `npm run db:migrate:deploy`. Do not run development migrations against production.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `DATABASE_URL` | PostgreSQL connection string | local Veriq database |
| `COMPANY_PROVIDER` | Active company provider | `mock` |
| `TELEGRAM_BOT_TOKEN` | Token from Telegram BotFather | empty, bot disabled |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret header value | empty |
| `TELEGRAM_WEBHOOK_URL` | Public HTTPS webhook URL ending in `/api/v1/telegram/webhook` | empty |
| `RATE_LIMIT_REQUESTS` | Searches allowed per identity per window | `20` |
| `RATE_LIMIT_WINDOW_SECONDS` | Search rate window | `3600` |
| `LOG_LEVEL` | Fastify structured log level | `info` |
| `CORS_ORIGINS` | Comma-separated allowed browser origins; blank disables cross-origin access | empty |
| `WHATSAPP_ENABLED` | Reserved switch for future WhatsApp setup | `false` |
| `WHATSAPP_ACCESS_TOKEN` | Reserved for official WhatsApp Business API | empty |
| `WHATSAPP_PHONE_NUMBER_ID` | Reserved official phone number ID | empty |

Do not commit `.env`. Real provider keys are intentionally not required.

## Database and mock data

PostgreSQL runs from `docker-compose.yml`. Prisma schema: `prisma/schema.prisma`. Seed fixtures: `src/modules/providers/mock/companies.data.ts`; `npm run db:seed` safely upserts 16 fictional companies and can be repeated.

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
5. In Telegram, open the bot and send `/start`, then `/check`, `/history`, or `/help`. Direct text such as `40103999999` also runs a lookup.

For webhook mode, deploy behind public HTTPS, set `TELEGRAM_WEBHOOK_URL` to the public endpoint including `/api/v1/telegram/webhook`, set a long random `TELEGRAM_WEBHOOK_SECRET`, and run `npm run bot:webhook`. That process registers the webhook and runs the API. Polling and webhook modes should not run for the same bot at the same time. Local polling is the simplest development path.

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

Implement UR and Firmas.lv provider classes at `src/modules/providers/ur/ur-company-data.provider.ts` and `src/modules/providers/firmas/firmas-company-data.provider.ts`. See [docs/providers.md](docs/providers.md). Obtain official/commercial access first; no URLs, credentials, or scraping behaviors have been invented. Add new provider composition behind the interface without changing channel logic or the verification engine.

## Roadmap

- **Phase 1:** mock provider, Telegram, PostgreSQL, verification engine, history, REST API.
- **Phase 2:** real company-data providers, UR/Firmas.lv access, multi-source conflict handling.
- **Phase 3:** official WhatsApp Business integration, web dashboard, authentication, API keys.
- **Phase 4:** usage limits, billing, team accounts, expanded audit and enterprise reporting.

## Known MVP limitations

- Mock data only; it does not prove a company exists or that any warning is complete.
- Authentication/API keys and per-user authorization are not implemented.
- WhatsApp is only an interface stub.
- Telegram selection and report buttons use the bot's in-memory fixture provider; app restarts retain database history but provider state remains fixture-backed.
- Metrics are structured logs and persisted provider request rows; there is no Prometheus/OpenTelemetry stack.
- No automatic retention or GDPR export/deletion workflow exists.
