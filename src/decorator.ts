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
    /** List of headers or numeric indices marked with `{ required: true }`. */
    requiredColumns: (string | number)[];
}

/**
 * Generic constructor interface for instantiable class DTOs.
 */
export type ClassConstructor<T> = new (...args: any[]) => T;

const CSV_SCHEMA_KEY = Symbol("__csv_schema__");
const CSV_CACHE = new WeakMap<Function, CsvClassSchema<any>>();

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
export function CsvIndex(index: number, options?: { required?: boolean }): any 
{
    return registerDecorator({
        index,
        order: index,
        required: options?.required,
    });
}

function registerDecorator(meta: { header?: string; index?: number; order?: number; required?: boolean }): any 
{
    return (targetOrContext: any, propertyKey?: string | symbol) => 
    {
        // TC39 Stage 3 (TypeScript 5+)
        if (typeof targetOrContext === "undefined" || (propertyKey && typeof propertyKey === "object")) 
        {
            const context = propertyKey as unknown as ClassFieldDecoratorContext;
            const propName = String(context.name);
            context.addInitializer(function (this: any) 
            {
                enregistrerMeta(this.constructor, propName, meta.header, meta.index, meta.order, meta.required);
            });

            return function (this: any, initialValue: any) 
            {
                enregistrerMeta(this.constructor, propName, meta.header, meta.index, meta.order, meta.required);
                return initialValue;
            };
        }

        // TypeScript Legacy (experimentalDecorators: true)
        enregistrerMeta(targetOrContext.constructor, String(propertyKey), meta.header, meta.index, meta.order, meta.required);
    };
}

function enregistrerMeta(
    ctor: any,
    propertyKey: string,
    header?: string,
    index?: number,
    order?: number,
    required?: boolean
): void 
{
    if (!ctor[CSV_SCHEMA_KEY]) 
    {
        ctor[CSV_SCHEMA_KEY] = [];
    }
    const colonnes: ColumnMeta[] = ctor[CSV_SCHEMA_KEY];
    colonnes.push({ header, index, order, propertyKey, required });
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
    if (cached) return cached;

    const metas: ColumnMeta[] | undefined = (cls as any)[CSV_SCHEMA_KEY];
    if (!metas || metas.length === 0) return null;

    // Stable sort according to explicit order or numeric column index
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
    const requiredColumns: (string | number)[] = [];

    for (let i = 0; i < sortedMetas.length; i++) 
    {
        const meta = sortedMetas[i];
        const propKey = meta.propertyKey as keyof T;

        if (meta.header !== undefined) 
        {
            headers.push(meta.header);
            propertyKeys.push(propKey);
            headerToProperty.set(meta.header, meta.propertyKey);
            if (meta.required) 
            {
                requiredColumns.push(meta.header);
            }
        }

        if (meta.index !== undefined) 
        {
            indexToProperty.set(meta.index, meta.propertyKey);
            if (meta.required) 
            {
                requiredColumns.push(meta.index);
            }
        }
    }

    const compiled: CsvClassSchema<T> = {
        headers,
        propertyKeys,
        headerToProperty,
        indexToProperty,
        requiredColumns,
    };

    CSV_CACHE.set(cls, compiled);
    return compiled;
}