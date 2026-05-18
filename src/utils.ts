import { existsSync } from "node:fs";
import type { PagePath } from "./parse";
import { rm } from "node:fs/promises";

export type Result<T> = T | Error;

export function isErr<T>(result: Result<T>): result is Error {
    return result instanceof Error;
}

const CONTENT_DIR = "content";

export async function save({ content, path }: { content: string; path: PagePath }): Promise<Result<void>> {
    const dest = `${CONTENT_DIR}/${path.path}`;
    try {
        await Bun.write(dest, content);
    } catch (err) {
        return new Error(`Failed to write to path ${dest}: ${err}`);
    }
}

export async function clear(): Promise<Result<void>> {
    try {
        if (existsSync(CONTENT_DIR)) {
            await rm(CONTENT_DIR, { recursive: true });
        }
    } catch (err) {
        return new Error(`Failed to clean content directory at ${CONTENT_DIR}`);
    }
}
