import { readNextcloudConfig, type NextcloudConfig } from './nextcloud.ts';

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  nextcloud: NextcloudConfig | undefined;
  sessionTtlMs: number;
  finishedSessionTtlMs: number;
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
