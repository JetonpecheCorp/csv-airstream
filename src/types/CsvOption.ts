/**
 * Contextual information provided to cell validator callbacks.
 */
export interface CellValidationContext 
{
    /** 1-based line number of the row currently being evaluated. */
    line: number;
    /** 0-based column index of the cell. */
    columnIndex: number;
    /** Header name corresponding to the column, present when `hasHeader` is enabled. */
    columnName?: string;
}

/**
 * Custom callback signature for individual cell validation.
 *
 * - Returns `true` if the value is accepted.
 * - Returns `false` to reject with the default error code.
 * - Returns a `string` to fail with a custom machine-readable error code.
 */
export type CellValidatorFn = (
    value: string,
    context: CellValidationContext
) => boolean | string;

/**
 * Reader engine options for stream parsing.
 */
export interface CsvReaderOptions
{
    /**
     * Field delimiter character or `'auto'` to infer it from the first rows (default: `','`).
     */
    delimiter?: string | "auto";

    /**
     * Candidate delimiter characters checked during auto-detection (default: `[',', ';', '\t', '|']`).
     */
    delimiterCandidates?: readonly string[];

    /**
     * Quote character wrapping fields with special characters or newlines (default: `'"'`).
     */
    quoteChar?: string;

    /**
     * Escape character inside quoted strings (default: `'"'`).
     */
    escapeChar?: string;

    /**
     * When true, treats the first line as column headers and emits objects instead of arrays (default: `false`).
     */
    hasHeader?: boolean;

    /**
     * Strips leading and trailing whitespace from cell values (default: `false`).
     */
    trim?: boolean;

    /**
     * Rejects rows whose column count does not match the header or first line (default: `true`).
     */
    strictColumnCount?: boolean;

    /**
     * Optional validation callback executed on every parsed cell value.
     */
    validateCell?: CellValidatorFn;

    /**
     * Skips blank rows or lines containing only spaces and separators (default: `false`).
     */
    skipEmptyLines?: boolean;

    /**
     * Line comment prefix (e.g., `'#'`). Rows starting with this prefix are skipped.
     */
    comment?: string;

    /**
     * Runtime list of column names (if `hasHeader: true`) or zero-based column indices 
     * that must not contain empty values.
     * 
     * - **Low-level streams (`Csv.streamReader`)**: Essential mechanism to enforce non-empty fields 
     *   on untyped or dynamic CSV streams.
     * - **DTO streams (`Csv.streamReaderWithClass`)**: Optional. Any fields marked with `{ required: true }` in 
     *   `@CsvColumn` or `@CsvIndex` are automatically enforced; this option allows extending 
     *   or tightening mandatory columns dynamically at runtime.
     */
    requiredColumns?: (string | number)[];

    /**
     * Internal lookup mapping raw CSV headers to target TypeScript object keys.
     */
    headerMapping?: Map<string, string>;

    /**
     * Internal lookup mapping 0-based column indices to target TypeScript object keys.
     */
    indexMapping?: Map<number, string>;
}

/**
 * Writer engine options for stream formatting.
 */
export interface CsvWriterOptions
{
    /**
     * Column delimiter string (default: `','`).
     */
    delimiter?: string;

    /**
     * Quote character wrapping cells with special characters (default: `'"'`).
     */
    quoteChar?: string;

    /**
     * Line termination sequence (default: `'\r\n'`).
     */
    lineTerminator?: "\r\n" | "\n";

    /**
     * If true, forces double quotes on every cell value (default: `false`).
     */
    alwaysQuote?: boolean;

    /**
     * Pre-formatted column headers emitted as the first CSV line.
     */
    headers?: string[];

    /**
     * Property keys ordered matching `headers` for O(1) indexed row serialization.
     */
    propertyKeys?: string[];

    /**
     * Explicit list of property keys used to enforce a specific column sequence at runtime.
     * 
     * Overrides any static `order` rules defined on `@CsvColumn` decorators without modifying the DTO.
     * Columns omitted from this list will be excluded from the generated CSV output.
     * 
     * @example
     * ```ts
     * // Export only 'name' then 'id', ignoring default DTO order
     * const writer = Csv.write(UserDto, { columnsOrder: ["name", "id"] });
     * ```
     */
    columnsOrder?: string[];
}