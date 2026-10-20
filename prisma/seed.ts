import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { MOCK_COMPANIES } from '../src/modules/providers/mock/companies.data.js';

import { createPrismaClient } from '../src/infrastructure/database/prisma.js';
import { loadConfig } from '../src/app/config.js';

const prisma = createPrismaClient(loadConfig());

function jsonField(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null ? Prisma.DbNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function main(): Promise<void> {
  if (MOCK_COMPANIES.length < 15) throw new Error('Expected at least 15 mock companies.');
  for (const company of MOCK_COMPANIES) {
    const fields = {
      name: company.name,
      previousNames: company.previousNames,
      legalForm: company.legalForm,
      status: company.status,
      registrationDate: company.registrationDate,
      liquidationDate: company.liquidationDate,
      legalAddress: company.legalAddress,
      postalCode: company.postalCode,
      city: company.city,
      country: company.country,
      vatRegistered: company.vatRegistered,
      vatNumber: company.vatNumber,
      industryCode: company.industryCode,
      industryName: company.industryName,
      boardMembers: jsonField(company.boardMembers),
      shareholders: jsonField(company.shareholders),
      beneficialOwners: jsonField(company.beneficialOwners),
      annualReportAvailable: company.annualReportAvailable,
      lastAnnualReportDate: company.lastAnnualReportDate,
      revenue: company.revenue,
      profit: company.profit,
      employeeCount: company.employeeCount,
      insolvencyStatus: company.insolvencyStatus,
      sanctionsStatus: company.sanctionsStatus,
      dataSource: company.dataSource,
      sourceLastUpdated: company.sourceLastUpdated,
    };
    await prisma.company.upsert({
      where: { registrationNumber: company.registrationNumber },
      create: { id: company.id, registrationNumber: company.registrationNumber, ...fields },
      update: fields,
    });
  }
  console.info(`Seeded ${MOCK_COMPANIES.length} fictional companies.`);
}

main()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: 'seed_failed', errorName: error instanceof Error ? error.name : 'unknown' }));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
