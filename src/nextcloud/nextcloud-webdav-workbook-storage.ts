import { type Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AuthType, createClient, type WebDAVClient } from 'webdav';
import {
  validateNextcloudConfig,
  type NextcloudConfig,
} from '../config/nextcloud.ts';
import { MAX_WORKBOOK_BYTES } from '../excel/workbook-limits.ts';
import type {
  WorkbookStorage,
  WorkbookSnapshot,
  WorkbookUploadOptions,
} from '../services/workbook-storage.ts';
import { WorkbookStorageError } from '../services/workbook-storage-error.ts';
import { normalizeWorkbookReference } from '../services/workbook-reference.ts';

type WorkbookWebDavClient = Pick<
  WebDAVClient,
  'createReadStream' | 'putFileContents'
>;

function workbookPath(reference: string): string {
  // El cliente codifica cada segmento. Nunca interpretar referencias como URLs.
  return `/${normalizeWorkbookReference(reference)}`;
}

function storageError(
  error: unknown,
  operation: 'download' | 'upload',
  signal: AbortSignal,
): WorkbookStorageError {
  if (error instanceof WorkbookStorageError) return error;
  if (signal.aborted) return new WorkbookStorageError('REQUEST_TIMEOUT');
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? error.status
      : undefined;
  switch (status) {
    case 401:
      return new WorkbookStorageError('AUTHENTICATION_FAILED');
    case 403:
      return new WorkbookStorageError('PERMISSION_DENIED');
    case 404:
      return new WorkbookStorageError('WORKBOOK_NOT_FOUND');
    case 409:
      return new WorkbookStorageError('CONFLICT');
    case 412:
      return new WorkbookStorageError('WORKBOOK_CHANGED');
    case 423:
      return new WorkbookStorageError('WORKBOOK_LOCKED');
    case 507:
      return new WorkbookStorageError('QUOTA_EXCEEDED');
    case 408:
    case 504:
      return new WorkbookStorageError('REQUEST_TIMEOUT');
    default:
      return new WorkbookStorageError(
        operation === 'download' ? 'DOWNLOAD_FAILED' : 'UPLOAD_FAILED',
      );
  }
}

function validVersion(value: string | null): value is string {
  // If-Match exige un ETag fuerte; nunca enviar un comodín o controles como cabecera.
  return (
    value !== null && value.length <= 512 && /^"[^"\p{Cc}]+"$/u.test(value)
  );
}

export class NextcloudWebDavWorkbookStorage implements WorkbookStorage {
  #client: WorkbookWebDavClient;
  #requestTimeoutMs: number;

  constructor(config: NextcloudConfig, client?: WorkbookWebDavClient) {
    const validated = validateNextcloudConfig(config);
    this.#requestTimeoutMs = validated.requestTimeoutMs;
    this.#client =
      client ??
      createClient(validated.webdavUrl, {
        authType: AuthType.Password,
        username: validated.username,
        password: validated.appPassword,
      });
  }

  async downloadWorkbook(reference: string): Promise<Buffer> {
    return (await this.#download(reference)).data;
  }

  async downloadWorkbookSnapshot(reference: string): Promise<WorkbookSnapshot> {
    const { data, version } = await this.#download(reference);
    if (!validVersion(version))
      throw new WorkbookStorageError('VERSION_UNAVAILABLE');
    return { data, version };
  }

  async #download(
    reference: string,
  ): Promise<{ data: Buffer; version: string | null }> {
    const path = workbookPath(reference);
    const timeout = AbortSignal.timeout(this.#requestTimeoutMs);
    const controller = new AbortController();
    const signal = AbortSignal.any([timeout, controller.signal]);
    const chunks: Buffer[] = [];
    let length = 0;
    let resolveVersion!: (version: string | null) => void;
    const version = new Promise<string | null>((resolve) => {
      resolveVersion = resolve;
    });
    try {
      const stream = this.#client.createReadStream(path, {
        signal,
        callback: (response) => resolveVersion(response.headers.get('etag')),
      });
      const collect = new Writable({
        write(chunk: Buffer, _encoding, done) {
          length += chunk.length;
          if (length > MAX_WORKBOOK_BYTES) {
            done(new WorkbookStorageError('WORKBOOK_TOO_LARGE'));
            return;
          }
          chunks.push(Buffer.from(chunk));
          done();
        },
      });
      // pipeline cancela stream y colector al vencer el plazo, incluso si faltan cabeceras.
      await pipeline(stream as Readable, collect, { signal });
      if (length === 0) throw new WorkbookStorageError('INVALID_RESPONSE');
      return { data: Buffer.concat(chunks, length), version: await version };
    } catch (error) {
      controller.abort();
      throw storageError(error, 'download', timeout);
    }
  }

  async uploadWorkbook(
    reference: string,
    data: Buffer,
    options?: WorkbookUploadOptions,
  ): Promise<void> {
    const path = workbookPath(reference);
    if (!Buffer.isBuffer(data) || data.length === 0)
      throw new WorkbookStorageError('INVALID_DATA');
    if (data.length > MAX_WORKBOOK_BYTES)
      throw new WorkbookStorageError('WORKBOOK_TOO_LARGE');
    if (options && !validVersion(options.expectedVersion))
      throw new WorkbookStorageError('VERSION_UNAVAILABLE');
    const signal = AbortSignal.timeout(this.#requestTimeoutMs);
    try {
      const uploaded = await this.#client.putFileContents(path, data, {
        overwrite: true,
        contentLength: data.length,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ...(options ? { 'If-Match': options.expectedVersion } : {}),
        },
        signal,
      });
      if (!uploaded) throw new WorkbookStorageError('UPLOAD_FAILED');
    } catch (error) {
      throw storageError(error, 'upload', signal);
    }
  }
}
