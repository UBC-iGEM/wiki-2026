import { CONFIG } from "./config";
import { $unsafe, $withRetries, ExporterError, type ExporterResult, isErr, saveFile } from "./utils";
import zoteroApiClient, { type AnyResponse } from "zotero-api-client";

const LIMIT = 100;
const BIBTEX_PATH = "litdb.bib";
const zoteroApi =
    typeof zoteroApiClient === "function"
        ? zoteroApiClient
        : (zoteroApiClient as unknown as { default: typeof zoteroApiClient }).default;

function getRawResponse(response: AnyResponse): Response | undefined {
    const raw = response.raw;
    if (response.getResponseType() !== "RawApiResponse") return undefined;
    if (!(raw instanceof Response)) return undefined;

    return raw;
}

function getTotalResults(response: Response): number | undefined {
    const total = response.headers.get("Total-Results");
    if (total === null) return undefined;

    const parsed = Number.parseInt(total, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
}

export async function saveZoteroDb(): Promise<ExporterResult<void>> {
    let start = 0;
    let bibtex = "";

    while (true) {
        const response = await $withRetries($unsafe, () =>
            zoteroApi().library("group", CONFIG.zotero_group_id).items().get({
                format: "bibtex",
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

        const raw_response = getRawResponse(response);
        if (raw_response === undefined) {
            return new ExporterError(
                `Zotero returned a response in a format that could not be understood.`,
                ["zotero server", "bug?"],
                new Error(`Returned response type: ${response.getResponseType()}`),
            );
        }

        const total_results = getTotalResults(raw_response);
        if (total_results === undefined) {
            return new ExporterError(
                `Zotero returned a response without the expected headers, starting at item ${start}.`,
                ["zotero server"],
            );
        }

        const page_bibtex_res = await $unsafe(() => raw_response.text());
        if (isErr(page_bibtex_res)) {
            return new ExporterError(
                `Failed to read Zotero response, starting at item ${start}.`,
                ["zotero server"],
                page_bibtex_res,
            );
        }

        bibtex += page_bibtex_res;
        if (start + LIMIT >= total_results) break;

        start += LIMIT;
    }

    return await saveFile({ content: bibtex, path: BIBTEX_PATH });
}
