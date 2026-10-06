import { describe, expect, it } from 'vitest';
import { VerificationEngine } from '../src/modules/verification/verification.engine.js';
import { MOCK_COMPANIES } from '../src/modules/providers/mock/companies.data.js';

const engine = new VerificationEngine();

function companyNamed(name: string) {
  const company = MOCK_COMPANIES.find((item) => item.name === name);
  if (!company) throw new Error(`Missing mock company ${name}`);
  return company;
}

describe('VerificationEngine', () => {
  it('marks a clean active company VERIFIED', () => {
    const result = engine.evaluate(companyNamed('SIA Baltic Example'));
    expect(result.status).toBe('VERIFIED');
    expect(result.passedChecks).toBe(7);
    expect(result.criticalIssues).toHaveLength(0);
  });

  it('marks incomplete or potential-warning data as WARNING', () => {
    expect(engine.evaluate(companyNamed('SIA Amber Warnings')).status).toBe('WARNING');
    expect(engine.evaluate(companyNamed('SIA Possible Match')).sanctionsCheck.state).toBe('WARNING');
  });

  it('marks liquidated and insolvency-flagged companies NOT_VERIFIED', () => {
    expect(engine.evaluate(companyNamed('SIA Closed Harbor')).status).toBe('NOT_VERIFIED');
    expect(engine.evaluate(companyNamed('SIA North Insolvency')).insolvencyCheck.state).toBe('FAIL');
  });

  it('checks name mismatch separately from registration existence', () => {
    const result = engine.evaluate(companyNamed('SIA Baltic Example'), { query: 'SIA Other Company', queryKind: 'company_name' });
    expect(result.registrationCheck.state).toBe('PASS');
    expect(result.nameCheck.state).toBe('FAIL');
    expect(result.status).toBe('NOT_VERIFIED');
  });

  it('keeps missing provider data as warnings and distinguishes missing companies', () => {
    const incomplete = engine.evaluate(companyNamed('SIA Partial Record'));
    expect(incomplete.status).toBe('WARNING');
    expect(incomplete.statusCheck.state).toBe('WARNING');
    expect(engine.notFound().status).toBe('NOT_FOUND');
    expect(engine.dataUnavailable().status).toBe('DATA_UNAVAILABLE');
  });
});
