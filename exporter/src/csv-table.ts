import { $unsafeSync, ExporterError, isErr, type ExporterResult, type Result } from "./utils";
import { parse } from "csv-parse/sync";

/**
 * Reading an uploaded CSV at export time.
 *
 * The cells are written into the page itself, so the browser is never sent a CSV parser.
 */

/** The rows live in the page, so a long table has to stop somewhere. */
export const MAX_ROWS = 200;

export interface CsvTable {
    /** The first row holds the column names. */
    rows: string[][];
    /** Whether rows past {@link MAX_ROWS} were left out. */
    truncated: boolean;
}

/** Read a CSV into rows of equal width, with blank trailing columns dropped. */
export function parseCsvTable(file_name: string, csv: string): ExporterResult<CsvTable> {
    const records: Result<string[][]> = $unsafeSync(() =>
        parse(csv, {
            // Spreadsheet exports may start with a byte-order mark, pad cells and leave ragged rows
            bom: true,
            trim: true,
            skip_empty_lines: true,
            relax_column_count: true,
        }),
    );
    if (isErr(records))
        return new ExporterError(`"${file_name}" is not a readable CSV file.`, ["malformed content"], records);

    // A table cell is one line, so text wrapped inside a cell is joined up
    const rows = records.slice(0, MAX_ROWS).map((cells) => cells.map((cell) => cell.replace(/\s*\n\s*/g, " ")));

    // Formatting can leave empty cells past the content, which would show as blank columns
    const width = Math.max(0, ...rows.map((row) => row.findLastIndex((cell) => cell !== "") + 1));
    if (width === 0) return new ExporterError(`"${file_name}" has no cells to show.`, ["malformed content"]);

    return {
        rows: rows.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? "")),
        truncated: records.length > MAX_ROWS,
    };
}
