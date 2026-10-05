import { DomainError } from '../errors.ts';

export const MAX_NICK_LENGTH = 24;

export interface Participant {
  readonly id: string;
  readonly nick: string;
  readonly reconnectToken: string;
  socketId: string | null;
  connected: boolean;
  totalPoints: number;
}

export function normalizeNick(nick: string): string {
  const normalized = nick.trim().normalize('NFC');

  if (
    normalized.length === 0 ||
    [...normalized].length > MAX_NICK_LENGTH ||
    /\p{Cc}/u.test(normalized)
  ) {
    throw new DomainError(
      'INVALID_NICK',
      `El nick debe tener entre 1 y ${MAX_NICK_LENGTH} caracteres y no contener caracteres de control.`,
    );
  }

  return normalized;
}
