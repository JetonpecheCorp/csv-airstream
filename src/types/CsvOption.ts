/**
 * Context provided to custom cell validation functions.
 */
export interface CellValidationContext 
{
    /** 1-based line number of the row being validated. */
    line: number;
    /** 0-based column index of the cell. */
    columnIndex: number;
    /** Header name corresponding to the column, available when `hasHeader` is enabled. */
    columnName?: string;
}

/**
 * Optional validator callback evaluated for each parsed cell value.
 * 
 * - Return `true` to accept the value.
 * - Return `false` to reject with a default `INVALID_COLUMN_VALUE` error code.
 * - Return a `string` to emit a specific custom error code (e.g. `"INVALID_DATE"`, `"PRICE_OUT_OF_RANGE"`).
 */
export type CellValidator = (
    value: string,
    context: CellValidationContext
) => boolean | string;

/**
 * Configuration options for the streaming CSV reader.
 */
export interface CsvReaderOptions
{
    /** 
     * Field delimiter character or `'auto'` to infer it from the first rows (default: `','`).
     */
    delimiter?: string | "auto";

    /** 
     * Candidate delimiters evaluated when `delimiter` is set to `'auto'` (default: `[',', ';', '\t', '|']`).
     */
    delimiterCandidates?: string[];

    /** 
     * Quote character used to wrap fields containing delimiters or line breaks (default: `'"'`).
     */
    quoteChar?: string;

    /** 
     * Escape character used inside quoted fields (default: `'"'`).
     */
    escapeChar?: string;

    /** 
     * If `true`, treats the first non-empty row as header names and emits object records instead of string arrays (default: `false`).
     */
    hasHeader?: boolean;

    /** 
     * If `true`, strips leading and trailing whitespace from unquoted cell values (default: `false`).
     */
    trim?: boolean;

    /** 
     * Enforces that every row has the same number of columns as the header or initial row (default: `true`).
     */
    strictColumnCount?: boolean;

    /** 
     * Callback function executed on every cell value to validate schema or domain constraints.
     */
    validateCell?: CellValidator;

    /** 
     * If `true`, skips blank lines and lines containing only whitespace or delimiters (default: `false`).
     */
    skipEmptyLines?: boolean;

    /** 
     * Character prefix identifying lines that should be ignored as comments (e.g. `'#'`).
     */
    comment?: string;

    /**
    * List of column names (if `hasHeader: true`) or indices (e.g., [0, 2])
    * that must not be empty. 
    */
    requiredColumns?: (string | number)[];
}

/**
 * Configuration options for the streaming CSV writer.
 */
export interface CsvWriterOptions
{
    /** 
     * Field delimiter character used to separate values (default: `','`).
     */
    delimiter?: string;

    /** 
     * Quote character used to wrap cells containing special characters (default: `'"'`).
     */
    quoteChar?: string;

    /** 
     * Line termination sequence appended after each row (default: `'\r\n'`).
     */
    lineTerminator?: "\r\n" | "\n";

    /** 
     * If `true`, forces quoting on every cell regardless of its content (default: `false`).
     */
    alwaysQuote?: boolean;

    /** 
     * Explicit column headers list. When writing object records, this controls key order and emits a header row.
     */
    headers?: string[];
}