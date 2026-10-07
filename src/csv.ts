import { CsvReaderStream } from "./reader.js";
import { CsvWriterStream, type RowInput } from "./writer.js";
import type { CsvReaderOptions, CsvWriterOptions } from "./types/CsvOption.js";
import type { CsvRowResult } from "./types/CsvRowResult.js";
import { ClassConstructor, getCsvSchema, CSV_SCHEMA_KEY } from "./decorator.js";

/**
 * Main entry point for reading and writing CSV files.
 * Works everywhere: Node.js, web browsers, and edge workers (like Cloudflare).
 */
export class Csv
{
    /**
     * Reads a CSV file and magically turns each row into a real TypeScript object.
     * 
     * Features:
     * - Automatically uses the first row as headers if your class uses `@CsvColumn`.
     * - Automatically converts text to Numbers, Booleans, or Dates.
     * - Handles huge files without crashing your app.
     *
     * @example
     * ```ts
     * // 1. Create your model
     * class User {
     *   @CsvColumn("Full Name") name!: string;
     *   @CsvColumn("Age", { type: "number" }) age!: number;
     * }
     * 
     * // 2. Read the file
     * const stream = fs.createReadStream("users.csv");
     * 
     * for await (const row of Csv.streamReaderWithClass(stream, User)) {
     *   if (row.ok) {
     *     // row.data is a real 'User' object!
     *     console.log(`Hello ${row.data.name}, you are ${row.data.age}`);
     *   } else {
     *     console.error(`Error on line ${row.line}: ${row.error.message}`);
     *   }
     * }
     * ```
     *
     * @template T The TypeScript class you want to use.
     * @param source The CSV text, or a stream of data (text or binary).
     * @param dtoClass Your class (must have a simple `constructor()` with no required arguments).
     * @param options Extra settings (like changing the delimiter).
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
     * Creates a CSV file directly from your TypeScript objects.
     * 
     * @example
     * ```ts
     * class Product {
     *   @CsvColumn("Title") title!: string;
     *   @CsvColumn("Price", { type: "number" }) price!: number;
     * }
     * 
     * // 1. Create the writer
     * const writer = Csv.streamWriterWithClass(Product, { writeBom: true });
     * 
     * // 2. Save it to a file
     * const saveTask = Csv.saveToFile(writer, "products.csv");
     * 
     * // 3. Write your data
     * await writer.write({ title: "Laptop", price: 999 });
     * await writer.write({ title: "Mouse", price: 25 });
     * 
     * // 4. Close and wait for the file to be saved
     * await writer.close();
     * await saveTask;
     * ```
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
     * Reads a raw CSV file row by row. 
     * Use this if you want something quick and don't want to use TypeScript classes (`@CsvColumn`).
     *
     * @example
     * ```ts
     * // Reading a simple file with headers (Name,Age)
     * const stream = fs.createReadStream("data.csv");
     * 
     * for await (const row of Csv.streamReader(stream, { hasHeader: true })) {
     *   if (row.ok) {
     *     console.log(row.data["Name"], row.data["Age"]);
     *   }
     * }
     * ```
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
     * Writes raw arrays or simple objects into a CSV file.
     * Great for simple, quick exports.
     *
     * @example
     * ```ts
     * const writer = Csv.streamWriter({ headers: ["id", "status"] });
     * 
     * await writer.write({ id: 1, status: "active" });
     * await writer.write({ id: 2, status: "pending" });
     * 
     * await writer.close();
     * ```
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
     * A handy helper for web servers (like Next.js, Express, or Cloudflare).
     * It turns your CSV writer into a downloadable file for the user's browser.
     *
     * @example
     * ```ts
     * // Inside a Next.js route or Hono handler:
     * const writer = Csv.streamWriter({ headers: ["id", "name"] });
     * 
     * // Start writing data in the background
     * writer.write({ id: 1, name: "Alice" }).then(() => writer.close());
     * 
     * // Send the download to the user immediately
     * return Csv.toResponse(writer, "users.csv");
     * ```
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
     * A handy helper for Node.js scripts. 
     * It saves everything you write directly to your computer's hard drive.
     *
     * @param writer The CSV writer you created.
     * @param filePath Where to save the file (e.g., `"./exports/my-data.csv"`).
    * @returns A Promise that resolves once all stream contents are successfully flushed to disk.
     * @throws {Error} If file writing fails (e.g., missing permissions or locked file).
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