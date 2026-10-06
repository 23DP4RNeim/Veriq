export type VerificationStatus = 'VERIFIED' | 'WARNING' | 'NOT_VERIFIED' | 'NOT_FOUND' | 'DATA_UNAVAILABLE';
export type CheckState = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_CHECKED';
export type VerificationCheckKey =
  | 'registration_check'
  | 'name_check'
  | 'status_check'
  | 'legal_form_check'
  | 'vat_check'
  | 'insolvency_check'
  | 'sanctions_check'
  | 'financial_data_check';

export interface VerificationCheck {
  key: VerificationCheckKey;
  state: CheckState;
  label: string;
  message: string;
}

export interface VerificationResult {
  companyId: string | null;
  status: VerificationStatus;
  registrationCheck: VerificationCheck;
  nameCheck: VerificationCheck;
  statusCheck: VerificationCheck;
  legalFormCheck: VerificationCheck;
  vatCheck: VerificationCheck;
  insolvencyCheck: VerificationCheck;
  sanctionsCheck: VerificationCheck;
  financialDataCheck: VerificationCheck;
  checks: VerificationCheck[];
  warnings: string[];
  criticalIssues: string[];
  passedChecks: number;
  totalChecks: number;
  checkedAt: string;
}
