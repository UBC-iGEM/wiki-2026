import { $unsafe, $unsafeSync, ExporterError, isErr, type ExporterResult, type Result } from "../utils";
import axios from "axios";

/**
 * Reading a Colab notebook at export time.
 *
 * The wiki cannot run Python, so the notebook's source is frozen into the page and the live
 * notebook is left a click away on Colab.
 */

/** Colab notebooks live on Drive, whose file id is the last part of the share URL. */
const COLAB_URL_PATTERN = /^https:\/\/colab\.research\.google\.com\/drive\/([\w-]+)/;

export interface Notebook {
    code: string;
    cell_count: number;
}

/** Pull the Drive file id out of a Colab link, or nothing if it is not one. */
export function parseColabFileId(url: string): string | undefined {
    return COLAB_URL_PATTERN.exec(url.trim())?.[1];
}

/**
 * Fetch a notebook from Drive and join its code cells into one listing.
 * The file id comes from {@link parseColabFileId}, so only Drive is ever requested.
 */
export async function fetchNotebookCode(file_id: string): Promise<ExporterResult<Notebook>> {
    const response = await $unsafe(
        async () =>
            await axios.get(`https://drive.google.com/uc?export=download&id=${file_id}`, {
                responseType: "text",
                timeout: 30000,
            }),
    );
    if (isErr(response))
        return new ExporterError(
            `Could not download the Colab notebook ${file_id}. Check that it is shared with "anyone with the link".`,
            ["notion server"],
            response,
        );

    const notebook: Result<unknown> = $unsafeSync(JSON.parse, String(response.data));
    if (isErr(notebook) || !isNotebook(notebook))
        return new ExporterError(
            `The Colab notebook ${file_id} did not come back as a notebook. Check that it is shared with "anyone with the link".`,
            ["malformed content"],
        );

    const code_cells = notebook.cells
        .filter((cell) => cell.cell_type === "code")
        .map((cell) => (typeof cell.source === "string" ? cell.source : cell.source.join("")).trimEnd())
        .filter((source) => source !== "");

    return { code: code_cells.join("\n\n"), cell_count: code_cells.length };
}

interface NotebookJson {
    cells: { cell_type: string; source: string | string[] }[];
}

function isNotebook(value: unknown): value is NotebookJson {
    if (typeof value !== "object" || value === null || !("cells" in value)) return false;

    const { cells } = value as { cells: unknown };
    return (
        Array.isArray(cells) &&
        cells.every(
            (cell: unknown) =>
                typeof cell === "object" &&
                cell !== null &&
                typeof (cell as { cell_type?: unknown }).cell_type === "string" &&
                (typeof (cell as { source?: unknown }).source === "string" ||
                    Array.isArray((cell as { source?: unknown }).source)),
        )
    );
}
