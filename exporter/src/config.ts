import pkg from "../../package.json";
import { z } from "zod";

const CONFIG_SCHEMA = z.object({
    master_id: z.string(),
    content_dir_path: z.string(),
    debug_dir_path: z.string(),
    team_id: z.string(),
    zotero_group_id: z.number().int().positive(),
});

export type Config = z.infer<typeof CONFIG_SCHEMA>;

export const CONFIG: Config = CONFIG_SCHEMA.parse(pkg.notion_export_config);
