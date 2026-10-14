import { getToolsClient } from "./tools-api";
import { BOLD, BOLD_RED, isExporterErr, RESET, YELLOW } from "./utils";

/**
 * Deletes every file in the assets folder on `tools.igem.org`.
 */
async function main(): Promise<void> {
    const confirmed = process.argv.includes("--confirm");

    const client = await getToolsClient();
    if (isExporterErr(client)) return client.logAndQuit();

    const names = await client.listAssets();
    if (isExporterErr(names)) return names.logAndQuit();

    if (names.length === 0) return console.log("The assets folder is already empty.");

    if (!confirmed) {
        for (const name of names) console.log(name);
        return console.log(
            `\n${BOLD}${names.length} files${RESET} would be deleted. Run ${BOLD}npm run clear-assets -- --confirm${RESET} to delete them.`,
        );
    }

    let failed = 0;
    for (const [i, name] of names.entries()) {
        const res = await client.deleteAsset(name);
        if (!isExporterErr(res)) {
            console.log(`Deleted ${name} (${i + 1}/${names.length})`);
            continue;
        }

        failed++;
        console.error(`${YELLOW}${res.summary()}${RESET}`);
        // Stop early rather than repeat the same failure for every file
        if (i === 0) {
            console.error(`${BOLD_RED}The first deletion failed, so no others were attempted.${RESET}`);
            process.exit(1);
        }
    }

    console.log(`\n${BOLD}Deleted ${names.length - failed} of ${names.length} files.${RESET}`);
    if (failed > 0) process.exit(1);
}

await main();
