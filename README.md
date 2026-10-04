# csv-airstream

A lightweight, zero-dependency CSV streaming library built on standard Web Streams. 
Designed for high-throughput data processing in Node.js, Deno, Bun, and modern browsers without memory spikes.

## Features

- **Standard Web Streams**: Native browser and Node.js interoperability without external polyfills.
- **Delimiter Sniffing**: Automatic delimiter detection (`auto`) evaluated against initial chunks.
- **Safe Memory Usage**: Parses gigabyte-sized files sequentially without buffering entire datasets.
- **Result Pattern**: Returns explicit `{ ok: true, data }` or `{ ok: false, error }` objects without breaking parsing streams.
- **Per-Cell Validation**: Inline business validation hooks emitting standard or customized error codes.
- **RFC 4180 Compliant**: Handles multiline cells, escaped double quotes, and UTF-8 BOM headers automatically.

## Installation

```bash
npm install csv-airstream
```

## Quick Start
### Basic Reading
Iterate directly through rows using `for await:``

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
import { Csv, type CsvRowResult } from "csv-airstream";

// Interface describing row shape
interface ProductRecord {
    id: string;
    sku: string;
    price: string;
    stock: string;
}

// Sample messy CSV: metadata comments, semicolons, empty lines, and dirty records
const rawData = `\uFEFF# Production Inventory Export
# Generated on 2026-10-04
id;sku;price;stock

1;TECH-101;299.90;15
2;"TECH;202";14.50;50
3;BAD-PRICE;not_a_number;10
4;CORRUPT-ROW;19.99
5;TECH-303;89.00;0
`;

async function processInventory() 
{
    // Read using automatic delimiter sniffing and strict rules
    const reader = Csv.streamReader<ProductRecord>(rawData, {
        delimiter: "auto",             // Infers ';' automatically from the sample
        hasHeader: true,               // Treats first non-comment line as record keys
        comment: "#",                  // Skips metadata header comments
        skipEmptyLines: true,          // Drops whitespace and empty delimiter rows
        trim: true,                    // Trims outer whitespace from fields
        strictColumnCount: true,       // Emits COLUMN_COUNT_MISMATCH on irregular rows
        validateCell: (value, { columnName }) => 
        {
            // Cell-level schema checks
            if (columnName === "price" && isNaN(Number(value)))
                return "INVALID_NUMERIC_PRICE"; // Custom error code

            return true;
        }
  });

  // Prepare a streaming writer to collect clean records
  const cleanWriter = Csv.streamWriter<ProductRecord>({
    delimiter: ",",
    lineTerminator: "\n",
    headers: ["id", "sku", "price", "stock"],
  });

  // Process rows sequentially
    for await (const result of reader) 
    {
        if (result.ok) 
        {
            // Valid record: Forward to export writer
            await cleanWriter.write(result.data);
        } 
        else 
        {
            // Error handling without crashing the stream
            console.warn(
                `[Ignored] Line ${result.line} failed with code "${result.error.code}": ` +
                `${result.error.message} (value: "${result.error.invalidValue ?? ""}")`
            );
        }
    }

    await cleanWriter.close();
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

## License
MIT
