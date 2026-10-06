((Symbol as any).metadata ??= Symbol.for("Symbol.metadata"));

/**
 * Supported primitives for automated string-to-value casting.
 */
export type ColumnType = "string" | "number" | "boolean" | "date";

/**
 * Custom transformation function converting a raw string cell into a typed domain value.
 *
 * @template T Return type of the parsed value.
 */
export type TransformFn<T = any> = (value: string) => T;

export interface NumberCastOptions 
{
    /** Séparateur décimal accepté (défaut : '.') */
    decimalSeparator?: "." | ",";

    strict?: boolean;
}

/**
 * Configuration metadata associated with a decorated CSV column property.
 */
export interface ColumnMeta 
{
    /** The raw CSV header text matching this field (e.g., `"name *"`). */
    header?: string;
    /** Explicit 0-based column index if matched by position. */
    index?: number;
    /** Output ordering priority when writing rows (e.g., 0, 1, 2...). */
    order?: number;
    /** The target property name on the DTO class. */
    propertyKey: string;
    /** Whether an empty string value triggers a validation error. */
    required?: boolean;

    type?: ColumnType;

    transform?: TransformFn;
}

/**
 * Configuration options for the `@CsvColumn` decorator.
 */
export interface CsvColumnOptions 
{
    /** 
     * Statically declares this field as mandatory on the model schema.
     * Rows with empty or missing values for this column will automatically be rejected.
     * 
     * Note: When using `Csv.streamReaderWithClass()`, these fields are automatically registered alongside 
     * any runtime `requiredColumns` passed in options.
     */
    required?: boolean;

    /** 
     * Explicit column output priority used exclusively when serializing data via `Csv.streamWriterWithClass()`.
     * 
     * - **Writing (`Csv.streamWriterWithClass`)**: Dictates the exact horizontal position of the column 
     *   in the generated CSV header and subsequent data rows (e.g., `0` is the 1st column, `1` is the 2nd).
     *   Columns without an explicit `order` fallback to their natural class declaration sequence.
     * - **Reading (`Csv.streamReaderWithClass`)**: Has **no impact** during parsing; column positions are resolved 
     *   dynamically from the incoming CSV header layout.
     * 
     * @example
     * ```ts
     * class UserDto {
     *   // Will be written as column index 1 even if declared first in the class
     *   @CsvColumn("name", { order: 1 })
     *   name!: string;
     * 
     *   // Will be written as column index 0 (first column)
     *   @CsvColumn("id", { order: 0 })
     *   id!: string;
     * }
     * ```
     */
    order?: number;

    /**
     * Target primitive type for automated value conversion (`"number"`, `"boolean"`, `"date"`).
     * Shortcut for common built-in transformers without writing custom parsing logic.
     */
    type?: ColumnType;

    /**
     * Static, model-level value converter applied whenever a cell for this property is parsed.
     *
     * - **Scope**: Bound directly to the DTO class definition. Applies to all parsing pipelines 
     *   using this model across the entire application.
     * - **Precedence**: Overridden at runtime if a transformer for the same property key 
     *   is explicitly passed via `options.transformers` in `Csv.streamReaderWithClass()`.
     *
     * @example
     * ```ts
     * class ProductDto 
     * {
     *   // Splits pipe-separated values into a typed array directly on the model
     *   @CsvColumn("tags", { transform: (raw) => raw.split("|").map(t => t.trim()) })
     *   tags!: string[];
     * }
     * ```
     */
    transform?: TransformFn;

    /** 
     * Custom truthy / falsy definitions when `type: "boolean"` is used. 
     */
    booleanValues?: BooleanCastOptions;

    numberOptions?: NumberCastOptions;
}

/**
 * Compiled CSV metadata schema for a specific class DTO.
 *
 * @template T Type of the decorated class instance.
 */
export interface CsvClassSchema<T> 
{
    /** Array of all raw CSV column headers sorted by ordering rules. */
    headers: string[];
    /** Class property keys aligned directly with `headers`. */
    propertyKeys: (keyof T)[];
    /** Map linking a raw CSV header string to its class property key. */
    headerToProperty: Map<string, string>;
    /** Map linking a 0-based column index to its class property key. */
    indexToProperty: Map<number, string>;

    /** 
     * List of headers or numeric indices marked with `{ required: true }`. 
     */
    requiredColumns: (string | number)[];

    /**
     * Pre-compiled map associating class property keys with their static transformation functions.
     *
     * Generated from `@CsvColumn` or `@CsvIndex` decorators configured with `{ type: ... }` 
     * or `{ transform: ... }`. 
     * 
     * During stream initialization in `Csv.streamReaderWithClass()`, this map is flattened into 
     * an indexed array aligned with the incoming CSV column positions, guaranteeing direct 
     * O(1) casting per row without runtime key lookups.
     */
    propertyTransformers: Map<string, TransformFn>;
}

/**
 * Configuration options for boolean value casting.
 */
export interface BooleanCastOptions 
{
    /** 
     * String tokens considered as `true` (case-insensitive).
     * @default ["1", "true", "yes", "y", "oui", "o"]
     */
    truthy?: readonly string[];

    /** 
     * Optional string tokens considered as `false` (case-insensitive).
     * If provided, values not matching either list can return null or false.
     */
    falsy?: readonly string[];
}

/**
 * Generic constructor interface for instantiable class DTOs.
 */
export type ClassConstructor<T> = new (...args: any[]) => T;

export const CSV_SCHEMA_KEY = Symbol.for("__csv_schema__");
const CSV_CACHE = new WeakMap<Function, CsvClassSchema<any>>();
const DEFAULT_TRUTHY = ["1", "true", "yes", "y", "oui", "o"] as const;

function resolveTransformer(
    type?: ColumnType,
    custom?: TransformFn,
    boolOptions?: BooleanCastOptions,
    numOptions?: NumberCastOptions
): TransformFn | undefined 
{
    if (custom) return custom;

    switch (type) 
    {
        case "boolean":
            {
                const truthyList = (boolOptions?.truthy ?? DEFAULT_TRUTHY).map(v => v.trim().toLowerCase());
                const truthySet = new Set(truthyList);

                if (boolOptions?.falsy && boolOptions.falsy.length > 0) 
                {
                    const falsySet = new Set(boolOptions.falsy.map(v => v.trim().toLowerCase()));
                    return (v: string) => 
                    {
                        const s = v.trim().toLowerCase();
                        if (truthySet.has(s)) return true;
                        if (falsySet.has(s)) return false;
                        return null;
                    };
                }

                return (v: string) => truthySet.has(v.trim().toLowerCase());
            }

        case "number":
            return (v: string) => 
            {
                let trimmed = v.trim();
                if (trimmed === "") return null;

                if (numOptions?.decimalSeparator === ",") 
                {
                    trimmed = trimmed.replace(",", ".");
                }

                const num = Number(trimmed);
                if (isNaN(num))
                {
                    if (numOptions?.strict) throw new Error(`Invalid number format: "${v}"`);
                    return null;
                }
                return num;
            };

        case "date":
            return (v: string) => (v.trim() === "" ? null : new Date(v));

        default:
            return undefined;
    }
}

/**
 * Binds a class property to an explicit CSV header string with optional writing order.
 * Compatible with TypeScript experimental decorators and standard TC39 Stage 3 decorators.
 *
 * @example
 * ```ts
 * class UserDto {
 *   // Automatically enforced as required without needing options.requiredColumns
 *   @CsvColumn("name *", { required: true, order: 0 })
 *   name!: string;
 *
 *   @CsvColumn("is active (0, 1) *", { order: 1 })
 *   isActive!: string;
 * }
 * ```
 *
 * @param header The raw header string expected in the CSV source.
 * @param options Additional schema settings (`required` validation and `order`).
 * @returns A property decorator handler.
 */
export function CsvColumn(header: string, options?: CsvColumnOptions): any 
{
    return registerDecorator({
        header,
        required: options?.required,
        order: options?.order,
        type: options?.type,
        transform: resolveTransformer(options?.type, options?.transform, options?.booleanValues, options?.numberOptions),
    });
}

/**
 * Binds a class property directly to a zero-based column position index.
 * Useful for headerless CSV files or fixed positional records.
 *
 * @example
 * ```ts
 * class LogDto {
 *   @CsvIndex(0, { required: true })
 *   timestamp!: string;
 *
 *   @CsvIndex(1)
 *   level!: string;
 * }
 * ```
 *
 * @param index 0-based column index in the CSV line.
 * @param options Additional settings such as `required`.
 * @returns A property decorator handler.
 */
export function CsvIndex(
    index: number,
    options?: { required?: boolean; type?: ColumnType; booleanValues?: BooleanCastOptions; numberOptions?: NumberCastOptions; transform?: TransformFn }
): any 
{
    return registerDecorator({
        index,
        order: index,
        required: options?.required,
        type: options?.type,
        transform: resolveTransformer(options?.type, options?.transform, options?.booleanValues, options?.numberOptions),
    });
}

function registerDecorator(meta: {
    header?: string;
    index?: number;
    order?: number;
    type?: ColumnType;
    required?: boolean;
    transform?: TransformFn;
}): any
{
    return (targetOrContext: any, contextOrKey?: string | symbol | ClassFieldDecoratorContext) =>
    {
        // Détection propre des décorateurs TC39
        if (contextOrKey && typeof contextOrKey === "object" && "kind" in contextOrKey)
        {
            const context = contextOrKey as ClassFieldDecoratorContext;
            const propName = String(context.name);

            if (context.metadata)
            {
                if (!context.metadata[CSV_SCHEMA_KEY])
                {
                    context.metadata[CSV_SCHEMA_KEY] = [];
                }
                (context.metadata[CSV_SCHEMA_KEY] as any[]).push({ ...meta, propertyKey: propName });
            }
            else
            {
                // Fallback de sécurité si le polyfill Symbol.metadata est absent ou incomplet
                context.addInitializer(function (this: any) 
                {
                    if (!this.constructor[CSV_SCHEMA_KEY])
                    {
                        this.constructor[CSV_SCHEMA_KEY] = [];
                    }

                    // Empêcher les doublons si la classe est instanciée plusieurs fois
                    const existant = this.constructor[CSV_SCHEMA_KEY].find((m: any) => m.propertyKey === propName);
                    if (!existant)
                    {
                        this.constructor[CSV_SCHEMA_KEY].push({ ...meta, propertyKey: propName });
                    }
                });
            }
            return;
        }

        // Décorateurs expérimentaux (Legacy TypeScript)
        enregistrerMeta(targetOrContext.constructor, String(contextOrKey), meta);
    };
}

function enregistrerMeta(
    ctor: any,
    propertyKey: string,
    meta: { header?: string; index?: number; order?: number; required?: boolean; transform?: TransformFn }
): void
{
    if (!ctor[CSV_SCHEMA_KEY])
    {
        ctor[CSV_SCHEMA_KEY] = [];
    }
    ctor[CSV_SCHEMA_KEY].push({ ...meta, propertyKey });
}

/**
 * Retrieves or compiles the CSV mapping schema for a decorated class constructor.
 * Uses a WeakMap cache to eliminate parsing overhead across multiple stream calls.
 *
 * @template T Type of the target class.
 * @param cls The class constructor containing decorator metadata.
 * @returns Compiled schema object, or `null` if no decorators are defined.
 */
export function getCsvSchema<T>(cls: ClassConstructor<T>): CsvClassSchema<T> | null
{
    const cached = CSV_CACHE.get(cls);
    if (cached)
        return cached;

    const tc39Meta = (cls as any)[Symbol.metadata]?.[CSV_SCHEMA_KEY];
    const legacyMeta = (cls as any)[CSV_SCHEMA_KEY];
    const metas = tc39Meta ?? legacyMeta;

    if (!metas || metas.length === 0)
        return null;

    const sortedMetas = [...metas].sort((a, b) =>
    {
        const orderA = a.order ?? (a.index !== undefined ? a.index : 9999);
        const orderB = b.order ?? (b.index !== undefined ? b.index : 9999);
        return orderA - orderB;
    });

    const headers: string[] = [];
    const propertyKeys: (keyof T)[] = [];
    const headerToProperty = new Map<string, string>();
    const indexToProperty = new Map<number, string>();
    const propertyTransformers = new Map<string, TransformFn>();
    const requiredColumns: (string | number)[] = [];

    for (let i = 0; i < sortedMetas.length; i++)
    {
        const m = sortedMetas[i];
        const propKey = m.propertyKey as keyof T;

        if (m.transform)
        {
            propertyTransformers.set(m.propertyKey, m.transform);
        }

        if (m.header !== undefined)
        {
            headers.push(m.header);
            propertyKeys.push(propKey);
            headerToProperty.set(m.header, m.propertyKey);
            if (m.required) requiredColumns.push(m.header);
        }

        if (m.index !== undefined)
        {
            indexToProperty.set(m.index, m.propertyKey);
            if (m.required) requiredColumns.push(m.index);
        }
    }

    const compiled: CsvClassSchema<T> = {
        headers,
        propertyKeys,
        headerToProperty,
        indexToProperty,
        propertyTransformers,
        requiredColumns,
    };

    CSV_CACHE.set(cls, compiled);
    return compiled;
}