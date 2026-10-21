import { CONFIG } from "./config";
import type { ContentMap, PagePath } from "./map";
import type { Id, PageId } from "./notion";
import archy from "archy";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// ERROR HANDLING

type ErrorTag =
    | "malformed content"
    | "notion server"
    | "igem tools server"
    | "wiki server"
    | "zotero server"
    | "igem video server"
    | "bug?"
    | "exporter configuration";

/**
 * Information on where a warning occurred.
 */
export interface WarningContext {
    path: PagePath;
    page: PageId;
    block?: Id;
}

export const BOLD = "\x1b[1m";
export const BOLD_RED = "\x1b[1;31m";
export const YELLOW = "\x1b[33m";
export const GREEN = "\x1b[32m";
export const RESET = "\x1b[0m";

export class ExporterError {
    constructor(
        private message: string,
        private tags: ErrorTag[],
        private source_error?: Error,
    ) {}

    /**
     * Aborts the export, then prints all warnings collected so far.
     */
    public logAndQuit(): never {
        const trace = this.source_error ? `\nOriginal error:\n${this.source_error}` : "";
        console.error(`
=== FATAL ERROR ===
${BOLD_RED}${this.message}${RESET}
The exporter must abort.
Tags: ${this.tags.join(", ")}${trace}
===================
`);
        printWarnings();
        process.exit(1);
    }

    /**
     * Records a recoverable error. All warnings are printed as a page tree when the export ends.
     */
    public warn(ctx?: WarningContext): void {
        WARNINGS.push({ error: this, ctx });
    }

    /**
     * One entry in the warning tree.
     */
    public summary(ctx?: WarningContext): string {
        const block_link =
            ctx?.block !== undefined
                ? ` → ${ExporterError.link({ with_label: "open block", to: notionUrl(ctx.page, ctx.block) })}`
                : "";
        const trace = this.source_error ? `\n  ${String(this.source_error).replaceAll("\n", "\n  ")}` : "";
        return `${YELLOW}[${this.tags.join(", ")}]${RESET} ${this.message}${block_link}${trace}`;
    }

    public static link({ with_label: label, to: url }: { with_label: string; to: string }): string {
        return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
    }
}

function notionUrl(page: PageId, block?: Id): string {
    const url = `https://app.notion.com/p/${page}`;
    return block ? `${url}#${block}` : url;
}

// WARNING REGISTRY

const WARNINGS: { error: ExporterError; ctx?: WarningContext }[] = [];
let WARNING_ROUTES: ContentMap | undefined;

/**
 * Sets the content map, used to order the warning tree and count pages.
 */
export function setWarningRoutes(routes: ContentMap): void {
    WARNING_ROUTES = routes;
}

// EXPORT STATS
const EXPORT_START_TIME = performance.now();
let NOTION_RATE_LIMITED_COUNT = 0;

export function recordNotionRateLimit(): void {
    NOTION_RATE_LIMITED_COUNT++;
}

/**
 * Prints all collected warnings as a tree of the pages they occurred on.
 */
export function printWarnings(): void {
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
    const export_time = `${BOLD}${GREEN}DEBUG${RESET}: Export took ${(performance.now() - EXPORT_START_TIME) / 1000}s.`;
    const notion_ratelim = `${BOLD}${GREEN}DEBUG${RESET}: ${plural(NOTION_RATE_LIMITED_COUNT, "request")} ${NOTION_RATE_LIMITED_COUNT === 1 ? "was" : "were"} rate-limited.`;

    if (WARNINGS.length === 0) {
        console.error(`\n${export_time}\n${notion_ratelim}`);
        return;
    }

    interface Node {
        label: string;
        children: Map<string, Node>;
        warnings: string[];
    }
    const newNode = (label: string): Node => ({ label, children: new Map(), warnings: [] });
    const root = newNode("");

    const general_errors = WARNINGS.filter(({ ctx }) => !ctx);
    if (general_errors.length > 0)
        root.children.set("", {
            ...newNode(`${BOLD}General errors${RESET}`),
            warnings: general_errors.map(({ error }) => error.summary()),
        });

    // Pages appear in content map order
    const route_order = WARNING_ROUTES ? [...WARNING_ROUTES.pages()].map(({ path }) => path.toString()) : [];
    const page_warnings = WARNINGS.filter(({ ctx }) => ctx).sort(
        (a, b) => orderOf(route_order, a.ctx!.path.toString()) - orderOf(route_order, b.ctx!.path.toString()),
    );

    for (const { error, ctx } of page_warnings) {
        const components = ctx!.path.components().map((component) => component.toString());
        let node = root;
        components.forEach((name, i) => {
            const is_page = i === components.length - 1;
            let child = node.children.get(name);
            if (!child) {
                child = newNode(
                    is_page
                        ? `${BOLD}${ExporterError.link({ with_label: name, to: notionUrl(ctx!.page) })}${RESET}`
                        : name,
                );
                node.children.set(name, child);
            }
            node = child;
        });
        node.warnings.push(error.summary(ctx));
    }

    const toArchy = (node: Node): archy.Data => ({
        label: node.label,
        nodes: [...node.warnings, ...[...node.children.values()].map(toArchy)],
    });

    const page_count = new Set(page_warnings.map(({ ctx }) => ctx!.path.toString())).size;
    const total = WARNING_ROUTES ? ` of ${route_order.length}` : "";
    const heading = `${BOLD}${plural(WARNINGS.length, "warning")} on ${page_count}${total} ${page_count === 1 && !total ? "page" : "pages"}.${RESET}`;

    console.error(
        `\n${export_time}\n${notion_ratelim}\n\n${heading}\n${[...root.children.values()].map((node) => archy(toArchy(node))).join("")}`,
    );
}

function orderOf(order: string[], key: string): number {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
}

// ERROR HANDLING

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
    base_path,
}: {
    content: string;
    path: string;
    debug_path?: string;
    base_path?: string;
}): Promise<ExporterResult<void>> {
    /**
     * If `debug_path` is set, save to the local `debug` directory.
     * Else if `base_path` is set, save relative to it.
     * If neither is set, save to {@link CONTENT_DIR_PATH}
     */
    const dest = debug_path
        ? `${DEBUG_DIR_PATH}/${debug_path}/${path}`
        : `${base_path ?? CONFIG.content_dir_path}/${path}`;

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
