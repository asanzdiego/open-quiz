import { readNextcloudConfig, type NextcloudConfig } from './nextcloud.ts';

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  nextcloud: NextcloudConfig | undefined;
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

  return { port, nodeEnv, nextcloud: readNextcloudConfig(env) };
}
