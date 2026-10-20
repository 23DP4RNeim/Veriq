import { timingSafeEqual } from 'node:crypto';

export function validAdminToken(authorization: string | undefined, token: string): boolean {
  if (!token || !authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
