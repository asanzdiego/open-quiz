import ExcelJS from 'exceljs';
import type { RoundResult } from '../domain/question/round.ts';
import { ExcelResultsError } from './excel-results-error.ts';
import { ExcelImportError } from './excel-import-error.ts';
import { validateWorkbookArchive } from './workbook-limits.ts';

export const RESULT_HEADERS = [
  'Nick',
  'Acertada',
  'Tiempo',
  'Puntos pregunta',
  'Puntos totales',
] as const;

/** Añade una hoja al libro actual sin modificar las hojas existentes ni el Buffer. */
export async function writeQuestionResults(
  data: Buffer,
  result: RoundResult,
): Promise<Buffer> {
  if (!Number.isSafeInteger(result.questionNumber) || result.questionNumber < 1)
    throw new RangeError('El número de pregunta debe ser un entero positivo.');
  const name = `P${String(result.questionNumber).padStart(2, '0')}`;
  const workbook = new ExcelJS.Workbook();
  try {
    validateWorkbookArchive(data);
    await workbook.xlsx.load(Uint8Array.from(data).buffer);
  } catch (error) {
    if (
      error instanceof ExcelImportError &&
      error.code === 'WORKBOOK_TOO_LARGE'
    )
      throw new ExcelResultsError(error.code, error.message);
    throw new ExcelResultsError(
      'INVALID_WORKBOOK',
      'No se han podido guardar los resultados: el fichero no es un libro XLSX válido.',
    );
  }
  // Excel no distingue mayúsculas y minúsculas en los nombres de sus hojas.
  if (workbook.worksheets.some((sheet) => sheet.name.toUpperCase() === name))
    throw new ExcelResultsError(
      'RESULT_SHEET_EXISTS',
      `No se han guardado los resultados: la hoja ${name} ya existe. Renómbrala o retírala en Nextcloud y reintenta el guardado.`,
    );

  const sheet = workbook.addWorksheet(name);
  sheet.addRow([...RESULT_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 26 : 20;
    if (index >= 2) column.numFmt = '0';
  });
  // Tiempo en milisegundos del servidor, también para participantes sin respuesta.
  for (const entry of result.participants)
    sheet.addRow([
      entry.nick,
      entry.isCorrect ? 'Sí' : 'No',
      entry.elapsedMs,
      entry.points,
      entry.totalPoints,
    ]);

  try {
    return Buffer.from(await workbook.xlsx.writeBuffer());
  } catch {
    throw new ExcelResultsError(
      'RESULT_SERIALIZATION_FAILED',
      'No se ha podido generar el XLSX con los resultados. Reintenta el guardado.',
    );
  }
}
