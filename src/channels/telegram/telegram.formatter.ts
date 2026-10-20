import type { CompanyRecord } from '../../modules/companies/company.types.js';
import type { VerificationResult } from '../../modules/verification/verification.types.js';
import type { HistoryItem } from '../../modules/users/user.service.js';

export function formatVerification(company: CompanyRecord, verification: VerificationResult, full = false): string {
  const statusLabel = verification.status === 'VERIFIED' ? '🟢 VERIFIED'
    : verification.status === 'WARNING' ? '🟡 WARNING'
      : '🔴 NOT VERIFIED';
  const registered = company.registrationDate ? formatDate(company.registrationDate) : 'Not available';
  const workingWithSummary = verification.status === 'NOT_VERIFIED'
    ? 'Resolve critical issues before proceeding.'
    : verification.status === 'WARNING'
      ? 'Review the warnings and verify key details independently.'
      : 'No issues were flagged in the checked fields; complete your usual due diligence.';
  const lines = [
    'VERIQ',
    'BUSINESS VERIFICATION',
    '',
    `🏢 ${company.name}`,
    `Registration: ${company.registrationNumber}`,
    `Status: ${company.status === 'ACTIVE' ? '🟢' : company.status === 'LIQUIDATED' ? '🔴' : '⚪'} ${company.status}`,
    `Verification: ${statusLabel}`,
    `Working with them: ${workingWithSummary}`,
    `Legal form: ${company.legalForm ?? 'Not available'}`,
    `Registered: ${registered}`,
    ...(company.financialYear ? [`Latest financial year: ${company.financialYear}`] : []),
    '',
    `Checks passed: ${verification.passedChecks}/${verification.totalChecks}`,
    `Warnings: ${verification.warnings.length} · Critical issues: ${verification.criticalIssues.length}`,
  ];

  if (verification.warnings.length > 0) {
    lines.push('', 'Warnings:', ...verification.warnings.map((warning) => `⚠ ${warning}`));
  }
  if (verification.criticalIssues.length > 0) {
    lines.push('', 'Critical issues:', ...verification.criticalIssues.map((issue) => `✖ ${issue}`));
  }
  lines.push(`Source: ${company.dataSource}`, `Source updated: ${company.sourceLastUpdated ? formatDateTime(company.sourceLastUpdated) : 'Not available'}`, `Checked: ${formatDateTime(new Date(verification.checkedAt))}`, 'Based on available data; not a legal, credit, or cybersecurity rating.');

  if (full) {
    lines.push('', 'VERIFICATION CHECKS');
    for (const check of verification.checks) {
      const icon = check.state === 'PASS' ? '✓' : check.state === 'FAIL' ? '✖' : check.state === 'WARNING' ? '⚠' : '–';
      lines.push(`${icon} ${check.label}: ${check.message}`);
    }
    lines.push('', 'COMPANY DETAILS');
    lines.push(`Address: ${[company.legalAddress, company.city, company.country].filter(Boolean).join(', ') || 'Not available'}`);
    lines.push(`Industry: ${[company.industryCode, company.industryName].filter(Boolean).join(' ') || 'Not available'}`);
    lines.push(`VAT registration: ${company.vatRegistered === null ? 'Not available' : company.vatRegistered ? 'Yes' : 'No'}`);
    if (company.financialYear) lines.push(`Financial year: ${company.financialYear}`);
    const currency = company.financialCurrency ?? 'EUR';
    lines.push(`Revenue: ${formatMoney(company.revenue, currency)}`, `Profit after tax: ${formatMoney(company.profit, currency)}`);
    lines.push(`Employees: ${company.employeeCount ?? 'Not available'}`);
    lines.push(`Total assets: ${formatMoney(company.totalAssets ?? null, currency)}`, `Equity: ${formatMoney(company.equity ?? null, currency)}`, `Total liabilities: ${formatMoney(company.totalLiabilities ?? null, currency)}`);
    if (company.paidUpCapital !== null && company.paidUpCapital !== undefined) {
      lines.push(`Paid-up capital: ${formatMoney(company.paidUpCapital, company.capitalCurrency ?? 'EUR')}`);
    }
    if (company.industryName) lines.push(`Registered activities: ${company.industryName}`);
    const members = company.boardMembers?.map((member) => `• ${member.name}${member.role ? ` — ${member.role}` : ''}`) ?? [];
    lines.push('Board members:', ...(members.length > 0 ? members : ['Not available']));
    lines.push(`Latest annual report: ${company.lastAnnualReportDate ? formatDate(company.lastAnnualReportDate) : 'Not available'}`);
  }
  return lines.join('\n');
}

function formatMoney(value: number | null | undefined, currency: string): string {
  return value === null || value === undefined
    ? 'Not available'
    : new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatHistory(history: HistoryItem[]): string {
  if (history.length === 0) return 'No company lookups yet. Use /check to get started.';
  return [
    'VERIQ · RECENT CHECKS',
    '',
    ...history.map((item) => {
      const company = item.company ? `${item.company.name}\n${item.company.registrationNumber}` : item.query;
      return `${company}\n${item.resultStatus} · ${formatDateTime(item.createdAt)}`;
    }),
  ].join('\n\n');
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}
