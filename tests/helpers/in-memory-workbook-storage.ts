import type { WorkbookStorage } from '../../src/services/workbook-storage.ts';
import { WorkbookStorageError } from '../../src/services/workbook-storage-error.ts';

/** Almacenamiento simulado para probar servicios sin red ni Nextcloud. */
export class InMemoryWorkbookStorage implements WorkbookStorage {
  #workbooks = new Map<string, Buffer>();

  async downloadWorkbook(reference: string): Promise<Buffer> {
    const data = this.#workbooks.get(reference);
    if (!data) throw new WorkbookStorageError('WORKBOOK_NOT_FOUND');
    return Buffer.from(data);
  }

  async uploadWorkbook(reference: string, data: Buffer): Promise<void> {
    this.#workbooks.set(reference, Buffer.from(data));
  }
}
