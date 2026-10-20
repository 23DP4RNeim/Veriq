# Company data providers

The application depends on `CompanyDataProvider` in `src/modules/providers/company-data-provider.ts`. Provider results are normalized to `CompanyRecord`; company lookup, verification, REST responses, and channel adapters use that shared model.

## UR daily open data

`UrCompanyDataProvider` queries a local PostgreSQL mirror populated by `npm run data:sync:ur`. The sync uses the Latvian Open Data Portal CKAN catalogue API to discover resources and downloads public CSV files published by the Latvian Register of Enterprises. UR’s company registry dataset is refreshed daily and is licensed CC0-1.0.

Imported fields include the 11-digit registration number, current and historical names, subject type/legal form, registration and termination dates, legal address and postal code, registered activity descriptions, latest paid-up capital, latest available employee count, revenue, profit, total assets, equity, liabilities, reporting year/currency, and a narrowly interpreted UR sanctions-risk match. Fields absent from the source remain null/unknown.

```sh
npm run db:migrate:deploy
npm run data:sync:ur
# Set COMPANY_PROVIDER=ur_open_data in .env, then restart the app and bot.
```

The importer uses the register, name-history, registered-activity, paid-up-capital, financial-statement metadata, balance-sheet, income-statement, and sanctions-risk files. It upserts Commercial Register entries and only reports the latest filing in the model. It does not import shareholder or beneficial-owner data. Sanctions records may identify a person related to an entity; only a record where the company itself is the listed legal subject is applied as a potential company match. Absence from that risk file is not represented as a clean sanctions result.

Open datasets are public bulk downloads, not a low-latency per-company API. Run the sync again to refresh the local mirror. It downloads hundreds of megabytes and is not scheduled automatically. Requests are unauthenticated; there are no API credentials to configure.

The UR info portal provides free access to current data for human users. UR’s system-to-system web services have a separate application and provisioning process through the VISS/API Manager. Consult [UR’s official web service list](https://www.ur.gov.lv/lv/registra-api-timekla-pakalpju-servisu-saraksts), [UR info service](https://www.ur.gov.lv/lv/informacija-e-pakalpojuma-infourgovlv), [the UR open dataset](https://data.gov.lv/dati/dataset/uz), [annual financial data](https://data.gov.lv/dati/dataset/gada-parskatu-finansu-dati), [registered activities](https://data.gov.lv/dati/dataset/area-of-activity), [paid-up capital](https://data.gov.lv/dati/dataset/equity-capitals), and [sanctions-risk data](https://data.gov.lv/dati/dataset/sanctions).

## Mock data

`MockCompanyDataProvider` remains the default when `COMPANY_PROVIDER=mock`. Its fictional fixtures are useful for development and can be loaded with `npm run db:seed`.

## Firmas.lv

Status: **NOT CONFIGURED**

`FirmasCompanyDataProvider` is an interface stub. It requires commercial access and credentials. Do not invent endpoints or scrape the site.

## Activating another provider

Use `COMPANY_PROVIDER=mock` or `COMPANY_PROVIDER=ur_open_data`. Additional providers should implement `CompanyDataProvider`, map only fields supported by their source, and keep source and retrieval dates visible. Add new configuration and provider contract tests before enabling a new source.
