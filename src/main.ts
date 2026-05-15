import dotenv from "dotenv";
import * as parse from "./parse";

dotenv.config({ path: "../.env" });

async function main(): Promise<void> {
  const databaseIds = Object.keys(process.env)
    .filter((key) => key.startsWith("DATABASE_ID"))
    .map((key) => process.env[key])
    .filter(Boolean) as string[];

  const aggregateIds = Object.keys(process.env)
    .filter((key) => key.startsWith("AGGREGATE_ID"))
    .map((key) => process.env[key])
    .filter(Boolean) as string[];

  const pageIds = Object.keys(process.env)
    .filter((key) => key.startsWith("PAGE_ID"))
    .map((key) => process.env[key])
    .filter(Boolean) as string[];

  await Promise.all([
    parse.parseDatabases({ databaseIds }),
    parse.parseAggregates({ aggregateIds }),
    parse.parsePages({
      pageIds,
      databaseId: "unparented",
      databaseTitle: "unparented",
    }),
  ]);
}

main();
