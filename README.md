# csv-airstream

A lightweight, zero-dependency CSV streaming library built on standard Web Streams.
Designed for high-throughput data processing in Node.js, Deno, Bun, and modern browsers without memory spikes.

## Features

- **Standard Web Streams**: Native browser and Node.js interoperability without external polyfills.
- **DTO Decorator Support**: Map complex header labels (e.g. name *, is active (0, 1) *) and column indices to typed class models using `@CsvColumn` and `@CsvIndex`.
- **Zero Overhead Mapping**: Resolves schema columns once during header initialization for direct O(1) indexed reads and writes.
- **Delimiter Sniffing**: Automatic delimiter detection (`auto`) evaluated against initial chunks.
- **Safe Memory Usage**: Parses gigabyte-sized files sequentially without buffering entire datasets.
- **Result Pattern**: Returns explicit `{ ok: true, data }` or `{ ok: false, error }` objects without breaking parsing streams.
- **Schema & Cell Validation**: Built-in required column enforcement and per-cell custom validators.
- **Direct Export Helpers**: Built-in utilities to pipe directly to local files (`saveToFile`) or HTTP download responses (`toResponse`).
- **RFC 4180 Compliant**: Handles multiline cells, escaped double quotes, and UTF-8 BOM headers automatically.

## Installation

```bash
npm install @jetonpeche/csv-airstream
```

## Quick Start
### 1. Class DTO Mapping
Bind real-world CSV headers directly to clean TypeScript properties:

```ts
import { Csv, CsvColumn } from "@jetonpeche/csv-airstream";

class UserDto 
{
    @CsvColumn("name *", { required: true, order: 0 })
    name!: string;

    @CsvColumn("is active (0, 1) *", { order: 1 })
    isActive!: string;
}

// 1. Streaming Read: auto-maps headers and validates required fields
const csvData = `name *;is active (0, 1) *
Jane Doe;1`;

for await (const row of Csv.streamReaderWithClass(csvData, UserDto, { delimiter: "auto" })) 
{
    if (row.ok)
        console.log(row.data.name, row.data.isActive);
}

// 2. Streaming Write: automatically outputs configured headers in order
const writer = Csv.streamWriterWithClass(UserDto, { delimiter: ";" });

await writer.write({ name: "Jane Doe", isActive: "1" });
await writer.close();
```

### 2. Headerless CSVs with `@CsvIndex`
Parse files without headers by binding properties directly to zero-based column indices:

```ts
import { Csv, CsvIndex } from "@jetonpeche/csv-airstream";

class LogEntryDto 
{
    @CsvIndex(0, { required: true })
    timestamp!: string;

    @CsvIndex(1)
    level!: string;

    @CsvIndex(2)
    message!: string;
}

const rawLogs = `2026-10-06T08:00:00Z,INFO,Worker initialized
2026-10-06T08:00:01Z,WARN,High memory usage detected`;

for await (const row of Csv.streamReaderWithClass(rawLogs, LogEntryDto)) 
{
    if (row.ok)
        console.log(`[${row.data.level}] ${row.data.timestamp}: ${row.data.message}`);
}
```

### 3. ow-Level Untyped Streams
For dynamic files without predefined schemas:

```ts
import { Csv } from "@jetonpeche/csv-airstream";

const rawCsv = `id,name,price
1,Keyboard,49.99
2,"Wireless Mouse",24.50`;

for await (const row of Csv.streamReader(rawCsv, { hasHeader: true })) 
{
    if (row.ok)
        console.log(`Line ${row.line}: ${row.data.name} ($${row.data.price})`);
}
```

## Comprehensive Example
The following scenario processes a messy incoming inventory file:
- Sniffs separators automatically (delimiter: "auto").   
- Strips BOM markers and metadata comments.   
- Remaps complex multi-word CSV labels into typed properties.   
- Re-orders columns on export and streams the output directly to disk.

```ts
import { Csv, CsvColumn, type CsvRowResult } from "@jetonpeche/csv-airstream";

// 1. Declare the DTO with complex column labels and output priorities
class InventoryItemDto {
    @CsvColumn("product sku #", { required: true, order: 0 })
    sku!: string;

    @CsvColumn("product name *", { required: true, order: 1 })
    name!: string;

    @CsvColumn("unit price (usd)", { required: true, order: 2 })
    price!: string;

    @CsvColumn("in stock", { order: 3 })
    stock!: string;
}

// Dirty CSV sample: BOM, comments, semicolons, extra spacing, and an invalid row
const dirtyCsv = `\uFEFF# Inventory Export Batch 42
# Generated: 2026-10-06
product name *;product sku #;unit price (usd);in stock
Mechanical Keyboard;TECH-101;129.99;15
Wireless Mouse;TECH-202;39.50;50
;TECH-303;19.99;0
Monitor 27";DISP-404;249.00;8
`;

async function runInventoryPipeline() 
{
    // Read and parse into typed InventoryItemDto instances
    const reader = Csv.streamReaderWithClass(dirtyCsv, InventoryItemDto, {
        delimiter: "auto",
        comment: "#",
        trim: true,
        strictColumnCount: true,
        validateCell: (value, { columnName }) => 
        {
            if (columnName === "unit price (usd)" && Number(value) < 0)
                return "NEGATIVE_PRICE_FORBIDDEN";

            return true;
        },
    });

    // Prepare a clean CSV writer exporting to disk
    const writer = Csv.streamWriterWithClass(InventoryItemDto, { delimiter: "," });
    const savePromise = Csv.saveToFile(writer, "./clean_inventory.csv");

    let successCount = 0;
    let failureCount = 0;

    for await (const row of reader) 
    {
        if (row.ok) 
        {
            // Data is strictly typed as InventoryItemDto
            await writer.write(row.data);
            successCount++;
        } 
        else 
        {
            failureCount++;
            console.warn(
                `Line ${row.line} skipped [${row.error.code}]: ${row.error.message}`
            );
        }
    }

    await writer.close();
    await savePromise;

    console.log(`Finished: ${successCount} exported, ${failureCount} rejected.`);
}

runInventoryPipeline();
```

## File Export & Web Downloads
```ts
import { Csv, CsvColumn } from "@jetonpeche/csv-airstream";

class ExportDto 
{
    @CsvColumn("ID", { order: 0 })
    id!: string;

    @CsvColumn("Title", { order: 1 })
    title!: string;
}

const writer = Csv.streamWriterWithClass(ExportDto);
const fileSave = Csv.saveToFile(writer, "./exports/report.csv");

await writer.write({ id: "1", title: "Stream Processing" });
await writer.write({ id: "2", title: 'Escaped "Quotes"' });
await writer.close();

await fileSave;
```

## HTTP File Download
Return a streaming Web `Response` with configured `Content-Disposition` headers:

```ts
import { Csv, CsvColumn } from "@jetonpeche/csv-airstream";

class CustomerDto
{
    @CsvColumn("customer_id")
    id!: string;

    @CsvColumn("full_name")
    name!: string;
}

export async function GET() 
{
    const writer = Csv.streamWriterWithClass(CustomerDto);

    (async () => {
        await writer.write({ id: "101", name: "Alice Smith" });
        await writer.write({ id: "102", name: "Bob Jones" });
        await writer.close();
    })();

    // Returns a native Web API Response with Content-Disposition headers
    return Csv.toResponse(writer, "customers.csv");
}
```

## API Reference

### Decorators
`@CsvColumn(header, options?)`
Maps a class property to an explicit CSV header string.

| Parameter |Type | Description |
|:--- |:--- |:--- |
| `header` | `string` | Header text in the CSV source file. |
| `options.required` | `boolean` | Rejects row if the field resolves to an empty string. |
| `options.order` | `number` | Output column order priority when serializing (e.g. 0, 1, 2). |

`@CsvIndex(index, options?)`
Maps a class property directly to a zero-based column position.

| Parameter |Type | Description |
|:--- |:--- |:--- |
| `index` | `number` | Zero-based column index in the line. |
| `options.required` | `boolean` | Rejects row if the field resolves to an empty string. |

### Class DTO Methods
`Csv.streamReaderWithClass(source, dtoClass, options?)`  
Streams and parses a CSV source directly into typed instances of a decorated DTO class.   

- Automatically enables `hasHeader: true` if `@CsvColumn` decorators exist.   
- Auto-registers `requiredColumns` defined in metadata.   
- Resolves column index lookups once during stream start for O(1) row parsing. 

`Csv.streamWriterWithClass(dtoClass, options?)`  
Creates a streaming CSV writer configured from a decorated DTO class.

| Parameter |Type | Default | Description |
|:--- |:--- |:--- |:--- |
| `columnsOrder` | `(keyof T)[]` | `undefined` | Overrides the DTO's default export column order at runtime. |
| `delimiter` | `string` | `","` | Separator character placed between values. |
| `lineTerminator` | `"\r\n" \| "\n"` | "\r\n" | Line ending appended after each record.  |
| `quoteChar` `| `string` | `"` | Quote character wrapping fields with special characters. |
| `alwaysQuote` | `boolean` | `false` | Enforces quotes around every cell. |

### Low-Level Stream Methods
`Csv.streamReader(source, options?)`  
Reads raw CSV data and yields `CsvRowResult<T>` records.

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

`Csv.streamWriter(options?)`  
Creates a low-level untyped streaming writer handle.   

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
