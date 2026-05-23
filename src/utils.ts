import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { rm } from "node:fs/promises";

// ERROR HANDLING

export type Result<T> = T | Error;

export function isErr<T>(result: Result<T>): result is Error {
    return result instanceof Error;
}

// FILE I/O HELPERS

const CONTENT_DIR_BASE = "content";

export async function saveFile({
    content,
    path,
    stage,
}: {
    content: string;
    path: string;
    stage?: string;
}): Promise<Result<void>> {
    const dest = stage ? `${CONTENT_DIR_BASE}_${stage}/${path}` : `${CONTENT_DIR_BASE}/${path}`;

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
    const current_dir = process.cwd();
    const content_dirs = (await readdir(current_dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("content"))
        .map((entry) => entry.name);

    try {
        for (const dir of content_dirs) {
            await rm(dir, { recursive: true });
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
