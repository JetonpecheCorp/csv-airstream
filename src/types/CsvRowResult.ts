import { CsvErrorDetail } from "./errorCsv.js";

/**
 * Successful row parsing result.
 */
export interface CsvRowSuccess<T = string[]> 
{
    ok: true;
    line: number;
    data: T;
}

/**
 * Failed row parsing result containing error details.
 */
export interface CsvRowFailure 
{
    ok: false;
    line: number;
    error: CsvErrorDetail;
    raw?: string;
}

/**
 * Result pattern variant emitted for each processed row.
 * Type parameter `T` defaults to `string[]`, or `Record<string, string>` when headers are enabled.
 */
export type CsvRowResult<T = string[]> = CsvRowSuccess<T> | CsvRowFailure;