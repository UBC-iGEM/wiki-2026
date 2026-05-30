import { CONFIG } from "./config";
import * as log from "./log";
import { PageId } from "./notion";
import * as parse from "./parse";
import { clearPreviousOutputs, isErr, saveFile } from "./utils";

async function main(): Promise<void> {
    const parse_map = await parse.parseMaster(new PageId(CONFIG.master_id));
    if (isErr(parse_map)) log.errorAndQuit(parse_map);

    const clear_res = await clearPreviousOutputs();
    if (isErr(clear_res)) log.errorAndQuit(clear_res);

    const content_map_json = JSON.stringify(parse_map, null, 4);
    const content_map_res = await saveFile({ content: content_map_json, path: "content_map.json" });
    if (isErr(content_map_res)) log.warnError("Failed to save content map!");

    await parse.exportAllPages({ content_map: parse_map });
}

await main();
