import { AppError } from '../../shared/app-error.js';

const LATVIAN_REGISTRATION_LENGTH = 11;

export function normalizeRegistrationNumber(input: string): string {
  const trimmed = input.trim();
  const withoutCountryPrefix = trimmed.replace(/^LV\s*/i, '');
  const digits = withoutCountryPrefix.replace(/[\s\u00a0]/g, '');

  if (!/^\d+$/.test(digits) || digits.length !== LATVIAN_REGISTRATION_LENGTH) {
    throw new AppError('INVALID_QUERY', 'Enter an 11-digit Latvian registration number or a company name.');
  }

  return digits;
}

const LEGAL_SUFFIXES = new Set(['sia', 'as', 'a/s', 'ik', 'ltd', 'limited', 'llc']);

export function normalizeCompanyName(input: string): string {
  const normalized = input
    .normalize('NFKC')
    .toLocaleLowerCase('lv-LV')
    .replace(/[.,;:()[\]{}"'`!?/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalized.split(' ').filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[0] ?? '')) tokens.shift();
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens.at(-1) ?? '')) tokens.pop();
  return tokens.join(' ');
}

export type QueryKind = 'registration_number' | 'company_name';

export function identifyQuery(input: string): { kind: QueryKind; normalized: string } {
  const query = input.trim();
  if (!query) throw new AppError('INVALID_QUERY', 'Enter a registration number or company name.');

  if (/^(?:LV\s*)?[\d\s\u00a0]+$/i.test(query)) {
    return { kind: 'registration_number', normalized: normalizeRegistrationNumber(query) };
  }

  const normalized = normalizeCompanyName(query);
  if (normalized.length < 2) {
    throw new AppError('INVALID_QUERY', 'Company name must contain at least two letters.');
  }
  return { kind: 'company_name', normalized };
}

export function namesMatch(query: string, company: { name: string; previousNames: string[] }): boolean {
  const normalizedQuery = normalizeCompanyName(query);
  return [company.name, ...company.previousNames].some(
    (name) => normalizeCompanyName(name) === normalizedQuery,
  );
}
