import { CsvReaderStream } from "./reader.js";
import { CsvWriterStream, type RowInput } from "./writer.js";
import type { CsvReaderOptions, CsvWriterOptions } from "./types/CsvOption.js";
import type { CsvRowResult } from "./types/CsvRowResult.js";
import { ClassConstructor, getCsvSchema, CSV_SCHEMA_KEY } from "./decorator.js";

/**
 * Main entry point for stream-based CSV parsing and serialization.
 */
export class Csv
{
    /**
     * Streams and parses a CSV source directly into typed instances of a decorated DTO class.
     * 
     * Features:
     * - Automatic header activation (`hasHeader: true`) if `@CsvColumn` is detected.
     * - Immediate rejection (`MISSING_HEADER_COLUMN`) if mandatory columns are missing from the header row.
     * - Zero-overhead O(1) indexed lookups with automatic primitive type conversion.
     * - Merges static `{ required: true }` decorators with runtime `options.requiredColumns` without overrides.
     *
     * @example
     * ```ts
     * for await (const row of Csv.streamReaderWithClass(csvStream, UserDto)) {
     *   if (row.ok) {
     *     console.log(row.data.name, row.data.price);
     *   }
     * }
     * ```
     *
     * @template T The decorated target DTO class.
     * @param source Raw CSV string, text stream, or binary byte stream (`Uint8Array`).
     * @param dtoClass Class constructor decorated with `@CsvColumn` or `@CsvIndex`.
     * @param options Additional parser configuration.
     * @returns An async iterable yielding parsed `CsvRowResult<T>` records.
     */
    public static streamReaderWithClass<T extends object>(
        source: string | ReadableStream<string> | ReadableStream<Uint8Array>,
        dtoClass: ClassConstructor<T>,
        options: CsvReaderOptions<T> = {}
    ): AsyncIterable<CsvRowResult<T>>
    {
        const schema = getCsvSchema(dtoClass);
        const hasHeaderDefault = schema ? schema.headers.length > 0 : false;

        const staticReq = schema?.requiredColumns ?? [];
        const runtimeReq = options.requiredColumns ?? [];
        const mergedRequired = Array.from(new Set([...staticReq, ...runtimeReq]));

        // Cloner la map des transformateurs pour ne pas muter le cache de schéma
        const transformers = new Map(schema?.propertyTransformers ?? []);

        // 1. Surcharge globale des booléens si booleanTruthyValues est passé dans les options
        if (options.booleanTruthyValues && options.booleanTruthyValues.length > 0)
        {
            const truthySet = new Set(options.booleanTruthyValues.map((v) => v.trim().toLowerCase()));
            const boolCaster = (v: string) => truthySet.has(v.trim().toLowerCase());

            // Recherche des propriétés déclarées en boolean
            const symbolMetaKey = (Symbol as any).metadata;
            const metas = (symbolMetaKey ? (dtoClass as any)[symbolMetaKey]?.[CSV_SCHEMA_KEY] : undefined)
                ?? (dtoClass as any)[CSV_SCHEMA_KEY];

            if (Array.isArray(metas))
            {
                for (const m of metas)
                {
                    if (m.type === "boolean" && !options.transformers?.has(m.propertyKey))
                    {
                        transformers.set(m.propertyKey, boolCaster);
                    }
                }
            }
        }

        // 2. Surcharges prioritaires passées directement via options.transformers
        if (options.transformers)
        {
            for (const [key, fn] of options.transformers)
            {
                transformers.set(key, fn);
            }
        }

        const readerOptions: CsvReaderOptions = {
            hasHeader: hasHeaderDefault,
            ...options,
            headerMapping: schema ? schema.headerToProperty : undefined,
            indexMapping: schema ? schema.indexToProperty : undefined,
            transformers: transformers.size > 0 ? transformers : undefined,
            requiredColumns: mergedRequired.length > 0 ? mergedRequired : undefined,
            targetClass: dtoClass
        };

        return Csv.streamReader<T>(source, readerOptions);
    }

    /**
     * Creates an optimized CSV stream writer pre-configured for a decorated DTO class.
     * 
     * Column sequencing is resolved using the following order of precedence:
     * 1. Dynamic `options.columnsOrder` if specified.
     * 2. Static `{ order: number }` declared on `@CsvColumn` decorators.
     * 3. Natural property declaration order on the class prototype.
     *
     * @example
     * ```ts
     * const writer = Csv.streamWriterWithClass(UserDto);
     * await writer.write({ name: "Alice", price: 42 });
     * await writer.close();
     * ```
     *
     * @template T The decorated target DTO class.
     * @param dtoClass Class constructor decorated with `@CsvColumn`.
     * @param options Writer settings, including custom column sequences.
     * @returns A typed writer handle exposing `write`, `close`, `abort`, and `readable`.
     */
    public static streamWriterWithClass<T extends object>(
        dtoClass: ClassConstructor<T>,
        options: Omit<CsvWriterOptions, "headers"> & { columnsOrder?: (keyof T)[] } = {}
    )
    {
        const schema = getCsvSchema(dtoClass);

        let headers = schema?.headers;
        let propertyKeys = schema?.propertyKeys as string[] | undefined;

        // Custom runtime column reordering
        if (options.columnsOrder && schema) 
        {
            const customOrder = options.columnsOrder;
            propertyKeys = customOrder as string[];

            const propToHeader = new Map<string, string>();
            for (let i = 0; i < schema.propertyKeys.length; i++) 
            {
                propToHeader.set(schema.propertyKeys[i] as string, schema.headers[i]);
            }

            headers = customOrder
                .map((prop) => propToHeader.get(prop as string))
                .filter((h): h is string => h !== undefined);
        }

        const writerOptions: CsvWriterOptions = {
            ...options,
            headers,
            propertyKeys,
        };

        return Csv.streamWriter<T>(writerOptions);
    }

    /**
     * Streams and parses untyped raw CSV data row-by-row as an async iterable.
     *
     * @example
     * ```ts
     * for await (const row of Csv.streamReader(csvData, { delimiter: "auto", hasHeader: true })) {
     *   if (row.ok) console.log(row.data);
     * }
     * ```
     *
     * @template T Emitted row shape, defaults to `Record<string, string>`.
     * @param source Raw CSV string, text stream, or binary byte stream (`Uint8Array`).
     * @param options Parser configuration options.
     * @returns An async iterable yielding `CsvRowResult<T>` records[cite: 13, 15].
     */
    public static streamReader<T = Record<string, string>>(
        source: string | ReadableStream<string> | ReadableStream<Uint8Array>,
        options: CsvReaderOptions = {}
    ): AsyncIterable<CsvRowResult<T>>
    {
        let textStream: ReadableStream<string>;

        if (typeof source === "string")
        {
            textStream = new ReadableStream<string>({
                start(controller)
                {
                    controller.enqueue(source);
                    controller.close();
                },
            });
        }
        else
        {
            // Décodeur instancié uniquement si un flux binaire est détecté
            let decoder: TextDecoder | null = null;
            
            const autoDecoder = new TransformStream<any, string>({
                transform(chunk, controller) 
                {
                    if (typeof chunk === "string") 
                    {
                        controller.enqueue(chunk);
                    } 
                    else if (chunk instanceof Uint8Array || ArrayBuffer.isView(chunk)) 
                    {
                        if (!decoder) 
                            decoder = new TextDecoder("utf-8", { fatal: false });

                        // L'option { stream: true } gère les caractères coupés au milieu d'un chunk
                        controller.enqueue(decoder.decode(chunk, { stream: true }));
                    } 
                    else 
                    {
                        // Fallback pour tout autre type inattendu
                        controller.enqueue(String(chunk));
                    }
                },
                flush(controller) 
                {
                    if (decoder) 
                    {
                        const reste = decoder.decode();
                        if (reste) 
                            controller.enqueue(reste);
                    }
                }
            });

            textStream = source.pipeThrough(autoDecoder);
        }

        return textStream.pipeThrough(new CsvReaderStream<T>(options));
    }

    /**
     * Creates a lightweight streaming writer handle supporting raw row serialization.
     *
     * @example
     * ```ts
     * const writer = Csv.streamWriter({ headers: ["id", "name"] });
     * await writer.write({ id: 1, name: "Product" });
     * await writer.close();
     * ```
     *
     * @template T Array or object input shape.
     * @param options Writer formatting options.
     * @returns An object containing `write`, `close`, `abort`, and the output `readable` stream.
     */
    public static streamWriter<T extends RowInput = RowInput>(
        options: CsvWriterOptions = {}
    )
    {
        const transform = new CsvWriterStream<T>(options);
        const writer = transform.writable.getWriter();

        return {
            /**
             * Writes a single row into the pipeline.
             * @param row Array or key-value object to format.
             */
            write: (row: T) => writer.write(row),
            /**
             * Flushes remaining data and closes the writer stream.
             */
            close: () => writer.close(),
            /**
             * Aborts stream processing with an optional reason.
             */
            abort: (reason?: unknown) => writer.abort(reason),
            /**
             * Output ReadableStream containing generated CSV text slices.
             */
            readable: transform.readable,
        };
    }

    /**
     * Wraps a CSV writer's readable stream into a standard Web API `Response` configured for file downloads.
     * Compatible with Next.js, Hono, Fastify, Cloudflare Workers, Express v5, Deno, and Bun.
     *
     * @example
     * ```ts
     * const writer = Csv.streamWriter({ headers: ["id", "name"] });
     * return Csv.toResponse(writer, "export.csv");
     * ```
     *
     * @param writer Writer handle or object exposing a readable string stream.
     * @param filename Target filename specified in the Content-Disposition header (defaults to `"export.csv"`).
     * @returns A standard Web `Response` streaming UTF-8 encoded CSV data.
     */
    public static toResponse(
        writer: { readable: ReadableStream<string> },
        filename = "export.csv"
    ): Response
    {
        const byteStream = writer.readable.pipeThrough(new TextEncoderStream());

        return new Response(byteStream, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-cache",
            },
        });
    }

    /**
     * Pipes a CSV writer's output directly into a local file on disk using Node.js filesystem streams.
     * Uses dynamic imports to maintain zero hard dependencies and safe execution in browser contexts.
     *
     * @example
     * ```ts
     * const writer = Csv.streamWriter({ headers: ["id", "price"] });
     * const savePromise = Csv.saveToFile(writer, "./exports/prices.csv");
     *
     * await writer.write({ id: 1, price: 49.99 });
     * await writer.close();
     * await savePromise;
     * ```
     *
     * @param writer Writer handle or object exposing a readable string stream.
     * @param filePath Absolute or relative path to the destination file.
     * @returns A Promise that resolves once all stream contents are flushed to disk.
     */
    public static async saveToFile(
        writer: { readable: ReadableStream<string> },
        filePath: string
    ): Promise<void>
    {
        const { createWriteStream } = await import("node:fs");
        const { Readable } = await import("node:stream");
        const { pipeline } = await import("node:stream/promises");

        const byteStream = writer.readable.pipeThrough(new TextEncoderStream());
        const nodeReadable = Readable.fromWeb(byteStream as any);
        const fileDestination = createWriteStream(filePath);

        try
        {
            await pipeline(nodeReadable, fileDestination);
        } 
        catch (error)
        {
            throw new Error(`CSV File Write Error at '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}