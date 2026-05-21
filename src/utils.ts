import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

// ERROR HANDLING

export type Result<T> = T | Error;

export function isErr<T>(result: Result<T>): result is Error {
    return result instanceof Error;
}

// FILE I/O HELPERS

const CONTENT_DIR = "content";
const RAW_CONTENT_DIR = "content_raw";

export async function saveFile({
    content,
    path,
    raw = false,
}: {
    content: string;
    path: string;
    raw?: boolean;
}): Promise<Result<void>> {
    const dest_base = raw ? RAW_CONTENT_DIR : CONTENT_DIR;
    const dest = `${dest_base}/${path}`;

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

export async function clearContentDirectory(): Promise<Result<void>> {
    try {
        if (existsSync(CONTENT_DIR)) {
            await rm(CONTENT_DIR, { recursive: true });
        }
        if (existsSync(RAW_CONTENT_DIR)) {
            await rm(RAW_CONTENT_DIR, { recursive: true });
        }
    } catch (err) {
        return new Error(`Failed to clean content directory`);
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
