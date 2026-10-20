ALTER TABLE "companies"
ADD COLUMN "total_assets" DOUBLE PRECISION,
ADD COLUMN "equity" DOUBLE PRECISION,
ADD COLUMN "total_liabilities" DOUBLE PRECISION,
ADD COLUMN "financial_year" INTEGER,
ADD COLUMN "financial_currency" TEXT;

CREATE INDEX "companies_data_source_idx" ON "companies"("data_source");
