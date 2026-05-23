import pkg from "../../package.json";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

// ERROR HANDLING

export type Result<T> = T | Error;

export function isErr<T>(result: Result<T>): result is Error {
    return result instanceof Error;
}

// FILE I/O HELPERS

const CONTENT_DIR_PATH = pkg.notion_export_config.content_dir_path;
const DEBUG_DIR_PATH = pkg.notion_export_config.debug_dir_path;

export async function saveFile({
    content,
    path,
    debug_path,
}: {
    content: string;
    path: string;
    debug_path?: string;
}): Promise<Result<void>> {
    /**
     * If `debug_path` is set, save to the local `debug` directory
     * If unset, save to {@link CONTENT_DIR_PATH}
     */
    const dest = debug_path ? `${DEBUG_DIR_PATH}/${debug_path}/${path}` : `${CONTENT_DIR_PATH}/${path}`;

    try {
        if (typeof Bun !== "undefined") {
            // The Bun runtime is available
            await Bun.write(dest, content);
        } else {
            // Fallback to NodeJS
            const fs = await import("node:fs/promises");
            const fspath = await import("node:path");

            await fs.mkdir(fspath.dirname(dest), { recursive: true });
            await fs.writeFile(dest, content);
        }
    } catch (err) {
        return new Error(`Failed to write to path ${dest}: ${err}`);
    }
}

export async function clearPreviousOutputs(): Promise<Result<void>> {
    try {
        for (const dir of [CONTENT_DIR_PATH, DEBUG_DIR_PATH]) {
            if (existsSync(dir)) {
                await rm(dir, { recursive: true });
            }
        }
    } catch (err) {
        return new Error(`Failed to clean content directory: ${err}`);
    }
}

// HTML stringification

const web_regex_replacements: [string | RegExp, string][] = [
    [" ", "-"],
    ['"', "&quot;"],
];

export function cleanWebString(s: string): string {
    let output = s;
    for (const [search, replacement] of web_regex_replacements) {
        output = output.replaceAll(search, replacement);
    }
    return output;
}
