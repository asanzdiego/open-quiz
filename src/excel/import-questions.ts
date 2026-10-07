import { randomUUID } from 'node:crypto';
import ExcelJS, { type Cell, type CellValue, type Row } from 'exceljs';
import type { Question } from '../domain/question/question.ts';
import { ExcelImportError } from './excel-import-error.ts';
import {
  validateWorkbookArchive,
  MAX_QUESTIONS,
  MAX_QUESTION_TEXT_LENGTH,
  MAX_ANSWER_TEXT_LENGTH,
} from './workbook-limits.ts';

export const QUESTION_HEADERS = [
  'Pregunta',
  'Respuesta correcta',
  'Respuesta incorrecta 1',
  'Respuesta incorrecta 2',
  'Respuesta incorrecta 3',
] as const;

export interface ImportQuestionsOptions {
  worksheetName?: string;
  headerMode?: 'auto' | 'present' | 'absent';
}

export interface ImportedQuestions {
  worksheetName: string;
  hasHeader: boolean;
  questions: Question[];
}

type QuestionRow = readonly [string, string, string, string, string];

function isBlank(value: CellValue): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'object' && 'richText' in value) {
    return (
      value.richText
        .map((part) => part.text)
        .join('')
        .trim().length === 0
    );
  }
  return false;
}

function readCellText(cell: Cell): string {
  const location = { worksheetName: cell.worksheet.name, cell: cell.address };
  if (cell.isMerged) {
    throw new ExcelImportError(
      'UNSUPPORTED_LAYOUT',
      `La celda ${cell.address} está combinada. Cada pregunta debe ocupar una fila con cinco celdas independientes.`,
      location,
    );
  }

  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().normalize('NFC');
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      throw new ExcelImportError(
        'FORMULA_NOT_SUPPORTED',
        `La celda ${cell.address} contiene una fórmula. Utiliza un valor literal.`,
        location,
      );
    }
    if ('richText' in value) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim()
        .normalize('NFC');
    }
  }

  throw new ExcelImportError(
    'UNSUPPORTED_CELL',
    `La celda ${cell.address} debe contener texto o un número, sin fechas, valores lógicos, enlaces ni errores de Excel.`,
    location,
  );
}

function readRow(row: Row): QuestionRow | undefined {
  row.eachCell((cell, column) => {
    if (column > 5 && !isBlank(cell.value)) {
      throw new ExcelImportError(
        'INVALID_ROW',
        `La celda ${cell.address} contiene datos fuera de las cinco columnas A–E.`,
        { worksheetName: row.worksheet.name, cell: cell.address },
      );
    }
  });

  const cells = [
    row.getCell(1),
    row.getCell(2),
    row.getCell(3),
    row.getCell(4),
    row.getCell(5),
  ] as const;
  if (cells.every((cell) => isBlank(cell.value))) return undefined;

  return [
    readCellText(cells[0]),
    readCellText(cells[1]),
    readCellText(cells[2]),
    readCellText(cells[3]),
    readCellText(cells[4]),
  ];
}

function headerMatches(values: QuestionRow): number {
  const normalize = (value: string) =>
    value.replace(/\s+/gu, ' ').toLowerCase();
  return values.filter(
    (value, index) =>
      normalize(value) === normalize(QUESTION_HEADERS[index] ?? ''),
  ).length;
}

function validateRequiredCells(values: QuestionRow, row: Row): void {
  values.forEach((value, index) => {
    if (value.length === 0) {
      const cell = row.getCell(index + 1).address;
      throw new ExcelImportError(
        'INVALID_ROW',
        `La celda ${cell} está vacía. Cada pregunta necesita un enunciado y cuatro respuestas.`,
        { worksheetName: row.worksheet.name, cell },
      );
    }
  });
}

/** Lee únicamente desde memoria; no modifica el Buffer ni accede al disco o a Nextcloud. */
export async function importQuestions(
  data: Buffer,
  options: ImportQuestionsOptions = {},
): Promise<ImportedQuestions> {
  validateWorkbookArchive(data);
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS declara load con un ArrayBuffer. La copia contiene solo los bytes del Buffer recibido.
    await workbook.xlsx.load(Uint8Array.from(data).buffer);
  } catch {
    throw new ExcelImportError(
      'INVALID_WORKBOOK',
      'El fichero no es un libro XLSX válido o está dañado.',
    );
  }

  const worksheet =
    options.worksheetName === undefined
      ? workbook.worksheets[0]
      : workbook.getWorksheet(options.worksheetName);
  if (!worksheet) {
    throw new ExcelImportError(
      options.worksheetName === undefined
        ? 'INVALID_WORKBOOK'
        : 'WORKSHEET_NOT_FOUND',
      options.worksheetName === undefined
        ? 'El libro XLSX no contiene ninguna hoja.'
        : 'La hoja solicitada no existe en el libro XLSX.',
    );
  }
  if (
    worksheet.getImages().length > 0 ||
    worksheet.getBackgroundImageId() != null
  ) {
    throw new ExcelImportError(
      'UNSUPPORTED_LAYOUT',
      'La hoja de preguntas contiene imágenes. En esta versión solo se admiten preguntas de texto.',
      { worksheetName: worksheet.name },
    );
  }

  const headerMode = options.headerMode ?? 'auto';
  const questions: Question[] = [];
  let firstRow = true;
  let hasHeader = false;

  worksheet.eachRow((row) => {
    const values = readRow(row);
    if (values === undefined) return;

    const matches = headerMatches(values);
    if (firstRow) {
      firstRow = false;
      if (headerMode === 'present') {
        validateRequiredCells(values, row);
        hasHeader = true;
        return;
      }
      if (headerMode === 'auto' && matches === 5) {
        hasHeader = true;
        return;
      }
      if (headerMode === 'auto' && matches > 0) {
        throw new ExcelImportError(
          'AMBIGUOUS_HEADER',
          `La fila ${row.number} coincide solo parcialmente con la cabecera. Utiliza los cinco títulos esperados o indica explícitamente si hay cabecera.`,
          { worksheetName: worksheet.name, cell: `A${row.number}` },
        );
      }
    } else if (headerMode !== 'absent' && matches === 5) {
      throw new ExcelImportError(
        'AMBIGUOUS_HEADER',
        `La fila ${row.number} contiene una cabecera fuera del inicio de la hoja.`,
        { worksheetName: worksheet.name, cell: `A${row.number}` },
      );
    }

    validateRequiredCells(values, row);
    if (
      questions.length >= MAX_QUESTIONS ||
      values.some(
        (value, index) =>
          value.length >
          (index === 0 ? MAX_QUESTION_TEXT_LENGTH : MAX_ANSWER_TEXT_LENGTH),
      )
    )
      throw new ExcelImportError(
        'QUIZ_LIMIT_EXCEEDED',
        'El cuestionario admite hasta 500 preguntas, enunciados de 2000 caracteres y respuestas de 1000 caracteres.',
      );
    const [
      text,
      correctAnswer,
      firstIncorrect,
      secondIncorrect,
      thirdIncorrect,
    ] = values;
    const answers = [
      correctAnswer,
      firstIncorrect,
      secondIncorrect,
      thirdIncorrect,
    ];
    const seenAnswers = new Set<string>();
    answers.forEach((answer, index) => {
      if (seenAnswers.has(answer)) {
        const cell = row.getCell(index + 2).address;
        throw new ExcelImportError(
          'INVALID_ROW',
          `La celda ${cell} repite otra respuesta de la misma pregunta. Las cuatro respuestas deben ser distintas.`,
          { worksheetName: worksheet.name, cell },
        );
      }
      seenAnswers.add(answer);
    });

    questions.push({
      id: randomUUID(),
      text,
      correctAnswer,
      incorrectAnswers: [firstIncorrect, secondIncorrect, thirdIncorrect],
    });
  });

  if (questions.length === 0) {
    throw new ExcelImportError(
      'EMPTY_QUIZ',
      'La hoja seleccionada no contiene ninguna pregunta.',
      { worksheetName: worksheet.name },
    );
  }

  return { worksheetName: worksheet.name, hasHeader, questions };
}
