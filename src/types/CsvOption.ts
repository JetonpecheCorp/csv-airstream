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
export interface CsvReaderOptions<T = any>
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
     * Optional class constructor used to instantiate rows instead of returning plain object literals.
     *
     * When provided (or when using `Csv.streamReaderWithClass`), each emitted row is instantiated 
     * via `new targetClass()` before properties are populated, preserving class methods, getters, 
     * and prototype inheritance chains.
     *
     * @example
     * ```ts
     * class User {
     *   name!: string;
     *   get upperName() { return this.name.toUpperCase(); }
     * }
     *
     * for await (const row of Csv.streamReader(stream, { targetClass: User })) 
     * {
     *   if (row.ok) console.log(row.data.upperName);
     * }
     * ```
     */
    targetClass?: new () => T;
}

/**
 * Writer engine options for stream formatting.
 */
export interface CsvWriterOptions<T = any>
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
     * Explicit column sequence used for row serialization.
     *
     * Defines the exact horizontal layout of fields in the generated CSV output.
     * Columns omitted from this list will be excluded from the serialized stream.
     *
     * When used with a decorated DTO model (`Csv.streamWriterWithClass`), this configuration
     * takes precedence over both natural property declaration order and static `{ order: number }`
     * settings declared on `@CsvColumn` decorators.
     *
     * @example
     * ```ts
     * // Exports only 'email' followed by 'id', ignoring DTO declaration order
     * const writer = Csv.streamWriterWithClass(UserDto, {
     *   columnsOrder: ["email", "id"],
     * });
     * ```
     */
    columnsOrder?: (keyof T | string)[];

    /**
     * Prepends the UTF-8 Byte Order Mark (`\uFEFF`) sequence at the very beginning of the stream.
     *
     * Crucial when exporting CSV files intended to be opened directly in Microsoft Excel on Windows, 
     * preventing special or accented characters (e.g. `é`, `à`, `ç`, `€`) from displaying as corrupted glyphs.
     *
     * @default false
     *
     * @example
     * ```ts
     * const writer = Csv.streamWriter({
     *   headers: ["Name", "City"],
     *   writeBom: true
     * });
     * ```
     */
    writeBom?: boolean;
}