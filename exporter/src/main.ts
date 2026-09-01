import { CONFIG } from "./config";
import type { ContentMap } from "./map";
import { PageId } from "./notion";
import * as parse from "./parse";
import { clearPreviousOutputs, isExporterErr, saveFile } from "./utils";
import { saveZoteroDb } from "./zotero";

async function main(): Promise<void> {
    const parse_map_res = await parse.parseMaster(new PageId(CONFIG.master_id));
    if (isExporterErr(parse_map_res)) parse_map_res.logAndQuit();

    const clear_res = await clearPreviousOutputs();
    if (isExporterErr(clear_res)) clear_res.logAndQuit();

    const zotero_res = await saveZoteroDb();
    if (isExporterErr(zotero_res)) zotero_res.logAndQuit();

    const content_map_json = JSON.stringify(parse_map_res, null, 4);
    const content_map_res = await saveFile({ content: content_map_json, path: "content_map.json" });
    if (isExporterErr(content_map_res)) content_map_res.logAndQuit();

    await parse.exportAllPages({ content_map: parse_map_res as ContentMap });
}

await main();
