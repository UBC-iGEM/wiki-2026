import type { NotionBlock } from "./notion";
import { $unsafe, $unsafeSync, ExporterError, isErr, type ExporterResult, type Result } from "./utils";
import axios from "axios";
import { parse } from "csv-parse/sync";

/**
 * Reading plate map CSVs at export time.
 *
 * Each CSV is one plate: the header row names the columns (1, 2, 3...), the first column names the rows (A, B, C...),
 * and every other cell is one well, written as `GROUP;WELL NAME;VALUE`.
 */

export interface Well {
    /** Index into the component's list of groups, which decides colour. */
    group: number;
    /** Shown on hover. */
    name: string;
    /** 0-1, how strongly the well is filled. */
    value: number;
}

export interface Plate {
    name: string;
    columns: string[];
    rows: { label: string; wells: (Well | null)[] }[];
}

type FileBlock = Extract<NotionBlock, { type: "file" }>;

/** Download the text of an uploaded or linked file. */
export async function fetchFileText(block: FileBlock): Promise<ExporterResult<string>> {
    const url = block.file.type === "file" ? block.file.file.url : block.file.external.url;
    const response = await $unsafe(async () => await axios.get(url, { responseType: "text", timeout: 30000 }));
    if (isErr(response)) return new ExporterError(`Could not download the file ${url}.`, ["notion server"], response);
    return String(response.data);
}

/**
 * Parse a plate CSV. Groups are looked up in (and added to) `groups`, so colours stay the same across plates.
 * Problems with single wells are returned as warnings and the well is left empty.
 */
export function parsePlate(
    name: string,
    csv: string,
    groups: string[],
): ExporterResult<{ plate: Plate; warnings: string[] }> {
    const records: Result<string[][]> = $unsafeSync(() =>
        parse(csv, {
            // Spreadsheet exports may start with a byte-order mark, pad cells and leave blank or ragged rows
            bom: true,
            trim: true,
            skip_empty_lines: true,
            skip_records_with_empty_values: true,
            relax_column_count: true,
        }),
    );
    if (isErr(records))
        return new ExporterError(`Plate "${name}" is not a readable CSV file.`, ["malformed content"], records);

    const [header, ...body] = records;
    if (header === undefined || header.length < 2 || body.length === 0)
        return new ExporterError(`Plate "${name}" needs a header row of column names and at least one row of wells.`, [
            "malformed content",
        ]);

    const columns = header.slice(1);
    const warnings: string[] = [];
    const rows = body.map((cells) => {
        const label = cells[0] ?? "";
        const wells = columns.map((column, i) => {
            const cell = cells[i + 1] ?? "";
            if (cell === "") return null;

            const well = parseWell(cell, groups);
            if (typeof well === "string") {
                warnings.push(`Plate "${name}" well ${label}${column}: ${well}; it was left empty.`);
                return null;
            }
            return well;
        });
        if (cells.length > columns.length + 1 && cells.slice(columns.length + 1).some((cell) => cell !== ""))
            warnings.push(
                `Plate "${name}" row ${label} has more cells than there are columns; the extras were dropped.`,
            );
        return { label, wells };
    });

    return { plate: { name, columns, rows }, warnings };
}

/** `GROUP;WELL NAME;VALUE`. The name may itself contain `;`. Returns a problem description if malformed. */
function parseWell(cell: string, groups: string[]): Well | string {
    const parts = cell.split(";");
    if (parts.length < 3) return `"${cell}" is not in the form GROUP;WELL NAME;VALUE`;

    const group = parts[0]!.trim();
    const name = parts.slice(1, -1).join(";").trim();
    const value_text = parts.at(-1)!.trim();
    if (group === "") return `"${cell}" has no group`;

    let value = Number(value_text);
    if (value_text === "" || !Number.isFinite(value)) return `"${value_text}" is not a number`;
    value = Math.min(1, Math.max(0, value));

    let index = groups.indexOf(group);
    if (index === -1) index = groups.push(group) - 1;
    return { group: index, name, value };
}
