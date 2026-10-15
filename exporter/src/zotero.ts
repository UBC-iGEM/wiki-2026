import { CONFIG } from "./config";
import { $unsafe, $withRetries, ExporterError, type ExporterResult, isErr, saveFile } from "./utils";
import zoteroApiClient, { type AnyResponse, type MultiReadResponse } from "zotero-api-client";

const LIMIT = 100;
export const LITDB_PATH = "litdb.json";
const zoteroApi =
    typeof zoteroApiClient === "function"
        ? zoteroApiClient
        : (zoteroApiClient as unknown as { default: typeof zoteroApiClient }).default;

/**
 * A literature entry, with its reference already formatted by Zotero.
 *
 * @property citation_key the entry's citation key, which IDs it on the wiki
 * @property bib the formatted reference as HTML, without its number
 */
export interface LitEntry {
    citation_key: string;
    bib: string;
}

/** Saved to {@link LITDB_PATH} for the wiki to render citations from, keyed by {@link LitEntry.citation_key} */
export type LitDb = Record<string, LitEntry>;

/** The parts of a Zotero API item this reads. */
interface ZoteroItem {
    key: string;
    bib?: string;
    data: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        citationKey?: string;
    };
}

let LITDB: LitDb | null = null;

/**
 * Retrieves the group library with each reference formatted by Zotero,
 * saves it for the wiki, and keeps it for {@link findLiterature}.
 */
export async function saveZoteroDb(): Promise<ExporterResult<void>> {
    const items: ZoteroItem[] = [];

    for (let start = 0; ; start += LIMIT) {
        const response = await $withRetries($unsafe, () =>
            zoteroApi().library("group", CONFIG.zotero_group_id).items().top().get({
                format: "json",
                include: "data,bib",
                style: CONFIG.zotero_style,
                linkwrap: "1",
                limit: LIMIT,
                start,
            }),
        );
        if (isErr(response)) {
            return new ExporterError(
                `Failed to retrieve literature list from Zotero, starting at item ${start}.`,
                ["zotero server"],
                response,
            );
        }

        if (!isMultiRead(response)) {
            return new ExporterError(
                `Zotero returned a response in a format that could not be understood.`,
                ["zotero server", "bug?"],
                new Error(`Returned response type: ${response.getResponseType()}`),
            );
        }

        const page = response.raw as ZoteroItem[];
        items.push(...page);

        const total_results = response.getTotalResults();
        if (total_results === null) {
            return new ExporterError(
                `Zotero returned a response without the expected headers, starting at item ${start}.`,
                ["zotero server"],
            );
        }
        if (page.length === 0 || start + LIMIT >= total_results) break;
    }

    const litdb: LitDb = {};
    for (const item of items) {
        const citation_key = item.data.citationKey?.trim();
        const bib = item.bib ? referenceHtml(item.bib) : undefined;
        if (!citation_key || !bib) {
            new ExporterError(
                `Zotero item ${item.key} has no ${citation_key ? "formatted reference" : "citation key"}, so it can't be cited.`,
                ["zotero server"],
            ).warn();
            continue;
        }
        litdb[citation_key] = { citation_key, bib };
    }
    LITDB = litdb;

    return await saveFile({ content: JSON.stringify(litdb, null, 4), path: LITDB_PATH });
}

function isMultiRead(response: AnyResponse): response is MultiReadResponse {
    return response.getResponseType() === "MultiReadResponse" && Array.isArray(response.raw);
}

/**
 * Zotero formats a lone item as a one-entry bibliography, numbered 1.
 * Keeps only the reference itself, so the wiki can number it within each page.
 */
function referenceHtml(bib: string): string | undefined {
    const inline = bib.match(/<div class="csl-right-inline"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*$/)?.[1];
    // Styles without numbers have no margin column
    const entry = inline ?? bib.match(/<div class="csl-entry"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*$/)?.[1];
    return entry?.trim() || undefined;
}

/**
 * Finds a literature entry by its citation key.
 */
export function findLiterature(citation_key: string): LitEntry | undefined {
    return LITDB?.[citation_key];
}
