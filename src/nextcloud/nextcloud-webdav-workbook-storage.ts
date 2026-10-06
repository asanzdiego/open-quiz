import { AuthType, createClient, type WebDAVClient } from 'webdav';
import {
  validateNextcloudConfig,
  type NextcloudConfig,
} from '../config/nextcloud.ts';
import type { WorkbookStorage } from '../services/workbook-storage.ts';
import { WorkbookStorageError } from '../services/workbook-storage-error.ts';

type WorkbookWebDavClient = Pick<
  WebDAVClient,
  'getFileContents' | 'putFileContents'
>;

function workbookPath(reference: string): string {
  if (typeof reference !== 'string' || /[\\:\p{Cc}]/u.test(reference)) {
    throw new WorkbookStorageError('INVALID_REFERENCE');
  }
  const path = reference.trim().replace(/^\//u, '');
  if (
    path.length === 0 ||
    path.length > 1024 ||
    !/\.xlsx$/iu.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new WorkbookStorageError('INVALID_REFERENCE');
  }
  // El cliente WebDAV codifica cada segmento. No decodificar ni tratar la referencia como URL.
  return `/${path}`;
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

export class NextcloudWebDavWorkbookStorage implements WorkbookStorage {
  // Campos privados de JavaScript: ni el cliente autenticado ni sus cabeceras son serializables.
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
    const path = workbookPath(reference);
    const signal = AbortSignal.timeout(this.#requestTimeoutMs);
    try {
      const contents = await this.#client.getFileContents(path, {
        format: 'binary',
        signal,
      });
      if (
        !(contents instanceof Uint8Array) &&
        !(contents instanceof ArrayBuffer)
      ) {
        throw new WorkbookStorageError('INVALID_RESPONSE');
      }
      const data =
        contents instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(contents))
          : Buffer.from(contents);
      if (data.length === 0) throw new WorkbookStorageError('INVALID_RESPONSE');
      return data;
    } catch (error) {
      throw storageError(error, 'download', signal);
    }
  }

  async uploadWorkbook(reference: string, data: Buffer): Promise<void> {
    const path = workbookPath(reference);
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new WorkbookStorageError('INVALID_DATA');
    }
    const signal = AbortSignal.timeout(this.#requestTimeoutMs);
    try {
      const uploaded = await this.#client.putFileContents(path, data, {
        overwrite: true,
        contentLength: data.length,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        signal,
      });
      if (!uploaded) throw new WorkbookStorageError('UPLOAD_FAILED');
    } catch (error) {
      throw storageError(error, 'upload', signal);
    }
  }
}
