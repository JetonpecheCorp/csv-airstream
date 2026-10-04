/**
 * Standardized error codes emitted during CSV parsing or cell validation.
 */
export const CsvErrorCode = {
  UNCLOSED_QUOTE: "UNCLOSED_QUOTE",
  UNEXPECTED_CHAR: "UNEXPECTED_CHAR",
  COLUMN_COUNT_MISMATCH: "COLUMN_COUNT_MISMATCH",
  INVALID_COLUMN_VALUE: "INVALID_COLUMN_VALUE",
} as const;

export type CsvErrorCode = typeof CsvErrorCode[keyof typeof CsvErrorCode];

/**
 * Structured details regarding an anomaly detected on a specific row or cell.
 */
export interface CsvErrorDetail 
{
  /** Machine-readable error code */
  code: CsvErrorCode | string;
  /** 1-based line number in the source data */
  line: number;
  /** 0-based column index where the error occurred */
  columnIndex?: number;
  /** Column header name, available when `hasHeader` is enabled */
  columnName?: string;
  /** Raw unparsed or invalid cell value */
  invalidValue?: string;
  /** Human-readable explanation of the error */
  message: string;
}