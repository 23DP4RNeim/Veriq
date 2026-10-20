import { describe, expect, it } from 'vitest';
import { identifyQuery, normalizeCompanyName, normalizeRegistrationNumber } from '../src/modules/companies/company.normalization.js';
import { AppError } from '../src/shared/app-error.js';

describe('registration number normalization', () => {
  it.each([
    ['40103999999', '40103999999'],
    ['LV40103999999', '40103999999'],
    ['LV40103867145', '40103867145'],
    ['LV 4010 399 9999', '40103999999'],
    ['4010 399 9999', '40103999999'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeRegistrationNumber(input)).toBe(expected);
  });

  it.each(['123', '4010399999', '401039999999', 'LV-40103999999', 'company 40103999999'])('rejects obviously invalid registration %s', (input) => {
    expect(() => normalizeRegistrationNumber(input)).toThrow(AppError);
  });

  it('distinguishes a number query from a name query', () => {
    expect(identifyQuery('LV 4010 399 9999')).toEqual({ kind: 'registration_number', normalized: '40103999999' });
    expect(identifyQuery(' SIA   Example ')).toEqual({ kind: 'company_name', normalized: 'example' });
  });
});

describe('company name normalization', () => {
  it('ignores case, excess whitespace, punctuation, and common legal suffixes', () => {
    expect(normalizeCompanyName(' SIA   Example, Labs ')).toBe('example labs');
    expect(normalizeCompanyName('Example Labs SIA')).toBe('example labs');
  });
});
