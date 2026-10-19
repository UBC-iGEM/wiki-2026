import { $unsafeSync, ExporterError, isErr, type ExporterResult, type Result } from "./utils";
import { parse } from "csv-parse/sync";

/**
 * Reading plate map CSVs at export time.
 *
 * Each CSV is one plate, with one cell per well: the top-left cell is A1, the cell to its right A2, the first cell of
 * the second row B1, and so on. A cell is either empty (an empty well) or `CATEGORY;LABEL;BRIGHTNESS`.
 */

export interface Well {
    /** Index into the component's list of categories, which decides colour. */
    category: number;
    /** Shown on hover. */
    label: string;
    /** 0-1, how brightly the well is filled. */
    brightness: number;
}

export interface Plate {
    name: string;
    columns: number;
    rows: (Well | null)[][];
}

/**
 * Parse a plate CSV. Categories are looked up in (and added to) `categories`, so colours stay the same across plates.
 * Problems with single wells are returned as warnings and the well is left empty.
 */
export function parsePlate(
    name: string,
    csv: string,
    categories: string[],
): ExporterResult<{ plate: Plate; warnings: string[] }> {
    const records: Result<string[][]> = $unsafeSync(() =>
        parse(csv, {
            // Spreadsheet exports may start with a byte-order mark, pad cells and leave ragged rows. Rows of empty
            // cells are rows of empty wells, so only truly blank lines are skipped.
            bom: true,
            trim: true,
            skip_empty_lines: true,
            relax_column_count: true,
        }),
    );
    if (isErr(records))
        return new ExporterError(`Plate "${name}" is not a readable CSV file.`, ["malformed content"], records);
    if (records.length === 0) return new ExporterError(`Plate "${name}" has no wells.`, ["malformed content"]);

    const columns = Math.max(...records.map((cells) => cells.length));
    const warnings: string[] = [];
    const rows = records.map((cells, r) =>
        Array.from({ length: columns }, (_, c) => {
            const cell = cells[c] ?? "";
            if (cell === "") return null;

            const well = parseWell(cell, categories);
            if (typeof well === "string") {
                warnings.push(`Plate "${name}" well ${wellId(r, c)}: ${well}; it was left empty.`);
                return null;
            }
            return well;
        }),
    );

    return { plate: { name, columns, rows }, warnings };
}

/** `CATEGORY;LABEL;BRIGHTNESS`. The label may itself contain `;`. Returns a problem description if malformed. */
function parseWell(cell: string, categories: string[]): Well | string {
    const parts = cell.split(";");
    if (parts.length < 3) return `"${cell}" is not in the form CATEGORY;LABEL;BRIGHTNESS`;

    const category = parts[0]!.trim();
    const label = parts.slice(1, -1).join(";").trim();
    const brightness_text = parts.at(-1)!.trim();
    if (category === "") return `"${cell}" has no category`;

    let brightness = Number(brightness_text);
    if (brightness_text === "" || !Number.isFinite(brightness)) return `"${brightness_text}" is not a number`;
    brightness = Math.min(1, Math.max(0, brightness));

    let index = categories.indexOf(category);
    if (index === -1) index = categories.push(category) - 1;
    return { category: index, label, brightness };
}

/** The usual name of the well at row `r`, column `c` (both from 0): A1, B12, AA3... */
export function wellId(r: number, c: number): string {
    let row = "";
    for (let n = r + 1; n > 0; n = Math.floor((n - 1) / 26)) row = String.fromCharCode(65 + ((n - 1) % 26)) + row;
    return `${row}${c + 1}`;
}
