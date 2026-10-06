export type AppErrorCode =
  | 'INVALID_QUERY'
  | 'COMPANY_NOT_FOUND'
  | 'MULTIPLE_MATCHES'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'RATE_LIMITED'
  | 'DATABASE_ERROR'
  | 'TELEGRAM_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.statusCode = statusForCode(code);
  }
}

function statusForCode(code: AppErrorCode): number {
  switch (code) {
    case 'INVALID_QUERY': return 400;
    case 'COMPANY_NOT_FOUND': return 404;
    case 'MULTIPLE_MATCHES': return 409;
    case 'RATE_LIMITED': return 429;
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_TIMEOUT': return 503;
    case 'DATABASE_ERROR':
    case 'TELEGRAM_ERROR':
    case 'INTERNAL_ERROR': return 500;
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
