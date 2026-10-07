import { readNextcloudConfig, type NextcloudConfig } from './nextcloud.ts';

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  nextcloud: NextcloudConfig | undefined;
  sessionTtlMs: number;
  finishedSessionTtlMs: number;
  questionDurationMs: number;
  maxPointsPerQuestion: number;
  maxSessions: number;
  maxParticipantsPerSession: number;
  publicOrigin: string | undefined;
  maxConnections: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);

  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }

  const nodeEnv = env.NODE_ENV ?? 'development';

  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }

  return {
    port,
    nodeEnv,
    nextcloud: readNextcloudConfig(env),
    publicOrigin: readPublicOrigin(env.PUBLIC_ORIGIN),
    maxConnections: readInteger(
      env.MAX_CONNECTIONS ?? '1000',
      'MAX_CONNECTIONS',
      1,
      10_000,
    ),
    maxSessions: readInteger(
      env.MAX_ACTIVE_SESSIONS ?? '50',
      'MAX_ACTIVE_SESSIONS',
      1,
      1000,
    ),
    maxParticipantsPerSession: readInteger(
      env.MAX_PARTICIPANTS_PER_SESSION ?? '100',
      'MAX_PARTICIPANTS_PER_SESSION',
      1,
      1000,
    ),
    questionDurationMs:
      readInteger(
        env.DEFAULT_QUESTION_DURATION_SECONDS ?? '20',
        'DEFAULT_QUESTION_DURATION_SECONDS',
        1,
        3600,
      ) * 1000,
    maxPointsPerQuestion: readInteger(
      env.MAX_POINTS_PER_QUESTION ?? '1000',
      'MAX_POINTS_PER_QUESTION',
      1,
      1_000_000,
    ),
    sessionTtlMs: readTtl(
      env.SESSION_TTL_MINUTES ?? '120',
      'SESSION_TTL_MINUTES',
    ),
    finishedSessionTtlMs: readTtl(
      env.FINISHED_SESSION_TTL_MINUTES ?? '30',
      'FINISHED_SESSION_TTL_MINUTES',
    ),
  };
}

function readInteger(
  raw: string,
  name: string,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  if (
    !/^\d+$/u.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  return value;
}

function readTtl(raw: string, name: string): number {
  const milliseconds = Number(raw) * 60_000;
  if (
    !/^\d+$/u.test(raw) ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds <= 0
  ) {
    throw new Error(`${name} debe ser un entero positivo de minutos.`);
  }
  return milliseconds;
}

function readPublicOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    if (raw === url.origin && ['http:', 'https:'].includes(url.protocol))
      return raw;
  } catch {
    /* El error de configuración no incluye valores. */
  }
  throw new Error(
    'PUBLIC_ORIGIN debe ser un origen HTTP/HTTPS sin ruta, credenciales, parámetros ni fragmentos.',
  );
}
