/**
 * Reading plate map CSVs, at export time to check them and in the browser to show them.
 *
 * Each CSV is one plate, with one cell per well: the top-left cell is A1, the cell to its right A2, the first cell of
 * the second row B1, and so on. A cell is either empty (an empty well) or `CATEGORY;LABEL;BRIGHTNESS`.
 *
 * Nothing here may import from Node or the rest of the exporter, as `Platemap.astro` sends it to the browser.
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
 * Problems with single wells are returned as warnings and the well is left empty; a plate that can't be read at all
 * gives a description of the problem instead.
 */
export function parsePlate(
    name: string,
    csv: string,
    categories: string[],
): { plate: Plate; warnings: string[] } | string {
    const records = readCsv(csv);
    if (records === undefined) return `Plate "${name}" is not a readable CSV file (a quote is never closed).`;
    if (records.length === 0) return `Plate "${name}" has no wells.`;

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

/**
 * The cells of a CSV, trimmed. Spreadsheet exports may start with a byte-order mark, pad cells and leave ragged rows;
 * rows of empty cells are rows of empty wells, so only truly blank lines are skipped. Undefined if a quote is left open.
 */
function readCsv(csv: string): string[][] | undefined {
    const text = csv.replace(/^﻿/, "");
    const records: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    // Whether anything has been read on this line, so a blank line can be told from a row of one empty cell
    let started = false;

    const endCell = (): void => {
        row.push(cell.trim());
        cell = "";
    };
    const endRow = (): void => {
        if (started) {
            endCell();
            records.push(row);
        }
        row = [];
        started = false;
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (quoted) {
            if (char !== '"') cell += char;
            else if (text[i + 1] === '"') cell += text[++i];
            else quoted = false;
        } else if (char === '"') {
            quoted = started = true;
        } else if (char === ",") {
            started = true;
            endCell();
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[i + 1] === "\n") i++;
            endRow();
        } else {
            cell += char;
            if (char.trim() !== "") started = true;
        }
    }
    if (quoted) return undefined;
    endRow();
    return records;
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
