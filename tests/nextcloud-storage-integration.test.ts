import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NextcloudConfig } from '../src/config/nextcloud.ts';
import { importQuestions } from '../src/excel/import-questions.ts';
import { NextcloudWebDavWorkbookStorage } from '../src/nextcloud/nextcloud-webdav-workbook-storage.ts';

const run = promisify(execFile);
const root = '/nextcloud/remote.php/dav/files/docente';
const reference = 'Quiz/Matemáticas 50% #1?.xlsx';

interface ObservedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  contentType: string | undefined;
  contentLength: string | undefined;
  expectedVersion: string | undefined;
}

describe('Cliente WebDAV real contra un servidor HTTP local', () => {
  let config: NextcloudConfig;
  let fixture: Buffer;
  let stored: Buffer;
  let version: number;
  const requests: ObservedRequest[] = [];
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      contentLength: request.headers['content-length'],
      expectedVersion: request.headers['if-match'],
    });

    if (request.url?.endsWith('/timeout-headers.xlsx')) return;
    if (request.url?.endsWith('/timeout-body.xlsx')) {
      response.writeHead(200);
      response.write(Buffer.from([0, 1, 2]));
      return;
    }
    if (request.url?.endsWith('/denied.xlsx')) {
      response.writeHead(401, 'Error remoto con contraseña solo-para-tests');
      response.end('Detalles privados del servidor.');
      return;
    }
    if (request.url?.endsWith('/read-only.xlsx') && request.method === 'PUT') {
      response.writeHead(403).end();
      return;
    }
    if (request.url?.endsWith('/large.xlsx')) {
      response.writeHead(200);
      response.end(Buffer.alloc(10 * 1024 * 1024 + 1));
      return;
    }
    if (decodeURIComponent(request.url ?? '') !== `${root}/${reference}`) {
      response.writeHead(404).end();
      return;
    }

    if (request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ETag: `"v${version}"`,
      });
      response.end(stored);
    } else if (request.method === 'PUT') {
      if (
        request.headers['if-match'] &&
        request.headers['if-match'] !== `"v${version}"`
      ) {
        response.writeHead(412).end();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        stored = Buffer.concat(chunks);
        version += 1;
        response.writeHead(204).end();
      } catch {
        response.destroy();
      }
    } else {
      response.writeHead(405).end();
    }
  });

  beforeAll(async () => {
    fixture = await readFile(
      new URL('./fixtures/excel/valid-header.xlsx', import.meta.url),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    config = {
      webdavUrl: `http://127.0.0.1:${address.port}${root}/`,
      username: 'docente',
      appPassword: 'solo-para-tests',
      requestTimeoutMs: 15000,
    };
  });

  beforeEach(() => {
    stored = Buffer.from(fixture);
    version = 1;
    requests.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  });

  it('autentica GET/PUT, codifica la ruta y conserva los bytes del XLSX en memoria', async () => {
    const storage = new NextcloudWebDavWorkbookStorage(config);
    const downloaded = await storage.downloadWorkbook(reference);
    expect(downloaded).toEqual(fixture);
    expect(
      (await importQuestions(downloaded)).questions.length,
    ).toBeGreaterThan(0);
    await storage.uploadWorkbook(reference, downloaded);
    expect(stored).toEqual(fixture);
    expect(await storage.downloadWorkbook(reference)).toEqual(fixture);
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'PUT',
      'GET',
    ]);
    const encodedPath = `${root}/Quiz/Matem%C3%A1ticas%2050%25%20%231%3F.xlsx`;
    const authorization = `Basic ${Buffer.from(`${config.username}:${config.appPassword}`).toString('base64')}`;
    for (const request of requests) {
      expect(request.url).toBe(encodedPath);
      expect(request.authorization).toBe(authorization);
    }
    expect(requests[1]).toMatchObject({
      contentLength: String(fixture.length),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  it('traduce errores reales del cliente sin exponer mensajes del servidor', async () => {
    const storage = new NextcloudWebDavWorkbookStorage(config);
    await expect(
      storage.downloadWorkbook('missing.xlsx'),
    ).rejects.toMatchObject({ code: 'WORKBOOK_NOT_FOUND' });
    const error = await storage
      .downloadWorkbook('denied.xlsx')
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(String(error)).not.toContain(config.appPassword);
    expect(error).not.toHaveProperty('cause');
    await expect(
      storage.uploadWorkbook('read-only.xlsx', fixture),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rechaza una versión antigua con HTTP 412 y permite descargar y reintentar sin perder cambios', async () => {
    const storage = new NextcloudWebDavWorkbookStorage(config);
    const previous = await storage.downloadWorkbookSnapshot(reference);
    expect(previous.version).toBe('"v1"');
    stored = Buffer.from('Cambio externo');
    version += 1;
    await expect(
      storage.uploadWorkbook(reference, previous.data, {
        expectedVersion: previous.version,
      }),
    ).rejects.toMatchObject({ code: 'WORKBOOK_CHANGED' });
    expect(stored.toString()).toBe('Cambio externo');
    const current = await storage.downloadWorkbookSnapshot(reference);
    await storage.uploadWorkbook(reference, current.data, {
      expectedVersion: current.version,
    });
    expect(stored.toString()).toBe('Cambio externo');
    expect(
      requests
        .filter((request) => request.method === 'PUT')
        .map((request) => request.expectedVersion),
    ).toEqual(['"v1"', '"v2"']);
  });

  it('cancela una descarga HTTP real que excede el límite', async () => {
    const storage = new NextcloudWebDavWorkbookStorage(config);
    await expect(storage.downloadWorkbook('large.xlsx')).rejects.toMatchObject({
      code: 'WORKBOOK_TOO_LARGE',
    });
  });

  it.each(['timeout-headers.xlsx', 'timeout-body.xlsx'])(
    'cancela una descarga bloqueada durante %s',
    async (path) => {
      const storage = new NextcloudWebDavWorkbookStorage({
        ...config,
        requestTimeoutMs: 50,
      });
      await expect(storage.downloadWorkbook(path)).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT',
      });
    },
  );

  it('cancela una subida que no recibe respuesta', async () => {
    const storage = new NextcloudWebDavWorkbookStorage({
      ...config,
      requestTimeoutMs: 50,
    });
    await expect(
      storage.uploadWorkbook('timeout-headers.xlsx', fixture),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it.each([undefined, '--write-back'])(
    'ejecuta el comando de prueba manual con opción %j',
    async (option) => {
      const args = ['scripts/check-nextcloud.ts', reference];
      if (option) args.push(option);
      const { stdout, stderr } = await run(process.execPath, args, {
        cwd: new URL('../', import.meta.url),
        env: {
          ...process.env,
          NEXTCLOUD_WEBDAV_URL: config.webdavUrl,
          NEXTCLOUD_USERNAME: config.username,
          NEXTCLOUD_APP_PASSWORD: config.appPassword,
          NEXTCLOUD_REQUEST_TIMEOUT_MS: '15000',
        },
      });
      expect(stdout).toContain('nextcloud_download_verified');
      expect(stderr).toBe('');
      expect(stdout).not.toContain(config.appPassword);
      expect(stdout).not.toContain(config.webdavUrl);
      expect(requests.map((request) => request.method)).toEqual(
        option ? ['GET', 'PUT', 'GET'] : ['GET'],
      );
      if (option) expect(stdout).toContain('nextcloud_upload_verified');
      expect(stored).toEqual(fixture);
    },
  );
});
