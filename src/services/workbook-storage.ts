/** Contrato del backend. La referencia es una ruta de fichero, nunca una URL con secretos. */
export interface WorkbookStorage {
  downloadWorkbook(reference: string): Promise<Buffer>;
  uploadWorkbook(reference: string, data: Buffer): Promise<void>;
}
