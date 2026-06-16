import { CONFIG } from "./config";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// ERROR HANDLING

export class ExporterError {
    bold_red = "\x1b[1;31m";
    bold_yellow = "\x1b[1;33m";
    reset = "\x1b[0m";

    private creation_site: string;
    constructor(
        private message: string,
        private tags: (
            | "malformed content"
            | "notion server"
            | "igem tools server"
            | "wiki server"
            | "zotero server"
            | "bug?"
            | "exporter configuration"
        )[],
        private source_error?: Error,
    ) {
        this.creation_site = source_error?.stack || new Error().stack!;
    }

    display(type: "recoverable" | "unrecoverable"): string {
        return `
=== ERROR REPORT ===
${this.bold_red}${this.message}${this.reset}
Type: ${type}. ${type === "recoverable" ? "The exporter can continue." : "The exporter must abort."}
Tags: ${this.tags.join(", ")}
${this.source_error ? `Original error:\n ${this.source_error}\n` : ""}Trace:\n ${this.creation_site}
====================
`;
    }

    public logAndQuit(): never {
        console.error(this.display("unrecoverable"));
        process.exit(1);
    }

    public warn(): void {
        console.error(this.display("recoverable"));
    }
}

export type Result<T> = T | Error;

export function isErr<T>(result: Result<T>): result is Error {
    return result instanceof Error;
}

export type ExporterResult<T> = T | ExporterError;

export function isExporterErr<T>(result: ExporterResult<T>): result is ExporterError {
    return result instanceof ExporterError;
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
 * Safely calls an asynchronous function that may throw an Exception. The Exception must have type {@link ExporterError}.
 *
 * @returns Error if the inner function throws an Exception.
 * @returns Ret if the inner function call completes.
 */
export async function $unsafeExporterPromises<Args extends any[], Ret>(
    fn: (...args: Args) => Ret,
    ...args: Args
): Promise<ExporterResult<Awaited<Ret>>> {
    try {
        return await fn(...args);
    } catch (err) {
        return err as ExporterResult<any>;
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

const DEBUG_DIR_PATH = "exporter/debug";

export async function saveFile({
    content,
    path,
    debug_path,
}: {
    content: string;
    path: string;
    debug_path?: string;
}): Promise<ExporterResult<void>> {
    /**
     * If `debug_path` is set, save to the local `debug` directory
     * If unset, save to {@link CONTENT_DIR_PATH}
     */
    const dest = debug_path ? `${DEBUG_DIR_PATH}/${debug_path}/${path}` : `${CONFIG.content_dir_path}/${path}`;

    const dir_res = await $unsafe(mkdir, dirname(dest), { recursive: true });
    if (isErr(dir_res))
        return new ExporterError(`Failed to create parent directories of file ${dest}.`, ["wiki server"], dir_res);

    const write_res = await $unsafe(writeFile, dest, content);
    if (isErr(write_res))
        return new ExporterError(`Failed to write page to file at ${dest}.`, ["wiki server"], write_res);
}

export async function clearPreviousOutputs(): Promise<ExporterResult<void>> {
    for (const dir of [CONFIG.content_dir_path, DEBUG_DIR_PATH]) {
        const exists = $unsafeSync(existsSync, dir);
        if (isErr(exists))
            return new ExporterError(
                `While trying to clear results of previous export run, failed to determine if directory ${dir} exists.`,
                ["wiki server"],
                exists,
            );

        if (exists) {
            const res = await $unsafe(rm, dir, { recursive: true });
            if (isErr(res))
                return new ExporterError(
                    `While trying to clear results of previous export run, failed to remove directory ${dir}.`,
                    ["wiki server"],
                    res,
                );
        }
    }
}
