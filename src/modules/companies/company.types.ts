export type CompanyStatus = 'ACTIVE' | 'LIQUIDATED' | 'UNKNOWN';
export type InsolvencyStatus = 'CLEAR' | 'FLAGGED' | 'UNKNOWN';
export type SanctionsStatus = 'CLEAR' | 'POTENTIAL_MATCH' | 'UNKNOWN';

export interface CompanyPerson {
  name: string;
  role?: string;
  ownershipPercent?: number;
}

export interface CompanyRecord {
  id: string;
  registrationNumber: string;
  name: string;
  previousNames: string[];
  legalForm: string | null;
  status: CompanyStatus;
  registrationDate: Date | null;
  liquidationDate: Date | null;
  legalAddress: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  vatRegistered: boolean | null;
  vatNumber: string | null;
  industryCode: string | null;
  industryName: string | null;
  boardMembers: CompanyPerson[] | null;
  shareholders: CompanyPerson[] | null;
  beneficialOwners: CompanyPerson[] | null;
  annualReportAvailable: boolean | null;
  lastAnnualReportDate: Date | null;
  revenue: number | null;
  profit: number | null;
  employeeCount: number | null;
  insolvencyStatus: InsolvencyStatus;
  sanctionsStatus: SanctionsStatus;
  dataSource: string;
  sourceLastUpdated: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CompanySearchResult {
  company: CompanyRecord;
  matchType: 'registration_number' | 'current_name' | 'previous_name';
}
