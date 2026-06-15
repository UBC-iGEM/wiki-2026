import { CONFIG } from "./config";
import { ExporterError, type ExporterResult, isErr, saveFile } from "./utils";
import zoteroApiClient, { type AnyResponse } from "zotero-api-client";

const LIMIT = 100;
const BIBTEX_PATH = "litdb.bib";
const zoteroApi =
    typeof zoteroApiClient === "function"
        ? zoteroApiClient
        : (zoteroApiClient as unknown as { default: typeof zoteroApiClient }).default;

function asError(err: unknown): Error {
    return err instanceof Error ? err : new Error(`${err}`);
}

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
        let response: AnyResponse;
        try {
            response = await zoteroApi().library("group", CONFIG.zotero_group_id).items().get({
                format: "bibtex",
                limit: LIMIT,
                start,
            });
        } catch (err) {
            return new ExporterError(
                `Failed to retrieve Zotero BibTeX page starting at item ${start}.`,
                ["zotero server"],
                asError(err),
            );
        }

        const raw_response = getRawResponse(response);
        if (raw_response === undefined) {
            return new ExporterError(
                `Expected Zotero BibTeX request to return a raw response, but received ${response.getResponseType()}.`,
                ["zotero server", "bug?"],
            );
        }

        const total_results = getTotalResults(raw_response);
        if (total_results === undefined) {
            return new ExporterError(
                `Zotero BibTeX response starting at item ${start} did not include a valid Total-Results header.`,
                ["zotero server"],
            );
        }

        const page_bibtex_res = await raw_response.text().catch(asError);
        if (isErr(page_bibtex_res)) {
            return new ExporterError(
                `Failed to read Zotero BibTeX response body starting at item ${start}.`,
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
