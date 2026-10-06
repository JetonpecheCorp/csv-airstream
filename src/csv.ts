import { CsvReaderStream } from "./reader.js";
import { CsvWriterStream, type RowInput } from "./writer.js";
import { ClassConstructor, getCsvSchema } from "./decorator.js";
import type { CsvReaderOptions, CsvWriterOptions } from "./types/CsvOption.js";
import type { CsvRowResult } from "./types/CsvRowResult.js";

/**
 * Main entry point for stream-based CSV parsing and serialization.
 */
export class Csv
{
/**
     * Streams and parses a CSV source directly into instances of a decorated DTO class.
     * 
     * Automatically activates `hasHeader: true` if `@CsvColumn` decorators are detected, 
     * resolves column ordering in O(1), and enforces mandatory columns defined by `{ required: true }`.
     *
     * @example
     * ```ts
     * // No need to specify requiredColumns: UserDto's @CsvColumn({ required: true }) is auto-enforced
     * for await (const row of Csv.read(csvStream, UserDto)) 
     * {
     *   if (row.ok) console.log(row.data.name);
     * }
     * ```
     *
     * @template T The decorated target DTO class.
     * @param source Raw CSV text or readable byte/string stream.
     * @param dtoClass Class constructor decorated with `@CsvColumn` or `@CsvIndex`.
     * @param options Additional reader options. Extra columns provided in `options.requiredColumns` 
     *                will be merged with the DTO's static required fields.
     * @returns An async iterable yielding parsed `CsvRowResult<T>` records.
     */
    public static streamReaderWithClass<T extends object>(
        source: string | ReadableStream<string> | ReadableStream<Uint8Array>,
        dtoClass: ClassConstructor<T>,
        options: CsvReaderOptions = {}
    ): AsyncIterable<CsvRowResult<T>>
    {
        const schema = getCsvSchema(dtoClass);
        const hasHeaderDefault = schema ? schema.headers.length > 0 : false;

        const staticRequired = schema?.requiredColumns ?? [];
        const runtimeRequired = options.requiredColumns ?? [];
        const requiredColumns = Array.from(new Set([...staticRequired, ...runtimeRequired]));

        const readerOptions: CsvReaderOptions = {
            hasHeader: hasHeaderDefault,
            ...options,
            headerMapping: schema ? schema.headerToProperty : undefined,
            indexMapping: schema ? schema.indexToProperty : undefined,
            requiredColumns: requiredColumns.length > 0 ? requiredColumns : undefined,
        };

        return Csv.streamReader<T>(source, readerOptions);
    }

    /**
     * Creates an optimized CSV stream writer pre-configured for a decorated DTO class.
     * 
     * Column sequencing is resolved using the following priority:
     * 1. Dynamic `options.columnsOrder` if explicitly provided.
     * 2. Static `{ order: number }` values defined on `@CsvColumn` decorators.
     * 3. Natural property declaration order on the class prototype.
     *
     * @example
     * ```ts
     * // Columns ordered by @CsvColumn({ order: ... })
     * const writer = Csv.streamWriterWithClass(UserDto);
     * 
     * // Temporary runtime override: exports only specified columns in this exact sequence
     * const customWriter = Csv.streamWriterWithClass(UserDto, { columnsOrder: ["email", "name"] });
     * ```
     *
     * @template T The decorated target DTO class.
     * @param dtoClass Class constructor decorated with `@CsvColumn`.
     * @param options Additional writer settings, including runtime column reordering.
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
     * Streams and parses raw CSV data row-by-row as an async iterable.
     * Accepts a raw string, a text stream, or a binary byte stream (e.g. from `fetch` or file streams).
     *
     * @example
     * ```ts
     * for await (const row of Csv.streamReader(csvData, { delimiter: "auto", hasHeader: true })) 
     * {
     *   if (row.ok) console.log(row.data);
     * }
     * ```
     *
     * @template T Emitted row structure, defaults to `Record<string, string>`.
     * @param source Raw CSV text or readable stream.
     * @param options Parser configuration options.
     * @returns An async iterable yielding `CsvRowResult<T>` items.
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
            const streamAny = source as ReadableStream<unknown>;
            textStream = streamAny.pipeThrough(new TextDecoderStream()) as ReadableStream<string>;
        }

        return textStream.pipeThrough(new CsvReaderStream<T>(options));
    }

    /**
     * Creates a lightweight CSV writer handle supporting direct row serialization and streaming output.
     *
     * @example
     * ```ts
     * const writer = Csv.streamWriter({ headers: ["id", "name"] });
     * await writer.write({ id: 1, name: "Product" });
     * await writer.close();
     * ```
     *
     * @template T Input record or array row format.
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

        await pipeline(nodeReadable, fileDestination);
    }
}