import type { SessionWorkbook } from '../domain/session/session.ts';
import { importQuestions } from '../excel/import-questions.ts';
import { normalizeWorkbookReference } from './workbook-reference.ts';
import { WorkbookStorageError } from './workbook-storage-error.ts';
import type { WorkbookStorage } from './workbook-storage.ts';

/** Solo lee. La sesión se crea después de validar el libro y confirmar la conexión. */
export async function loadSessionWorkbook(
  storage: WorkbookStorage | undefined,
  reference: string,
): Promise<SessionWorkbook> {
  const normalizedReference = normalizeWorkbookReference(reference);
  if (!storage) throw new WorkbookStorageError('STORAGE_NOT_CONFIGURED');
  const buffer = await storage.downloadWorkbook(normalizedReference);
  const { questions } = await importQuestions(buffer);
  return { reference: normalizedReference, questions };
}
