import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config/env.ts';

describe('Configuración', () => {
  it('utiliza los valores predeterminados sin variables de entorno', () => {
    expect(readConfig({})).toEqual({
      port: 3000,
      nodeEnv: 'development',
      nextcloud: undefined,
      sessionTtlMs: 120 * 60_000,
      finishedSessionTtlMs: 30 * 60_000,
    });
  });

  it('utiliza el puerto y el entorno proporcionados', () => {
    expect(readConfig({ PORT: '8080', NODE_ENV: 'production' })).toEqual({
      port: 8080,
      nodeEnv: 'production',
      nextcloud: undefined,
      sessionTtlMs: 120 * 60_000,
      finishedSessionTtlMs: 30 * 60_000,
    });
  });

  it.each(['', '0', '-1', '65536', '3.5', 'abc', '3000abc', ' 3000 '])(
    'rechaza el puerto inválido %j',
    (port) => {
      expect(() => readConfig({ PORT: port })).toThrow('PORT');
    },
  );

  it('rechaza un entorno desconocido', () => {
    expect(() => readConfig({ NODE_ENV: 'desconocido' })).toThrow('NODE_ENV');
  });

  it('lee los TTL de sesiones desde el entorno', () => {
    expect(
      readConfig({
        SESSION_TTL_MINUTES: '90',
        FINISHED_SESSION_TTL_MINUTES: '10',
      }),
    ).toMatchObject({
      sessionTtlMs: 90 * 60_000,
      finishedSessionTtlMs: 10 * 60_000,
    });
  });

  it.each(['', '0', '-1', '1.5', 'abc', ' 30 ', '99999999999999999999'])(
    'rechaza TTL inválidos: %j',
    (value) => {
      expect(() => readConfig({ SESSION_TTL_MINUTES: value })).toThrow(
        'SESSION_TTL_MINUTES',
      );
      expect(() => readConfig({ FINISHED_SESSION_TTL_MINUTES: value })).toThrow(
        'FINISHED_SESSION_TTL_MINUTES',
      );
    },
  );
});
