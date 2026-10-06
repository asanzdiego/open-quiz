import { WorkbookStorageError } from './workbook-storage-error.ts';

/** Ruta literal dentro de la cuenta configurada; nunca una URL ni una ruta local. */
export function normalizeWorkbookReference(reference: string): string {
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
  return path;
}
