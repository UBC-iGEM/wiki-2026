import * as log from "./log";
import { PageId } from "./notion";
import * as parse from "./parse";
import { clear, isErr, save } from "./utils";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

async function main(): Promise<void> {
    const master_id = process.env.MASTER;
    if (!master_id) log.error_and_quit("MASTER env. variable is unset!");

    const parse_map = await parse.parseMaster(new PageId(master_id));
    if (isErr(parse_map)) log.error_and_quit(parse_map);

    const clear_res = await clear();
    if (isErr(clear_res)) log.error_and_quit(clear_res);

    const content_map_json = JSON.stringify(parse_map, null, 4);
    const content_map_res = await save({ content: content_map_json, path: "content_map.json" });
    if (isErr(content_map_res)) log.warn_error("Failed to save content map!");

    await parse.exportAllPages({ content_map: parse_map });
}

main();
