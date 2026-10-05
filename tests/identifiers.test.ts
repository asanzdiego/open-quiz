import { describe, expect, it } from 'vitest';
import {
  generateJoinCode,
  generateSecretToken,
  JOIN_CODE_ALPHABET,
  tokensMatch,
} from '../src/domain/identifiers.ts';

describe('Identificadores y secretos', () => {
  it('genera códigos de seis caracteres sin los caracteres ambiguos previstos', () => {
    for (let index = 0; index < 100; index += 1) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      expect(code).not.toMatch(/[01IO]/);
      expect(
        [...code].every((character) => JOIN_CODE_ALPHABET.includes(character)),
      ).toBe(true);
    }
  });

  it('genera secretos distintos de 32 bytes codificados como base64url', () => {
    const first = generateSecretToken();
    const second = generateSecretToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(first).not.toBe(second);
  });

  it('compara secretos iguales y distintos, incluso de longitud diferente', () => {
    expect(tokensMatch('secreto', 'secreto')).toBe(true);
    expect(tokensMatch('secreto', 'SECRETO')).toBe(false);
    expect(tokensMatch('secreto', '')).toBe(false);
  });
});
