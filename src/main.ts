import dotenv from "dotenv";
import * as parse from "./parse";
import type { PageId } from "./notion";

dotenv.config({ path: "../.env" });

async function main(): Promise<void> {
    const aggregate_ids = Object.keys(process.env)
        .filter((key) => key.startsWith("AGGREGATE"))
        .map((key) => process.env[key])
        .filter(Boolean) as string[];

    // const databaseIds = Object.keys(process.env)
    //     .filter((key) => key.startsWith("DATABASE_ID"))
    //     .map((key) => process.env[key])
    //     .filter(Boolean) as string[];

    // const pageIds = Object.keys(process.env)
    //     .filter((key) => key.startsWith("PAGE_ID"))
    //     .map((key) => process.env[key])
    //     .filter(Boolean) as string[];

    const parse_map = await parse.parseAggregates({ ids: aggregate_ids as PageId[] });
    console.log(parse_map);
}

main();
