# csv-airstream

A lightweight, zero-dependency CSV streaming library built on standard Web Streams. 
Designed for high-throughput data processing in Node.js, Deno, Bun, and modern browsers without memory spikes.

## Features

- **Standard Web Streams**: Native browser and Node.js interoperability without external polyfills.
- **Delimiter Sniffing**: Automatic delimiter detection (`auto`) evaluated against initial chunks.
- **Safe Memory Usage**: Parses gigabyte-sized files sequentially without buffering entire datasets.
- **Result Pattern**: Returns explicit `{ ok: true, data }` or `{ ok: false, error }` objects without breaking parsing streams.
- **Schema & Cell Validation**: Built-in `requiredColumns` enforcement and per-cell custom validators.
- **Direct Export Helpers**: Built-in utilities to pipe directly to local files (`saveToFile`) or HTTP download responses (`toResponse`).
- **RFC 4180 Compliant**: Handles multiline cells, escaped double quotes, and UTF-8 BOM headers automatically.

## Installation

```bash
npm install @jetonpeche/csv-airstream
```

## Quick Start
### Basic Reading
Iterate directly through rows using `for await:`

```ts
import { Csv } from "csv-airstream";

const rawCsv = `id,name,price
1,Keyboard,49.99
2,"Wireless Mouse",24.50`;

for await (const row of Csv.streamReader(rawCsv, { hasHeader: true })) 
{
    if (row.ok) 
    {
        console.log(`Line ${row.line}: ${row.data.name} ($${row.data.price})`);
    }
}
```

### Basic Writing
Generate formatted CSV chunks on the fly:

```ts
import { Csv } from "csv-airstream";

const writer = Csv.streamWriter({
    delimiter: ",",
    headers: ["id", "title"]
});

// Write data
await writer.write({ id: 1, title: "Streaming Architecture" });
await writer.write({ id: 2, title: 'Using "Quotes" Safely' });
await writer.close();

// Read generated CSV chunks
for await (const chunk of writer.readable) 
{
    process.stdout.write(chunk);
}
```

## Comprehensive Example
The following example covers binary stream decoding, delimiter auto-detection, UTF-8 BOM handling, comment lines, column count enforcement, custom data validation, and pipe streaming.

```ts
import { Csv, type CsvRowResult } from "@jetonpeche/csv-airstream";

interface ProductRecord 
{
    id: string;
    sku: string;
    price: string;
    stock: string;
}

// Sample messy CSV: metadata comments, semicolons, empty lines, and invalid cells
const rawData = `\uFEFF# Production Inventory Export
# Generated on 2026-10-04
id;sku;price;stock

1;TECH-101;299.90;15
2;"TECH;202";14.50;50
3;BAD-PRICE;not_a_number;10
4;;19.99;5
5;CORRUPT-ROW;19.99
6;TECH-303;89.00;0
`;

async function processInventory() 
{
    // Read using automatic delimiter sniffing and strict schema constraints
    const reader = Csv.streamReader<ProductRecord>(rawData, {
        delimiter: "auto",               // Infers ';' automatically from sample lines
        hasHeader: true,                 // Treats first non-comment line as record keys
        comment: "#",                    // Skips metadata header comments
        skipEmptyLines: true,            // Drops whitespace and empty delimiter rows
        trim: true,                      // Trims outer whitespace from fields
        strictColumnCount: true,         // Rejects rows with mismatched column count
        requiredColumns: ["id", "sku"],  // Rejects rows where id or sku are empty
        validateCell: (value, { columnName }) => 
        {
            // Custom cell validation
            if (columnName === "price" && isNaN(Number(value))) 
            {
                return "INVALID_NUMERIC_PRICE";
            }
            return true;
        }
    });

    // Prepare a streaming writer to collect clean records
    const cleanWriter = Csv.streamWriter<ProductRecord>({
        delimiter: ",",
        lineTerminator: "\n",
        headers: ["id", "sku", "price", "stock"]
    });

    // Pipe valid output directly to file on disk
    const savePromise = Csv.saveToFile(cleanWriter, "./clean_inventory.csv");

    // Process rows sequentially
    for await (const result of reader) 
    {
        if (result.ok) 
        {
            await cleanWriter.write(result.data);
        } 
        else 
        {
            console.warn(
                `[Ignored] Line ${result.line} failed with code "${result.error.code}": ` +
                `${result.error.message} (value: "${result.error.invalidValue ?? ""}")`
            );
        }
    }

    await cleanWriter.close();
    await savePromise;
}

processInventory();
```

## Upload
```ts
import { Csv } from "csv-airstream";

const writer = Csv.streamWriter({
    delimiter: ",",
    headers: ["id", "title"]
});

// Active saving on disk
const savePromise = Csv.saveToFile(writer, testFilePath);

// Write data
await writer.write({ id: 1, title: "Streaming Architecture" });
await writer.write({ id: 2, title: 'Using "Quotes" Safely' });
await writer.close();

// await complete write on disk
await savePromise;
```

## Download
```ts
import { Csv } from "csv-airstream";

export async function GET()
{
    const writer = Csv.streamWriter({
        delimiter: ";",
        headers: ["id", "name", "price"],
    });

    // Write records asynchronously
    (async () => {
        await writer.write({ id: 1, name: "Keyboard", price: "49.90" });
        await writer.write({ id: 2, name: "Mouse", price: "29.90" });
        await writer.close();
    })();

    // Returns a Web API Response with Content-Disposition headers
    return Csv.toResponse(writer, "inventory.csv");
}
```

## API Reference

### `Csv.streamReader(source, options?)`

Reads CSV data from a string or stream and yields row results sequentially.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `source` | `string \| ReadableStream` | *Required* | Raw CSV string, text stream, or byte stream (`Uint8Array`). |
| `delimiter` | `string \| "auto"` | `","` | Value separator, or `"auto"` to sniff it from the first lines. |
| `delimiterCandidates`| `string[]` | `[",", ";", "\t", "\|"]` | Characters tested when delimiter sniffing is enabled. |
| `hasHeader` | `boolean` | `false` | Emits objects keyed by the first row instead of string arrays. |
| `requiredColumns` | `(string \| number)[]` | `undefined` | Columns that must not be empty (names or zero-based indexes). |
| `validateCell` | `Function` | `undefined` | Callback `(value, context) => boolean \| string` to validate values. |
| `strictColumnCount`| `boolean` | `true` | Rejects rows that do not match the expected column count. |
| `trim` | `boolean` | `false` | Trims leading and trailing whitespace from unquoted values. |
| `skipEmptyLines` | `boolean` | `false` | Drops blank lines and rows containing only separators. |
| `comment` | `string` | `undefined` | Ignores lines starting with this prefix (e.g. `"#"`). |
| `quoteChar` | `string` | `'"'` | Quote character used for escaping special characters. |
| `escapeChar` | `string` | `'"'` | Escape character used inside quoted values. |

**Returns:** `AsyncIterable<CsvRowResult<T>>` emitting either `{ ok: true, data }` or `{ ok: false, error }`.

### `Csv.streamWriter(options?)`

Creates a streaming CSV writer handle.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `headers` | `string[]` | `undefined` | Column headers list. Required to guarantee object key order. |
| `delimiter` | `string` | `","` | Value separator placed between fields. |
| `lineTerminator` | `"\r\n" \| "\n"` | `"\r\n"` | Line ending appended after each record. |
| `quoteChar` | `string` | `'"'` | Quote character wrapping fields with special characters. |
| `alwaysQuote` | `boolean` | `false` | Enforces double quotes around every cell unconditionally. |

**Writer Handle Methods:**

| Method / Property | Type | Description |
| :--- | :--- | :--- |
| `write(row)` | `(row: T) => Promise<void>` | Enqueues an object record or array row into the stream. |
| `close()` | `() => Promise<void>` | Flushes all remaining buffers and closes the stream. |
| `abort(reason?)` | `(reason?: any) => Promise<void>` | Immediately halts stream processing. |
| `readable` | `ReadableStream<string>` | Web stream emitting generated CSV text chunks. |

### Helper Utilities

Direct export functions designed for local storage and HTTP endpoints.

| Method | Parameters | Returns | Description |
| :--- | :--- | :--- | :--- |
| `Csv.toResponse(writer, filename?)` | `writer`, `filename = "export.csv"` | `Response` | Wraps `writer.readable` in a Web `Response` with attachment headers. |
| `Csv.saveToFile(writer, filePath)` | `writer`, `filePath: string` | `Promise<void>` | Direct pipe to disk in Node.js, Deno, or Bun. |

## License
MIT
