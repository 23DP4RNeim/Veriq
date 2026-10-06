# Company data providers

The application depends on `CompanyDataProvider` in `src/modules/providers/company-data-provider.ts`. Provider results are normalized to `CompanyRecord`; company lookup, verification, REST responses, and channel adapters use that shared model. The active MVP provider is `MockCompanyDataProvider`, backed by fictional fixtures in `src/modules/providers/mock/companies.data.ts` and upserted into PostgreSQL by `npm run db:seed`.

## Latvijas Republikas Uzņēmumu reģistrs

Status: **NOT CONFIGURED**

Required: official API access and credentials.

Implementation location: `src/modules/providers/ur/ur-company-data.provider.ts` (`UrCompanyDataProvider`). Implement only against the official access method once supplied. No endpoint, credential, or data access method is assumed here.

## Firmas.lv

Status: **NOT CONFIGURED**

Required: commercial access and credentials.

Implementation location: `src/modules/providers/firmas/firmas-company-data.provider.ts` (`FirmasCompanyDataProvider`). No URL or credential is assumed here.

## Other data sources

VID, sanctions screening, and financial data should be separate provider interfaces when their access and output requirements are known. Avoid treating one source as authoritative for fields it does not provide. Keep source, retrieval time, and conflicts visible; do not persist full sensitive upstream responses. `ProviderRequest` stores a query hash and request status, not the response body.

## Activating another provider

Implement the interface, add explicit configuration and composition in `src/app/container.ts`, and map source-specific records to nullable `CompanyRecord` fields. Add provider contract tests before enabling a new provider. The current `COMPANY_PROVIDER` setting intentionally permits only `mock`; real integrations are not active.
