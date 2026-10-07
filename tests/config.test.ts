import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config/env.ts';

describe('Configuración', () => {
  it('utiliza los valores predeterminados sin variables de entorno', () => {
    expect(readConfig({})).toEqual({
      port: 3000,
      nodeEnv: 'development',
      nextcloud: undefined,
      publicOrigin: undefined,
      maxConnections: 1000,
      maxSessions: 50,
      maxParticipantsPerSession: 100,
      questionDurationMs: 20_000,
      maxPointsPerQuestion: 1000,
      sessionTtlMs: 120 * 60_000,
      finishedSessionTtlMs: 30 * 60_000,
    });
  });

  it('utiliza el puerto y el entorno proporcionados', () => {
    expect(readConfig({ PORT: '8080', NODE_ENV: 'production' })).toEqual({
      port: 8080,
      nodeEnv: 'production',
      nextcloud: undefined,
      publicOrigin: undefined,
      maxConnections: 1000,
      maxSessions: 50,
      maxParticipantsPerSession: 100,
      questionDurationMs: 20_000,
      maxPointsPerQuestion: 1000,
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

  it('lee los tiempos y puntos del juego', () => {
    expect(
      readConfig({
        DEFAULT_QUESTION_DURATION_SECONDS: '45',
        MAX_POINTS_PER_QUESTION: '2000',
      }),
    ).toMatchObject({ questionDurationMs: 45_000, maxPointsPerQuestion: 2000 });
  });

  it.each(['', '0', '-1', '1.5', 'abc', ' 20 ', '3601', '999999999999'])(
    'rechaza la duración inválida %j',
    (value) => {
      expect(() =>
        readConfig({ DEFAULT_QUESTION_DURATION_SECONDS: value }),
      ).toThrow('DEFAULT_QUESTION_DURATION_SECONDS');
    },
  );
  it.each(['', '0', '-1', '1.5', 'abc', ' 1000 ', '1000001', '999999999999'])(
    'rechaza los puntos inválidos %j',
    (value) => {
      expect(() => readConfig({ MAX_POINTS_PER_QUESTION: value })).toThrow(
        'MAX_POINTS_PER_QUESTION',
      );
    },
  );

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
  it('lee capacidades y un origen explícito', () => {
    expect(
      readConfig({
        MAX_ACTIVE_SESSIONS: '3',
        MAX_PARTICIPANTS_PER_SESSION: '40',
        PUBLIC_ORIGIN: 'https://quiz.example.com',
      }),
    ).toMatchObject({
      maxSessions: 3,
      maxParticipantsPerSession: 40,
      publicOrigin: 'https://quiz.example.com',
    });
  });

  it.each(['0', '-1', '1.5', '10001', 'abc'])(
    'rechaza el límite de conexiones inválido %j',
    (value) => {
      expect(() => readConfig({ MAX_CONNECTIONS: value })).toThrow(
        'MAX_CONNECTIONS',
      );
    },
  );
  it.each(['0', '-1', '1.5', '1001', 'abc'])(
    'rechaza capacidades inválidas %j',
    (value) => {
      for (const name of [
        'MAX_ACTIVE_SESSIONS',
        'MAX_PARTICIPANTS_PER_SESSION',
      ])
        expect(() => readConfig({ [name]: value })).toThrow(name);
    },
  );
  it.each([
    '',
    '*',
    'https://quiz.example.com/',
    'https://user:secret@quiz.example.com',
    'https://quiz.example.com?secret=1',
    'file:///tmp',
    'https://quiz.example.com/path',
  ])('rechaza orígenes inválidos sin mostrar su valor %j', (value) => {
    expect(() => readConfig({ PUBLIC_ORIGIN: value })).toThrow('PUBLIC_ORIGIN');
    try {
      readConfig({ PUBLIC_ORIGIN: value });
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
});
