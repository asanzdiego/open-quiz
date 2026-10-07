/** Contrato del backend. La referencia es una ruta de fichero, nunca una URL con secretos. */
export interface WorkbookStorage {
  downloadWorkbook(reference: string): Promise<Buffer>;
  /** Lectura versionada opcional para adaptadores capaces de escrituras condicionales. */
  downloadWorkbookSnapshot?(reference: string): Promise<WorkbookSnapshot>;
  uploadWorkbook(
    reference: string,
    data: Buffer,
    options?: WorkbookUploadOptions,
  ): Promise<void>;
}

export interface WorkbookSnapshot {
  data: Buffer;
  version: string;
}

export interface WorkbookUploadOptions {
  expectedVersion: string;
}
