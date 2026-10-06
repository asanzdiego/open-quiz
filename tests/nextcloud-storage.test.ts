import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import type { WebDAVClient } from 'webdav';
import { describe, expect, it, vi } from 'vitest';
import type { NextcloudConfig } from '../src/config/nextcloud.ts';
import { NextcloudWebDavWorkbookStorage } from '../src/nextcloud/nextcloud-webdav-workbook-storage.ts';
import { WorkbookStorageError } from '../src/services/workbook-storage-error.ts';
import { importQuestions } from '../src/excel/import-questions.ts';
import { InMemoryWorkbookStorage } from './helpers/in-memory-workbook-storage.ts';

const config: NextcloudConfig = {
  webdavUrl: 'https://cloud.example.com/remote.php/dav/files/docente/',
  username: 'docente',
  appPassword: 'solo-para-tests',
  requestTimeoutMs: 15000,
};

function setup() {
  const client = {
    getFileContents: vi
      .fn<WebDAVClient['getFileContents']>()
      .mockResolvedValue(Buffer.from('libro')),
    putFileContents: vi
      .fn<WebDAVClient['putFileContents']>()
      .mockResolvedValue(true),
  };
  return {
    client,
    storage: new NextcloudWebDavWorkbookStorage(config, client),
  };
}

describe('NextcloudWebDavWorkbookStorage con cliente simulado', () => {
  it.each([
    Buffer.from('libro'),
    Uint8Array.from([0, 1, 255]),
    Uint8Array.from([1, 2]).buffer,
  ])(
    'descarga datos binarios como Buffer sin compartir memoria con el cliente (%#)',
    async (contents) => {
      const { storage, client } = setup();
      client.getFileContents.mockResolvedValue(contents);
      const data = await storage.downloadWorkbook('Quiz/Matemáticas 1.xlsx');
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(data).toEqual(
        Buffer.from(
          contents instanceof ArrayBuffer ? new Uint8Array(contents) : contents,
        ),
      );
      data.fill(42);
      expect(data).not.toEqual(
        Buffer.from(
          contents instanceof ArrayBuffer ? new Uint8Array(contents) : contents,
        ),
      );
      expect(client.getFileContents).toHaveBeenCalledExactlyOnceWith(
        '/Quiz/Matemáticas 1.xlsx',
        {
          format: 'binary',
          signal: expect.any(AbortSignal),
        },
      );
    },
  );

  it('sube el Buffer al mismo fichero con MIME XLSX y tamaño explícito', async () => {
    const { storage, client } = setup();
    const data = Buffer.from([0, 255, 42]);
    await expect(
      storage.uploadWorkbook('/Quiz/libro.xlsx', data),
    ).resolves.toBeUndefined();
    expect(client.putFileContents).toHaveBeenCalledExactlyOnceWith(
      '/Quiz/libro.xlsx',
      data,
      {
        overwrite: true,
        contentLength: data.length,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        signal: expect.any(AbortSignal),
      },
    );
    expect(client.getFileContents).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '/',
    '//host/libro.xlsx',
    '../libro.xlsx',
    'Quiz/../libro.xlsx',
    './libro.xlsx',
    'Quiz//libro.xlsx',
    'Quiz/./libro.xlsx',
    'Quiz\\libro.xlsx',
    'Quiz/libro.csv',
    'Quiz/libro.ods',
    'https://otro.example.com/libro.xlsx',
    'libro.xlsx?token=secreto',
    'libro.xlsx#fragmento',
    'Quiz/\u0000libro.xlsx',
    '\nlibro.xlsx',
    'a'.repeat(1025) + '.xlsx',
  ])(
    'rechaza referencias inválidas antes de cualquier acceso (%#)',
    async (reference) => {
      const { storage, client } = setup();
      await expect(storage.downloadWorkbook(reference)).rejects.toMatchObject({
        code: 'INVALID_REFERENCE',
      });
      await expect(
        storage.uploadWorkbook(reference, Buffer.from('libro')),
      ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
      expect(client.getFileContents).not.toHaveBeenCalled();
      expect(client.putFileContents).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Quiz/prueba.XLSX', '/Quiz/prueba.XLSX'],
    ['  Quiz/prueba.xlsx  ', '/Quiz/prueba.xlsx'],
    ['Quiz/50% #1?.xlsx', '/Quiz/50% #1?.xlsx'],
  ])('admite rutas literales %j', async (reference, expected) => {
    const { storage, client } = setup();
    await storage.downloadWorkbook(reference);
    expect(client.getFileContents).toHaveBeenCalledWith(
      expected,
      expect.any(Object),
    );
  });

  it.each([
    'texto',
    Buffer.alloc(0),
    { data: Buffer.from('libro'), status: 200, statusText: 'OK', headers: {} },
  ])('rechaza respuestas de formato inesperado (%#)', async (contents) => {
    const { storage, client } = setup();
    client.getFileContents.mockResolvedValue(contents);
    await expect(storage.downloadWorkbook('libro.xlsx')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rechaza un Buffer vacío antes de subirlo y detecta una subida no confirmada', async () => {
    const { storage, client } = setup();
    await expect(
      storage.uploadWorkbook('libro.xlsx', Buffer.alloc(0)),
    ).rejects.toMatchObject({ code: 'INVALID_DATA' });
    expect(client.putFileContents).not.toHaveBeenCalled();
    client.putFileContents.mockResolvedValue(false);
    await expect(
      storage.uploadWorkbook('libro.xlsx', Buffer.from('libro')),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
  });

  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'WORKBOOK_NOT_FOUND'],
    [409, 'CONFLICT'],
    [423, 'WORKBOOK_LOCKED'],
    [507, 'QUOTA_EXCEEDED'],
    [408, 'REQUEST_TIMEOUT'],
    [504, 'REQUEST_TIMEOUT'],
  ])(
    'convierte el estado %i en un error seguro para lectura y escritura',
    async (status, code) => {
      const { storage, client } = setup();
      const error = Object.assign(
        new Error(
          'Authorization: Basic secreto; https://usuario:secreto@cloud.example.com/',
        ),
        { status },
      );
      client.getFileContents.mockRejectedValue(error);
      client.putFileContents.mockRejectedValue(error);
      for (const operation of [
        () => storage.downloadWorkbook('libro.xlsx'),
        () => storage.uploadWorkbook('libro.xlsx', Buffer.from('libro')),
      ]) {
        const failure = await operation().catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(WorkbookStorageError);
        expect(failure).toMatchObject({ code });
        expect(failure).not.toHaveProperty('cause');
        expect(inspect(failure)).not.toMatch(
          /Authorization|secreto|cloud\.example\.com/u,
        );
      }
    },
  );

  it('oculta errores de red y fallos remotos sin registrar detalles ni credenciales', async () => {
    const { storage, client } = setup();
    client.getFileContents.mockRejectedValue(
      new Error('ENOTFOUND https://usuario:secreto@host'),
    );
    client.putFileContents.mockRejectedValue({
      status: 500,
      response: { password: 'secreto' },
    });
    await expect(storage.downloadWorkbook('libro.xlsx')).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
    await expect(
      storage.uploadWorkbook('libro.xlsx', Buffer.from('libro')),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(JSON.stringify(storage)).toBe('{}');
    expect(inspect(storage)).not.toContain(config.appPassword);
  });
});

describe('Mock de WorkbookStorage para servicios', () => {
  it('permite importar un XLSX sin red y mantiene aislados los libros y los Buffers', async () => {
    const storage = new InMemoryWorkbookStorage();
    const data = await readFile(
      new URL('./fixtures/excel/valid-header.xlsx', import.meta.url),
    );
    await storage.uploadWorkbook('Quiz/uno.xlsx', data);
    data.fill(0);
    const downloaded = await storage.downloadWorkbook('Quiz/uno.xlsx');
    expect(
      (await importQuestions(downloaded)).questions.length,
    ).toBeGreaterThan(0);
    downloaded.fill(0);
    expect(
      (await importQuestions(await storage.downloadWorkbook('Quiz/uno.xlsx')))
        .questions.length,
    ).toBeGreaterThan(0);
    await expect(
      storage.downloadWorkbook('Quiz/otro.xlsx'),
    ).rejects.toMatchObject({ code: 'WORKBOOK_NOT_FOUND' });
  });
});
