-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'LIQUIDATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InsolvencyStatus" AS ENUM ('CLEAR', 'FLAGGED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SanctionsStatus" AS ENUM ('CLEAR', 'POTENTIAL_MATCH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('telegram', 'whatsapp', 'web', 'api');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_users" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "platform_user_id" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "report_style" TEXT NOT NULL DEFAULT 'concise',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "registration_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "previous_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "legal_form" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "registration_date" DATE,
    "liquidation_date" DATE,
    "legal_address" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" TEXT,
    "vat_registered" BOOLEAN,
    "vat_number" TEXT,
    "industry_code" TEXT,
    "industry_name" TEXT,
    "board_members" JSONB,
    "shareholders" JSONB,
    "beneficial_owners" JSONB,
    "annual_report_available" BOOLEAN,
    "last_annual_report_date" DATE,
    "revenue" DOUBLE PRECISION,
    "profit" DOUBLE PRECISION,
    "employee_count" INTEGER,
    "insolvency_status" "InsolvencyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "sanctions_status" "SanctionsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "data_source" TEXT NOT NULL DEFAULT 'Mock Provider',
    "source_last_updated" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_history" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "company_id" UUID,
    "platform" "Platform" NOT NULL,
    "query" TEXT NOT NULL,
    "result_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lookup_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_reports" (
    "id" UUID NOT NULL,
    "lookup_history_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_requests" (
    "id" UUID NOT NULL,
    "provider_name" TEXT NOT NULL,
    "source_record_id" TEXT,
    "query_hash" TEXT NOT NULL,
    "raw_response_hash" TEXT,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_code" TEXT,
    "company_id" UUID,
    "retrieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" UUID,
    "platform" "Platform",
    "company_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_cache" (
    "cache_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_cache_pkey" PRIMARY KEY ("cache_key")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "reset_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "id" UUID NOT NULL,
    "update_id" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "telegram_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "bot_users_telegram_user_id_key" ON "bot_users"("telegram_user_id");

-- CreateIndex
CREATE INDEX "bot_users_created_at_idx" ON "bot_users"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bot_users_platform_platform_user_id_key" ON "bot_users"("platform", "platform_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_registration_number_key" ON "companies"("registration_number");

-- CreateIndex
CREATE INDEX "companies_name_idx" ON "companies"("name");

-- CreateIndex
CREATE INDEX "companies_created_at_idx" ON "companies"("created_at");

-- CreateIndex
CREATE INDEX "lookup_history_user_id_idx" ON "lookup_history"("user_id");

-- CreateIndex
CREATE INDEX "lookup_history_company_id_idx" ON "lookup_history"("company_id");

-- CreateIndex
CREATE INDEX "lookup_history_created_at_idx" ON "lookup_history"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_reports_lookup_history_id_key" ON "verification_reports"("lookup_history_id");

-- CreateIndex
CREATE INDEX "verification_reports_company_id_idx" ON "verification_reports"("company_id");

-- CreateIndex
CREATE INDEX "verification_reports_created_at_idx" ON "verification_reports"("created_at");

-- CreateIndex
CREATE INDEX "provider_requests_provider_name_retrieved_at_idx" ON "provider_requests"("provider_name", "retrieved_at");

-- CreateIndex
CREATE INDEX "provider_requests_retrieved_at_idx" ON "provider_requests"("retrieved_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_company_id_idx" ON "audit_logs"("company_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "company_cache_expires_at_idx" ON "company_cache"("expires_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_reset_at_idx" ON "rate_limit_buckets"("reset_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_update_id_key" ON "telegram_updates"("update_id");

-- CreateIndex
CREATE INDEX "telegram_updates_received_at_idx" ON "telegram_updates"("received_at");

-- AddForeignKey
ALTER TABLE "bot_users" ADD CONSTRAINT "bot_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lookup_history" ADD CONSTRAINT "lookup_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lookup_history" ADD CONSTRAINT "lookup_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_reports" ADD CONSTRAINT "verification_reports_lookup_history_id_fkey" FOREIGN KEY ("lookup_history_id") REFERENCES "lookup_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_reports" ADD CONSTRAINT "verification_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
