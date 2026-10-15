import { $unsafe, ExporterError, isErr, type ExporterResult } from "./utils";
import ExcelJS from "exceljs";

/**
 * Reading an uploaded spreadsheet at export time.
 *
 * The cells are written into the page itself, so the browser is never sent a spreadsheet parser.
 */

/** The rows live in the page, so a long sheet has to stop somewhere. */
export const MAX_ROWS = 200;

export interface Sheet {
    name: string;
    /** The first row holds the column names. */
    rows: string[][];
    /** Whether rows past {@link MAX_ROWS} were left out. */
    truncated: boolean;
}

/** Read the sheets of an `.xlsx` or `.xlsm` workbook. Sheets without any cells are dropped. */
export async function readWorkbook(file_name: string, data: Buffer): Promise<ExporterResult<Sheet[]>> {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS reads a plain ArrayBuffer, so the download's bytes are handed over without their Buffer view
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const loaded = await $unsafe(async () => await workbook.xlsx.load(bytes));
    if (isErr(loaded))
        return new ExporterError(`"${file_name}" is not a readable spreadsheet.`, ["malformed content"], loaded);

    const sheets = workbook.worksheets.map(readSheet).filter((sheet) => sheet.rows.length > 0);
    if (sheets.length === 0) return new ExporterError(`"${file_name}" has no cells to show.`, ["malformed content"]);

    return sheets;
}

function readSheet(sheet: ExcelJS.Worksheet): Sheet {
    const rows: string[][] = [];
    for (let r = 1; r <= Math.min(sheet.rowCount, MAX_ROWS); r++) {
        const row = sheet.getRow(r);
        rows.push(
            // A table cell is one line, so text wrapped inside a cell is joined up
            Array.from({ length: sheet.columnCount }, (_, c) =>
                cellToText(row.getCell(c + 1).value).replace(/\s*\n\s*/g, " "),
            ),
        );
    }

    return { name: sheet.name, rows: trimBlank(rows), truncated: sheet.rowCount > MAX_ROWS };
}

/** Formatting can leave empty cells past the content, which would show as blank rows and columns. */
function trimBlank(rows: string[][]): string[][] {
    while (rows.length > 0 && rows.at(-1)!.every((cell) => cell === "")) rows.pop();

    const width = Math.max(0, ...rows.map((row) => row.findLastIndex((cell) => cell !== "") + 1));
    return width === 0 ? [] : rows.map((row) => row.slice(0, width));
}

/** Flatten what a cell can hold (rich text, a link, a formula result, an error) into its text. */
function cellToText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value !== "object") return String(value);
    if ("richText" in value) return value.richText.map((run) => run.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return cellToText(value.result ?? "");
    if ("error" in value) return String(value.error);
    return "";
}
