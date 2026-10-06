import type { CompanyRecord } from '../../modules/companies/company.types.js';
import type { VerificationResult } from '../../modules/verification/verification.types.js';
import type { HistoryItem } from '../../modules/users/user.service.js';

export function formatVerification(company: CompanyRecord, verification: VerificationResult, full = false): string {
  const statusLabel = verification.status === 'VERIFIED' ? '🟢 VERIFIED'
    : verification.status === 'WARNING' ? '🟡 WARNING'
      : '🔴 NOT VERIFIED';
  const registered = company.registrationDate ? formatDate(company.registrationDate) : 'Not available';
  const lines = [
    'VERIQ',
    'BUSINESS VERIFICATION',
    '',
    `🏢 ${company.name}`,
    `Registration: ${company.registrationNumber}`,
    `Status: ${company.status === 'ACTIVE' ? '🟢' : company.status === 'LIQUIDATED' ? '🔴' : '⚪'} ${company.status}`,
    `Verification: ${statusLabel}`,
    `Legal form: ${company.legalForm ?? 'Not available'}`,
    `Registered: ${registered}`,
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
  lines.push(`Source: ${company.dataSource}`, `Checked: ${formatDateTime(new Date(verification.checkedAt))}`, 'Based on available data; not a legally authoritative determination.');

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
    const members = company.boardMembers?.map((member) => `• ${member.name}${member.role ? ` — ${member.role}` : ''}`) ?? [];
    lines.push('Board members:', ...(members.length > 0 ? members : ['Not available']));
    lines.push(`Latest annual report: ${company.lastAnnualReportDate ? formatDate(company.lastAnnualReportDate) : 'Not available'}`);
  }
  return lines.join('\n');
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
