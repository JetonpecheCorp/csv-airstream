import { CsvReaderStream } from "./reader.js";
import { CsvWriterStream } from "./writer.js";
import type { CsvReaderOptions, CsvWriterOptions } from "./types/CsvOption.js";
import type { CsvRowResult } from "./types/CsvRowResult.js";

type RowInput = unknown[] | Record<string, unknown>;

/**
 * Main entry point for stream-based CSV reading and writing.
 */
export class Csv
{
    /**
     * Streams and parses CSV data row-by-row as an async iterable.
     * Accepts a raw string, a text stream, or a binary byte stream (e.g. from fetch or file inputs).
     * 
     * @example
     * ```ts
     * for await (const row of Csv.streamReader(csvData, { delimiter: "auto", hasHeader: true })) {
     *   if (row.ok) console.log(row.data);
     * }
     * ```
     * 
     * @template T Emitted row structure, defaults to Record<string, string>.
     * @param source Raw CSV text or readable stream.
     * @param options Parser configuration options.
     * @returns An async iterable emitting CsvRowResult items.
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
     * Creates a lightweight CSV writer handle supporting direct row writing and streaming output.
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
}