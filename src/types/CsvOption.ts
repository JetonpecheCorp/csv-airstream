import { TransformFn } from "../decorator.js";

/**
 * Contextual information provided to cell validator callbacks.
 */
export interface CellValidationContext 
{
    /** 1-based line number of the row currently being evaluated. */
    line: number;
    /** 0-based column index of the cell. */
    columnIndex: number;

    /** 
     * Header name corresponding to the column, available if `hasHeader` is enabled. 
     */
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
export interface CsvReaderOptions<T = any>
{
    /**
     * The character used to separate columns. 
     * Set to `"auto"` and the parser will try to guess it for you!
     * @default ","
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
     * Does your file have a first row with column names like "Name, Age, Email"?
     * Set this to `true` to get objects instead of arrays.
     * @default false
     */
    hasHeader?: boolean;

    /**
     * Automatically removes extra spaces at the beginning and end of text.
     * E.g., `"  hello  "` becomes `"hello"`.
     * @default false
     */
    trim?: boolean;

    /**
     * Rejects rows whose column count does not strictly match the header length or the first parsed row.
     * @default true
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

    /**
     * Runtime lookup mapping property keys to transformation functions.
     *
     * - **Low-level streams (`Csv.streamReader`)**: Allows transforming raw cell strings into typed values 
     *   keyed by column header name or property mapping without needing a DTO class.
     * - **DTO streams (`Csv.streamReaderWithClass`)**: Acts as a **dynamic override**. Any transformer 
     *   provided here replaces or extends the static `transform` / `type` logic declared on `@CsvColumn` 
     *   for that specific execution, without mutating the class definition.
     *
     * @example
     * ```ts
     * // Override standard date parsing with a custom timezone or format for a single import run:
     * const customTransformers = new Map([
     *   ["createdAt", (val: string) => parseCustomLocaleDate(val)]
     * ]);
     *
     * for await (const row of Csv.streamReaderWithClass(stream, OrderDto, { transformers: customTransformers })) 
     * {
     *   // row.data.createdAt uses the runtime converter instead of the static decorator one
     * }
     * ```
     */
    transformers?: Map<string, TransformFn>;

    /**
     * Global list of string values evaluated as `true` when casting boolean fields.
     * Overrides default values (`["1", "true", "yes", "y", "oui", "o"]`).
     */
    booleanTruthyValues?: string[];

    /**
     * Use a specific TypeScript class to create the rows.
     * 
     * **Important:** Your class must be easy to create without arguments (e.g., `new MyClass()`).
     * If the class needs special arguments, the reader will safely report an error on that row failure (`DTO_INSTANTIATION_ERROR`).
     */
    targetClass?: new () => T;
}

/**
 * Writer engine options for stream formatting.
 */
export interface CsvWriterOptions<T = any>
{
    /**
     * If true, forces double quotes around every single cell value, regardless of its content.
     * @default false
     */
    delimiter?: string;

    /**
     * Pre-formatted column headers emitted as the very first CSV line.
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
     * Choose exactly which columns to export and in what order.
     * Anything not in this list will be ignored.
     * 
     * @example ["email", "age", "firstName"]
     */
    columnsOrder?: (keyof T | string)[];

    /**
     * **Crucial for Windows/Excel users!**
     * Set this to `true` if your data contains accents (é, à, ç, etc.). 
     * It adds a tiny invisible marker (BOM) at the start of the file so Microsoft Excel reads it correctly.
     * @default false
     */
    writeBom?: boolean;
}