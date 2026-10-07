export type ExcelImportErrorCode =
  | 'INVALID_WORKBOOK'
  | 'WORKBOOK_TOO_LARGE'
  | 'QUIZ_LIMIT_EXCEEDED'
  | 'WORKSHEET_NOT_FOUND'
  | 'EMPTY_QUIZ'
  | 'AMBIGUOUS_HEADER'
  | 'INVALID_ROW'
  | 'UNSUPPORTED_CELL'
  | 'FORMULA_NOT_SUPPORTED'
  | 'UNSUPPORTED_LAYOUT';

interface ErrorLocation {
  worksheetName?: string;
  cell?: string;
}

export class ExcelImportError extends Error {
  readonly code: ExcelImportErrorCode;
  readonly worksheetName: string | undefined;
  readonly cell: string | undefined;

  constructor(
    code: ExcelImportErrorCode,
    message: string,
    location: ErrorLocation = {},
  ) {
    super(message);
    this.name = 'ExcelImportError';
    this.code = code;
    this.worksheetName = location.worksheetName;
    this.cell = location.cell;
  }
}
