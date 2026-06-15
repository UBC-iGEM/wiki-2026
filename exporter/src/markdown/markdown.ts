import { PagePath, type ContentMap } from "../map";
import type { PageId } from "../notion";
import { ExporterError, isExporterErr, saveFile } from "../utils";
import { COMPONENT_MAP } from "./components";
import { INLINE_COMPONENT_MAP } from "./components-inline";
import { HTML_PROCESSORS } from "./html";
import { IMAGE_PROCESSORS } from "./image";
import { LINK_PROCESSORS } from "./link";
import { processRegex } from "./regex";
import type { Parent, Root, Node } from "mdast";
import HTMLParse from "node-html-parser";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit, type Action, type ActionTuple, type VisitorResult } from "unist-util-visit";

export interface PageAttrs {
    type: "page";
    title: string;
}

export interface DatabaseAttrs {
    type: "database";
    title: string;
    // datetime: string;
    path: string;
}

export type MarkdownHeader = PageAttrs | DatabaseAttrs;

export async function processMarkdown({
    md,
    path,
    routes,
}: {
    id: PageId;
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
                resourceLink: true,
            })
            .process(preprocessed_markdown)
    ).toString();

    const type = path.components().length === 3 ? "database" : "page";
    const title = path.name().toString();

    const header_items: MarkdownHeader = type === "page" ? { type, title } : { type, title, path: path.toString() };

    const page_header = Object.entries(header_items)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n");
    const page = `
---
${page_header}
---

${processed_markdown}
`.trim();
    const save_path = path.withExt("mdx");

    const raw_result = await saveFile({ content: md, path: save_path, debug_path: "raw" });
    if (isExporterErr(raw_result)) raw_result.warn();

    const regex_result = await saveFile({ content: preprocessed_markdown, path: save_path, debug_path: "regex" });
    if (isExporterErr(regex_result)) regex_result.warn();

    const result = await saveFile({ content: page, path: save_path });
    if (isExporterErr(result)) result.warn();
}

type ProcessorCallback = () => Promise<void | ExporterError>;

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
                    return processAllAndWarnErrors(HTML_PROCESSORS, {
                        node: undefined,
                        parsed_node: HTMLParse.parse(node.value),
                        ctx,
                    });
                case "link":
                    return processAllAndWarnErrors(LINK_PROCESSORS, { node, ctx });
                case "image":
                    return processAllAndWarnErrors(IMAGE_PROCESSORS, { node, ctx });
                case "textDirective": {
                    const inline_component_type = node.name.toLowerCase();
                    const transform = INLINE_COMPONENT_MAP[inline_component_type];
                    if (!transform) {
                        new ExporterError(
                            `Inline component type ${inline_component_type} on page "${path}" could not be understood. It is either misspelt or not yet implemented.`,
                            ["malformed content"],
                        ).warn();
                        return;
                    }

                    const res = transform({ node, ctx });
                    if (isExporterErr(res)) {
                        res.warn();
                        return;
                    }

                    return res;
                }
            }
        });

        const results = await Promise.all(callbacks.map(async (callback) => await callback()));
        for (const result of results) {
            if (result) result.warn();
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
                new ExporterError(
                    `Component type ${component_type} on page "${path}" could not be understood. It is either misspelt or not yet implemented.`,
                    ["malformed content"],
                ).warn();
                return;
            }

            const res = transform({ node, ctx });
            if (isExporterErr(res)) {
                res.warn();
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
 * @returns `ExporterError`: processing failed
 */
export type ProcessorOutput = undefined | Action | ActionTuple | ExporterError;

export interface ProcessorInput<T> {
    node: T;
    ctx: ProcessorContext;
}

type Processor<T> = (input: T) => ProcessorOutput;
export function processAll<T>(processors: Processor<T>[], input: T): ProcessorOutput {
    for (const processor of processors) {
        const res = processor(input);

        if (isExporterErr(res)) {
            // Stop all processing on this node
            return res;
        }

        if (res !== undefined) {
            return res;
        }
    }
}

export function processAllAndWarnErrors<T>(processors: Processor<T>[], input: T): VisitorResult {
    const res = processAll(processors, input);

    if (isExporterErr(res)) {
        res.warn();
        return undefined;
    }

    return res;
}

export function constructNodeErrorSource(children: Node[]): Error {
    return new Error(`Malformed block has children: ${JSON.stringify(children.map((child) => child.type))}`);
}
