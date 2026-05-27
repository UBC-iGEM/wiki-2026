import pkg from "../../package.json";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

// ERROR HANDLING

export type Result<T> = T | Error;

export function isErr<T>(result: Result<T>): result is Error {
    return result instanceof Error;
}

export function errorGenerator({ base }: { base: string }): (err: string) => Error {
    return (err: string) => new Error(`${base}: ${err}`);
}

// FUNCTION WRAPPERS

/**
 * Safely calls a function that may throw an Exception.
 *
 * @returns Error if the inner function throws an Exception.
 * @returns Ret if the inner function call completes.
 */
export function $unsafeSync<Args extends any[], Ret>(fn: (...args: Args) => Ret, ...args: Args): Result<Ret> {
    try {
        return fn(...args);
    } catch (err) {
        return err instanceof Error ? err : new Error(`${err}`);
    }
}

/**
 * Safely calls an asynchronous function that may throw an Exception.
 *
 * @returns Error if the inner function throws an Exception.
 * @returns Ret if the inner function call completes.
 */
export async function $unsafe<Args extends any[], Ret>(
    fn: (...args: Args) => Ret,
    ...args: Args
): Promise<Result<Awaited<Ret>>> {
    try {
        return await fn(...args);
    } catch (err) {
        return err instanceof Error ? err : new Error(`${err}`);
    }
}

/**
 * @param fn is called.
 * On error, it is called up to `RETRY_LIMIT` additional times.
 *
 * @returns Ret on first success.
 * @returns Error if no successes occured.
 */
export async function $withRetries<Args extends any[], Ret>(
    fn: (...args: Args) => Promise<Result<Ret>>,
    ...args: Args
): Promise<Result<Ret>> {
    const RETRY_LIMIT = 5;

    // Attempts up to `RETRIES` times
    for (let i = 0; i < RETRY_LIMIT; i++) {
        const res = await fn(...args);

        // Success 😃😁🥳
        if (!isErr(res)) {
            return res;
        }
    }

    // Call it one last time, and return the value regardless of what happens
    return await fn(...args);
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
    const makeError = errorGenerator({ base: `Unable to write to path ${dest}` });

    if (typeof Bun !== "undefined") {
        // The Bun runtime is available
        const res = await $unsafe(async () => {
            return Bun.write(dest, content);
        });
        if (isErr(res)) return makeError(res.message);
    } else {
        // Fallback to NodeJS
        const fs = await import("node:fs/promises");
        const fspath = await import("node:path");

        const dir_res = await $unsafe(fs.mkdir, fspath.dirname(dest), { recursive: true });
        if (isErr(dir_res)) return makeError(`failed to create parent directory with ${dir_res}`);

        const write_res = await $unsafe(fs.writeFile, dest, content);
        if (isErr(write_res)) return makeError(write_res.message);
    }
}

export async function clearPreviousOutputs(): Promise<Result<void>> {
    const makeError = errorGenerator({ base: "Unable to clean content directory" });

    for (const dir of [CONTENT_DIR_PATH, DEBUG_DIR_PATH]) {
        const exists = await $unsafe(existsSync, dir);
        if (isErr(exists)) return makeError(`failed to determine if directory ${dir} exists with ${exists}`);

        if (exists) {
            const res = await $unsafe(rm, dir, { recursive: true });
            if (isErr(res)) return makeError(`failed to remove directory with ${res}`);
        }
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
