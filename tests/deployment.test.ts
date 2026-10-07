import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/app.ts';

const run = promisify(execFile);
const healthcheck = fileURLToPath(
  new URL('../scripts/healthcheck.mjs', import.meta.url),
);

describe('Health check del contenedor', () => {
  const application = createApplication();
  let port: number;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      application.httpServer.once('error', reject);
      application.httpServer.listen(0, '127.0.0.1', () => {
        application.httpServer.removeListener('error', reject);
        resolve();
      });
    });
    port = (application.httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => application.io.close(() => resolve()));
  });

  it('comprueba /health en el PORT configurado y termina con código 0 sin logs', async () => {
    const result = await run(process.execPath, [healthcheck], {
      env: { PORT: String(port) },
      timeout: 5000,
    });
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it.each([
    [503, '{"status":"ok"}'],
    [200, '{"status":"error"}'],
    [200, 'no es JSON'],
  ])('falla con código 1 ante HTTP %i y %s', async (status, body) => {
    const server = createServer((_request, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      await expect(
        run(process.execPath, [healthcheck], {
          env: { PORT: String((server.address() as AddressInfo).port) },
          timeout: 5000,
        }),
      ).rejects.toMatchObject({ code: 1, stdout: '', stderr: '' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
