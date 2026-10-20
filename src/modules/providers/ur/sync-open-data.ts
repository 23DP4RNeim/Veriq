import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { parse } from 'csv-parse';
import { Prisma } from '@prisma/client';
import { UR_OPEN_DATA_SOURCE } from './ur-company-data.provider.js';

import { createPrismaClient } from '../../../infrastructure/database/prisma.js';
import { loadConfig } from '../../../app/config.js';

const prisma = createPrismaClient(loadConfig());
const CATALOG_API = 'https://data.gov.lv/dati/api/3/action/package_show?id=';
const CSV_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH_SIZE = 250;
const COMPANY_NUMBER = /^\d{11}$/;

interface Resource { name: string; url: string; last_modified?: string; }
interface Package { success: boolean; result: { license_id: string; resources: Resource[] }; }
interface FinancialRow {
  financialYear: number;
  lastAnnualReportDate: string | null;
  employeeCount: number | null;
  revenue: number | null;
  profit: number | null;
  totalAssets: number | null;
  equity: number | null;
  totalLiabilities: number | null;
  financialCurrency: string | null;
}
interface CapitalRow { amount: number; currency: string; modifiedAt: string; }

async function packageInfo(name: string): Promise<Package['result']> {
  const response = await fetch(`${CATALOG_API}${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Open data catalog request failed (${response.status}).`);
  const body = await response.json() as Package;
  if (!body.success || body.result.license_id !== 'CC0-1.0') throw new Error(`Dataset ${name} is unavailable or is not marked CC0-1.0.`);
  return body.result;
}

function resource(pack: Package['result'], name: string): Resource {
  const found = pack.resources.find((item) => item.name === name);
  if (!found?.url) throw new Error(`Dataset resource not found: ${name}.`);
  return found;
}

async function* csvRows(url: string): AsyncGenerator<Record<string, string>> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let input: Readable | undefined;
    let parser: ReturnType<typeof parse> | undefined;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(CSV_TIMEOUT_MS) });
      if (!response.ok || !response.body) throw new Error(`Open data download failed (${response.status}).`);
      input = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      parser = input.pipe(parse({ bom: true, columns: true, delimiter: ';', skip_empty_lines: true, relax_quotes: true, relax_column_count: true }));
      input.on('error', (error: Error) => parser?.destroy(error));
      for await (const row of parser) yield row as Record<string, string>;
      return;
    } catch (error) {
      input?.destroy();
      parser?.destroy();
      if (attempt === 4) throw error;
      console.warn(`Open data stream interrupted; resuming ${new URL(url).pathname} (attempt ${attempt + 1}/4).`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function companyRegistrationNumber(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return COMPANY_NUMBER.test(normalized) ? normalized : null;
}

async function loadHistoricalNames(): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  let count = 0;
  for await (const row of csvRows('https://dati.ur.gov.lv/register/register_name_history.csv')) {
    const registrationNumber = companyRegistrationNumber(row.regcode);
    const name = row.name?.trim();
    if (!registrationNumber || !name) continue;
    const values = names.get(registrationNumber) ?? [];
    if (!values.includes(name)) values.push(name);
    names.set(registrationNumber, values);
    count++;
  }
  console.info(`Read ${count.toLocaleString()} historical name rows.`);
  return names;
}

async function loadSanctionRisks(): Promise<Set<string>> {
  const pack = await packageInfo('sanctions');
  const data = resource(pack, 'Informācija par sankciju riskiem');
  const registrationNumbers = new Set<string>();
  for await (const row of csvRows(data.url)) {
    // Only mark the listed legal entity itself. A legal_entity_registration_number can
    // merely identify a company linked to a listed person and is not a company sanction.
    const registrationNumber = companyRegistrationNumber(row.sanctions_subject_registration_number);
    if (registrationNumber) registrationNumbers.add(registrationNumber);
  }
  console.info(`Read ${registrationNumbers.size.toLocaleString()} registration numbers linked to UR sanctions-risk entries.`);
  return registrationNumbers;
}

async function loadActivities(): Promise<Map<string, string>> {
  const pack = await packageInfo('area-of-activity');
  const data = resource(pack, 'Tiesību subjektu darbības mērķi un veidi');
  const activities = new Map<string, string[]>();
  for await (const row of csvRows(data.url)) {
    const registrationNumber = companyRegistrationNumber(row.legal_entity_registration_number);
    const activity = row.area_of_activity?.trim();
    if (!registrationNumber || !activity) continue;
    const values = activities.get(registrationNumber) ?? [];
    if (values.length < 12 && !values.includes(activity)) values.push(activity);
    activities.set(registrationNumber, values);
  }
  console.info(`Read activity descriptions for ${activities.size.toLocaleString()} entities.`);
  return new Map([...activities].map(([registrationNumber, values]) => [registrationNumber, values.join('; ')]));
}

async function loadPaidUpCapital(): Promise<Map<string, CapitalRow>> {
  const pack = await packageInfo('equity-capitals');
  const data = resource(pack, 'Pamatkapitālu un ieguldījumu informācija');
  const capitalByRegistration = new Map<string, CapitalRow>();
  for await (const row of csvRows(data.url)) {
    if (row.equity_capital_type !== 'PAID_UP_EQUITY') continue;
    const registrationNumber = companyRegistrationNumber(row.legal_entity_registration_number);
    const amount = parseNumber(row.amount);
    if (!registrationNumber || amount === null) continue;
    const modifiedAt = row.last_modified_at?.trim() || row.date_from?.trim() || '';
    const previous = capitalByRegistration.get(registrationNumber);
    if (!previous || modifiedAt > previous.modifiedAt) {
      capitalByRegistration.set(registrationNumber, { amount, currency: row.currency?.trim() || 'EUR', modifiedAt });
    }
  }
  console.info(`Read paid-up capital for ${capitalByRegistration.size.toLocaleString()} entities.`);
  return capitalByRegistration;
}

async function loadLatestFinancials(): Promise<Map<string, FinancialRow>> {
  const pack = await packageInfo('gada-parskatu-finansu-dati');
  const statements = resource(pack, 'Gada pārskatu pamatinformācija');
  const idsByRegistration = new Map<string, { id: string; year: number; ended: string | null; employeeCount: number | null; currency: string | null }>();
  let statementCount = 0;
  for await (const row of csvRows(statements.url)) {
    const registrationNumber = companyRegistrationNumber(row.legal_entity_registration_number);
    const id = row.id?.trim();
    const year = Number(row.year);
    if (!registrationNumber || !id || !Number.isInteger(year)) continue;
    const ended = row.year_ended_on?.slice(0, 10) || null;
    const previous = idsByRegistration.get(registrationNumber);
    if (!previous || year > previous.year || (year === previous.year && (ended ?? '') > (previous.ended ?? ''))) {
      idsByRegistration.set(registrationNumber, {
        id, year, ended, employeeCount: parseNumber(row.employees), currency: row.currency?.trim() || null,
      });
    }
    statementCount++;
  }
  console.info(`Read ${statementCount.toLocaleString()} annual statement rows; ${idsByRegistration.size.toLocaleString()} entities have financial statements.`);

  const registrationByStatementId = new Map<string, string>();
  const financials = new Map<string, FinancialRow>();
  for (const [registrationNumber, statement] of idsByRegistration) {
    registrationByStatementId.set(statement.id, registrationNumber);
    financials.set(registrationNumber, {
      financialYear: statement.year,
      lastAnnualReportDate: statement.ended,
      employeeCount: statement.employeeCount,
      revenue: null,
      profit: null,
      totalAssets: null,
      equity: null,
      totalLiabilities: null,
      financialCurrency: statement.currency,
    });
  }
  idsByRegistration.clear();

  const income = resource(pack, 'Peļņas vai zaudējumu aprēķini');
  for await (const row of csvRows(income.url)) {
    const registrationNumber = registrationByStatementId.get(row.statement_id?.trim() ?? '');
    if (!registrationNumber) continue;
    const financial = financials.get(registrationNumber);
    if (!financial) continue;
    financial.revenue = parseNumber(row.net_turnover);
    financial.profit = parseNumber(row.net_income) ?? parseNumber(row.income_after_income_taxes);
  }

  const balance = resource(pack, 'Bilances');
  for await (const row of csvRows(balance.url)) {
    const registrationNumber = registrationByStatementId.get(row.statement_id?.trim() ?? '');
    if (!registrationNumber) continue;
    const financial = financials.get(registrationNumber);
    if (!financial) continue;
    financial.totalAssets = parseNumber(row.total_assets);
    financial.equity = parseNumber(row.total_equities);
    const current = parseNumber(row.current_liabilities);
    const nonCurrent = parseNumber(row.non_current_liabilities);
    const provisions = parseNumber(row.provisions);
    if (current !== null || nonCurrent !== null || provisions !== null) {
      financial.totalLiabilities = (current ?? 0) + (nonCurrent ?? 0) + (provisions ?? 0);
    }
  }

  registrationByStatementId.clear();
  console.info(`Enriched ${financials.size.toLocaleString()} entities with latest financial statement metadata.`);
  return financials;
}

async function upsertBatch(rows: Prisma.Sql[]): Promise<void> {
  if (rows.length === 0) return;
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "companies" (
      "id", "registration_number", "name", "previous_names", "legal_form", "status",
      "registration_date", "liquidation_date", "legal_address", "postal_code", "city", "country",
      "vat_registered", "vat_number", "industry_code", "industry_name", "board_members", "shareholders",
      "beneficial_owners", "annual_report_available", "last_annual_report_date", "revenue", "profit",
      "employee_count", "total_assets", "equity", "total_liabilities", "financial_year", "financial_currency",
      "paid_up_capital", "capital_currency", "insolvency_status", "sanctions_status", "data_source", "source_last_updated", "created_at", "updated_at"
    ) VALUES ${Prisma.join(rows)}
    ON CONFLICT ("registration_number") DO UPDATE SET
      "name" = EXCLUDED."name", "previous_names" = EXCLUDED."previous_names", "legal_form" = EXCLUDED."legal_form",
      "status" = EXCLUDED."status", "registration_date" = EXCLUDED."registration_date", "liquidation_date" = EXCLUDED."liquidation_date",
      "legal_address" = EXCLUDED."legal_address", "postal_code" = EXCLUDED."postal_code", "city" = EXCLUDED."city",
      "country" = EXCLUDED."country", "annual_report_available" = EXCLUDED."annual_report_available",
      "vat_registered" = EXCLUDED."vat_registered", "vat_number" = EXCLUDED."vat_number",
      "industry_code" = EXCLUDED."industry_code", "industry_name" = EXCLUDED."industry_name",
      "board_members" = EXCLUDED."board_members", "shareholders" = EXCLUDED."shareholders",
      "beneficial_owners" = EXCLUDED."beneficial_owners",
      "last_annual_report_date" = EXCLUDED."last_annual_report_date", "revenue" = EXCLUDED."revenue", "profit" = EXCLUDED."profit",
      "employee_count" = EXCLUDED."employee_count", "total_assets" = EXCLUDED."total_assets", "equity" = EXCLUDED."equity",
      "total_liabilities" = EXCLUDED."total_liabilities", "financial_year" = EXCLUDED."financial_year",
      "financial_currency" = EXCLUDED."financial_currency", "paid_up_capital" = EXCLUDED."paid_up_capital",
      "capital_currency" = EXCLUDED."capital_currency", "insolvency_status" = EXCLUDED."insolvency_status",
      "sanctions_status" = EXCLUDED."sanctions_status", "data_source" = EXCLUDED."data_source",
      "source_last_updated" = EXCLUDED."source_last_updated", "updated_at" = NOW()
  `);
}

async function main(): Promise<void> {
  const registry = await packageInfo('uz');
  const registryResource = resource(registry, 'Uzņēmumu reģistra atvērtie dati');
  const modified = registryResource.last_modified ? new Date(registryResource.last_modified) : new Date();
  const historicalNames = await loadHistoricalNames();
  const sanctionRisks = await loadSanctionRisks();
  const activities = await loadActivities();
  const paidUpCapital = await loadPaidUpCapital();
  const financials = await loadLatestFinancials();
  const batch: Prisma.Sql[] = [];
  let imported = 0;
  let skipped = 0;
  for await (const row of csvRows(registryResource.url)) {
    const registrationNumber = companyRegistrationNumber(row.regcode);
    if (!registrationNumber || row.regtype !== 'K' || !row.name?.trim()) {
      skipped++;
      continue;
    }
    const terminated = row.terminated?.trim() || null;
    const isLiquidated = Boolean(terminated && row.closed?.trim() === 'L');
    const latest = financials.get(registrationNumber);
    const paidUp = paidUpCapital.get(registrationNumber);
    const address = row.address?.trim() || null;
    const activity = activities.get(registrationNumber) ?? null;
    const previousNames = (historicalNames.get(registrationNumber) ?? []).filter((name) => name !== row.name?.trim());
    const sanctionsStatus = sanctionRisks.has(registrationNumber) ? 'POTENTIAL_MATCH' : 'UNKNOWN';
    const status = terminated ? (isLiquidated ? 'LIQUIDATED' : 'UNKNOWN') : 'ACTIVE';
    batch.push(Prisma.sql`(
      ${randomUUID()}::uuid, ${registrationNumber}, ${row.name.trim()}, ${previousNames}, ${row.type_text?.trim() || null},
      ${status}::"CompanyStatus",
      ${parseDate(row.registered)}, ${isLiquidated ? parseDate(terminated) : null}, ${address},
      ${row.index?.trim() ? `LV-${row.index.trim()}` : null}, NULL, 'Latvia',
      NULL, NULL, NULL, ${activity}, NULL, NULL, NULL, ${latest !== undefined},
      ${parseDate(latest?.lastAnnualReportDate)}, ${latest?.revenue ?? null}, ${latest?.profit ?? null},
      ${latest?.employeeCount ?? null}, ${latest?.totalAssets ?? null}, ${latest?.equity ?? null},
      ${latest?.totalLiabilities ?? null}, ${latest?.financialYear ?? null}, ${latest?.financialCurrency ?? null},
      ${paidUp?.amount ?? null}, ${paidUp?.currency ?? null},
      'UNKNOWN'::"InsolvencyStatus", ${sanctionsStatus}::"SanctionsStatus", ${UR_OPEN_DATA_SOURCE}, ${modified}, NOW(), NOW()
    )`);
    if (batch.length >= BATCH_SIZE) {
      await upsertBatch(batch.splice(0, batch.length));
      imported += BATCH_SIZE;
      if (imported % 10_000 === 0) console.info(`Imported ${imported.toLocaleString()} register subjects.`);
    }
  }
  if (batch.length) {
    imported += batch.length;
    await upsertBatch(batch);
  }
  const invalidatedCacheEntries = await prisma.companyCacheEntry.deleteMany({ where: { provider: 'ur-open-data' } });
  console.info(JSON.stringify({ event: 'ur_open_data_sync_complete', imported, skipped, invalidatedCacheEntries: invalidatedCacheEntries.count, dataSource: UR_OPEN_DATA_SOURCE, modified: modified.toISOString() }));
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: 'ur_open_data_sync_failed', errorName: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : 'Unknown error' }));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
