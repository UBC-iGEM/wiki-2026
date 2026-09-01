import { CONFIG } from "./config";
import { withStaticNavLinks, type ContentMap, type StaticNavLink } from "./map";
import { PageId } from "./notion";
import * as parse from "./parse";
import { exportTeamPage } from "./team";
import { clearPreviousOutputs, isExporterErr, saveFile } from "./utils";
import { saveZoteroDb } from "./zotero";

// For top-level nav links that point to statically-built pages integrated into content map.
const STATIC_NAV_LINKS: StaticNavLink[] = [{ label: "Team", href: "/team" }];

async function main(): Promise<void> {
    const parse_map_res = await parse.parseMaster(new PageId(CONFIG.master_id));
    if (isExporterErr(parse_map_res)) parse_map_res.logAndQuit();

    const clear_res = await clearPreviousOutputs();
    if (isExporterErr(clear_res)) clear_res.logAndQuit();

    const zotero_res = await saveZoteroDb();
    if (isExporterErr(zotero_res)) zotero_res.logAndQuit();

    const team_res = await exportTeamPage();
    if (isExporterErr(team_res)) team_res.logAndQuit();

    const content_map = withStaticNavLinks(parse_map_res as ContentMap, STATIC_NAV_LINKS);

    const content_map_json = JSON.stringify(content_map, null, 4);
    const content_map_res = await saveFile({ content: content_map_json, path: "content_map.json" });
    if (isExporterErr(content_map_res)) content_map_res.logAndQuit();

    await parse.exportAllPages({ content_map });
}

await main();
