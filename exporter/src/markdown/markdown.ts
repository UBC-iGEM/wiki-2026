import * as log from "../log";
import { PagePath, type ContentMap } from "../map";
import { isErr, saveFile } from "../utils";
import { COMPONENT_MAP } from "./components";
import { INLINE_COMPONENT_MAP } from "./components-inline";
import { HTML_PROCESSORS } from "./html";
import { IMAGE_PROCESSORS } from "./image";
import { LINK_PROCESSORS } from "./link";
import { processRegex } from "./regex";
import type { Parent, Root } from "mdast";
import HTMLParse from "node-html-parser";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit, type Action, type ActionTuple, type VisitorResult } from "unist-util-visit";

export async function processMarkdown({
    md,
    path,
    routes,
}: {
    md: string;
    path: PagePath;
    routes: ContentMap;
}): Promise<void> {
    const preprocessed_markdown = processRegex(md);

    const processed_markdown = (
        await remarkProcessingPipeline()
            .use(processMAst, {
                routes,
                path,
            })
            .use(remarkStringify, {
                bullet: "-",
            })
            .process(preprocessed_markdown)
    ).toString();

    const type = path.components().length === 3 ? "database" : "page";
    const name = path.components().at(-1)!.toString();
    const header_items: Record<string, string> = { type, name };
    const page_header = Object.entries(header_items)
        .map(([k, v]) => `${k} = ${v}`)
        .join("\n");

    const page = `
---
${page_header}
---

${processed_markdown}
`.trim();
    const save_path = path.withExt("mdx");

    const raw_result = await saveFile({ content: md, path: save_path, debug_path: "raw" });
    if (isErr(raw_result)) log.warnError(raw_result);

    const regex_result = await saveFile({ content: preprocessed_markdown, path: save_path, debug_path: "regex" });
    if (isErr(regex_result)) log.warnError(regex_result);

    const result = await saveFile({ content: page, path: save_path });
    if (isErr(result)) log.warnError(result);
}

type ProcessorCallback = () => Promise<void | Error>;

export interface ProcessorContext {
    index: number;
    parent: Parent;
    routes: ContentMap;
    path: PagePath;
    callbacks: ProcessorCallback[];
}

export const remarkProcessingPipeline = unified().use(remarkParse).use(remarkDirective).use(remarkMath).use(remarkGfm);

/**
 * A remark plugin that walks the Markdown AST and dispatches various processors on different node types
 */
function processMAst({ routes, path }: { routes: ContentMap; path: PagePath }) {
    return async function (tree: Root): Promise<void> {
        const callbacks: ProcessorCallback[] = [];

        // Initial pass: handle all content cleanup and modifications
        visit(tree, (node, index, parent) => {
            if (index === undefined || !parent) return;
            const ctx: ProcessorContext = {
                index,
                parent,
                routes,
                path,
                callbacks,
            };

            switch (node.type) {
                case "html":
                    return processAll(HTML_PROCESSORS, {
                        node: undefined,
                        parsed_node: HTMLParse.parse(node.value),
                        ctx,
                    });
                case "link":
                    return processAll(LINK_PROCESSORS, { node, ctx });
                case "image":
                    return processAll(IMAGE_PROCESSORS, { node, ctx });
                case "textDirective": {
                    const inline_component_type = node.name.toLowerCase();
                    const transform = INLINE_COMPONENT_MAP[inline_component_type];
                    if (!transform) {
                        log.warnError(`Inline component type ${inline_component_type} at ${path} not understood`);
                        return;
                    }

                    const res = transform({ node, ctx });
                    if (isErr(res)) {
                        log.warnError(res);
                        return;
                    }

                    return res;
                }
            }
        });

        const results = await Promise.all(callbacks.map(async (callback) => await callback()));
        for (const result of results) {
            if (result) log.warnError(result);
        }

        visit(tree, "containerDirective", (node, index, parent) => {
            if (index === undefined || !parent) return;

            const ctx: ProcessorContext = {
                index,
                parent,
                routes,
                path,
                callbacks: [],
            };

            const component_type = node.name.toLowerCase();
            const transform = COMPONENT_MAP[component_type];
            if (!transform) {
                log.warnError(`Component type ${component_type} at ${path} not understood`);
                return;
            }

            const res = transform({ node, ctx });
            if (isErr(res)) {
                log.warnError(res);
                return;
            }

            return res;
        });
    };
}

/**
 * Processor functions can either return:
 * @returns  `undefined`: no processing to be done
 * @returns `Action`: processing succeeded and should finish with this action
 * @returns `Error`: processing failed
 */
export type ProcessorOutput = undefined | Action | ActionTuple | Error;

export interface ProcessorInput<T> {
    node: T;
    ctx: ProcessorContext;
}

type Processor<T> = (input: T) => ProcessorOutput;
export function processAll<T>(processors: Processor<T>[], input: T): VisitorResult {
    for (const processor of processors) {
        const res = processor(input);

        if (isErr(res)) {
            log.warnError(res);
            // Stop all processing on this node
            return;
        }

        if (res !== undefined) {
            return res;
        }
    }
}
