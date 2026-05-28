import pkg from "../../package.json";
import { z } from "zod";

const ConfigSchema = z.object({
    master_id: z.string(),
    content_dir_path: z.string(),
    debug_dir_path: z.string(),
    team_id: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const CONFIG: Config = ConfigSchema.parse(pkg.notion_export_config);
