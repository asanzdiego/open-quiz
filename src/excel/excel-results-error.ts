export type ExcelResultsErrorCode =
  | 'INVALID_WORKBOOK'
  | 'WORKBOOK_TOO_LARGE'
  | 'RESULT_SHEET_EXISTS'
  | 'RESULT_SERIALIZATION_FAILED';

export class ExcelResultsError extends Error {
  readonly code: ExcelResultsErrorCode;

  constructor(code: ExcelResultsErrorCode, message: string) {
    super(message);
    this.name = 'ExcelResultsError';
    this.code = code;
  }
}
