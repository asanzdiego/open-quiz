import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;

export function generateJoinCode(): string {
  return Array.from({ length: JOIN_CODE_LENGTH }, () =>
    JOIN_CODE_ALPHABET.charAt(randomInt(JOIN_CODE_ALPHABET.length)),
  ).join('');
}

export function generateSecretToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokensMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
