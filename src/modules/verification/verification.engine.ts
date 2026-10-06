import { namesMatch, normalizeRegistrationNumber } from '../companies/company.normalization.js';
import type { CompanyRecord } from '../companies/company.types.js';
import type { QueryKind } from '../companies/company.normalization.js';
import type { CheckState, VerificationCheck, VerificationCheckKey, VerificationResult } from './verification.types.js';

export interface VerificationContext {
  query?: string;
  queryKind?: QueryKind;
}

export class VerificationEngine {
  evaluate(company: CompanyRecord, context: VerificationContext = {}): VerificationResult {
    const registrationIsWellFormed = this.hasValidRegistration(company.registrationNumber);
    const registrationCheck = this.check(
      'registration_check',
      'Registration number found',
      registrationIsWellFormed ? 'Registration number is present in the selected data source.' : 'Stored registration number has an invalid format.',
      registrationIsWellFormed ? 'PASS' : 'FAIL',
    );

    const nameMatches = context.queryKind !== 'company_name' || !context.query
      ? true
      : namesMatch(context.query, company);
    const nameCheck = this.check(
      'name_check',
      'Company name matched',
      context.queryKind === 'company_name'
        ? (nameMatches ? 'Query matches the current or a previous company name.' : 'Query does not match the current or previous company name.')
        : 'No company name was supplied for comparison.',
      context.queryKind === 'company_name' ? (nameMatches ? 'PASS' : 'FAIL') : 'NOT_CHECKED',
    );

    const statusState: CheckState = company.status === 'ACTIVE' ? 'PASS' : company.status === 'LIQUIDATED' ? 'FAIL' : 'WARNING';
    const statusCheck = this.check(
      'status_check', 'Company is active',
      company.status === 'ACTIVE' ? 'Company is listed as active.' : company.status === 'LIQUIDATED' ? 'Company is listed as liquidated.' : 'Company status is unavailable.',
      statusState,
    );

    const legalFormCheck = this.check(
      'legal_form_check', 'Legal form available',
      company.legalForm ? `Legal form: ${company.legalForm}.` : 'Legal form is not available in the source data.',
      company.legalForm ? 'PASS' : 'WARNING',
    );

    const vatCheck = this.check(
      'vat_check', 'VAT registration',
      company.vatRegistered === null ? 'VAT registration status is not available.' : `VAT registration: ${company.vatRegistered ? 'YES' : 'NO'}.`,
      company.vatRegistered === null ? 'WARNING' : 'PASS',
    );

    const insolvencyState: CheckState = company.insolvencyStatus === 'CLEAR'
      ? 'PASS'
      : company.insolvencyStatus === 'FLAGGED' ? 'FAIL' : 'WARNING';
    const insolvencyCheck = this.check(
      'insolvency_check', 'Insolvency indicator',
      company.insolvencyStatus === 'CLEAR' ? 'No insolvency indicator in available data.' : company.insolvencyStatus === 'FLAGGED' ? 'Potential insolvency indicator requires review.' : 'Insolvency data is unavailable.',
      insolvencyState,
    );

    const sanctionsState: CheckState = company.sanctionsStatus === 'CLEAR'
      ? 'PASS'
      : company.sanctionsStatus === 'POTENTIAL_MATCH' ? 'WARNING' : 'WARNING';
    const sanctionsCheck = this.check(
      'sanctions_check', 'Sanctions screening',
      company.sanctionsStatus === 'CLEAR' ? 'No sanctions match in available data.' : company.sanctionsStatus === 'POTENTIAL_MATCH' ? 'Potential sanctions match; manual review is required.' : 'Sanctions screening data is unavailable.',
      sanctionsState,
    );

    const hasFinancialData = company.annualReportAvailable === true && company.lastAnnualReportDate !== null;
    const financialDataCheck = this.check(
      'financial_data_check', 'Financial data availability',
      hasFinancialData ? 'Latest annual report is available in the source data.' : company.annualReportAvailable === false
        ? 'Latest annual report is unavailable.' : 'Annual report availability is unknown.',
      hasFinancialData ? 'PASS' : 'WARNING',
    );

    const checks = [registrationCheck, nameCheck, statusCheck, legalFormCheck, vatCheck, insolvencyCheck, sanctionsCheck, financialDataCheck];
    const warnings = checks.filter((check) => check.state === 'WARNING').map((check) => check.message);
    const criticalIssues = checks.filter((check) => check.state === 'FAIL').map((check) => check.message);

    return {
      companyId: company.id,
      status: criticalIssues.length > 0 ? 'NOT_VERIFIED' : warnings.length > 0 ? 'WARNING' : 'VERIFIED',
      registrationCheck,
      nameCheck,
      statusCheck,
      legalFormCheck,
      vatCheck,
      insolvencyCheck,
      sanctionsCheck,
      financialDataCheck,
      checks,
      warnings,
      criticalIssues,
      passedChecks: checks.filter((check) => check.state === 'PASS').length,
      totalChecks: checks.length,
      checkedAt: new Date().toISOString(),
    };
  }

  notFound(): VerificationResult {
    return {
      companyId: null,
      status: 'NOT_FOUND',
      registrationCheck: this.check('registration_check', 'Registration lookup', 'No company was found.', 'FAIL'),
      nameCheck: this.check('name_check', 'Company name lookup', 'No company was found.', 'FAIL'),
      statusCheck: this.check('status_check', 'Company status', 'No company data is available.', 'NOT_CHECKED'),
      legalFormCheck: this.check('legal_form_check', 'Legal form', 'No company data is available.', 'NOT_CHECKED'),
      vatCheck: this.check('vat_check', 'VAT registration', 'No company data is available.', 'NOT_CHECKED'),
      insolvencyCheck: this.check('insolvency_check', 'Insolvency indicator', 'No company data is available.', 'NOT_CHECKED'),
      sanctionsCheck: this.check('sanctions_check', 'Sanctions screening', 'No company data is available.', 'NOT_CHECKED'),
      financialDataCheck: this.check('financial_data_check', 'Financial data availability', 'No company data is available.', 'NOT_CHECKED'),
      checks: [],
      warnings: [],
      criticalIssues: [],
      passedChecks: 0,
      totalChecks: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  dataUnavailable(): VerificationResult {
    const check = this.check('registration_check', 'Company data lookup', 'Verification could not be completed because the data source is temporarily unavailable.', 'WARNING');
    return {
      companyId: null, status: 'DATA_UNAVAILABLE', registrationCheck: check,
      nameCheck: this.check('name_check', 'Company name match', 'No company data is available.', 'NOT_CHECKED'),
      statusCheck: this.check('status_check', 'Company status', 'No company data is available.', 'NOT_CHECKED'),
      legalFormCheck: this.check('legal_form_check', 'Legal form', 'No company data is available.', 'NOT_CHECKED'),
      vatCheck: this.check('vat_check', 'VAT registration', 'No company data is available.', 'NOT_CHECKED'),
      insolvencyCheck: this.check('insolvency_check', 'Insolvency indicator', 'No company data is available.', 'NOT_CHECKED'),
      sanctionsCheck: this.check('sanctions_check', 'Sanctions screening', 'No company data is available.', 'NOT_CHECKED'),
      financialDataCheck: this.check('financial_data_check', 'Financial data availability', 'No company data is available.', 'NOT_CHECKED'),
      checks: [check], warnings: [check.message], criticalIssues: [], passedChecks: 0, totalChecks: 1, checkedAt: new Date().toISOString(),
    };
  }

  private check(key: VerificationCheckKey, label: string, message: string, state: CheckState): VerificationCheck {
    return { key, label, message, state };
  }

  private hasValidRegistration(registrationNumber: string): boolean {
    try {
      return normalizeRegistrationNumber(registrationNumber) === registrationNumber;
    } catch {
      return false;
    }
  }
}
