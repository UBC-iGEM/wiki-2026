import * as log from "../log";
import { PagePath, type ContentMap } from "../parse";
import { isErr, save } from "../utils";
import { ComponentMap } from "./components";
import { HtmlProcessors } from "./html";
import { ImageProcessors } from "./image";
import { LinkProcessors } from "./link";
import { processRegex } from "./regex";
import type { Parent, Root } from "mdast";
import parse from "node-html-parser";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit, type Action, type ActionTuple, type VisitorResult } from "unist-util-visit";

export async function processMarkdown({ md, path, routes }: { md: string; path: PagePath; routes: ContentMap }) {
    let preprocessed_markdown = processRegex(md);

    const processed_markdown = await unified()
        .use(remarkParse)
        .use(remarkDirective)
        .use(remarkMath)
        .use(processMAst, {
            routes,
            path,
        })
        .use(remarkStringify, {
            bullet: "-",
        })
        .process(preprocessed_markdown);
    const result = await save({ content: String(processed_markdown), path: path.withExt("mdx") });

    if (isErr(result)) log.warn_error(result);
}

type ProcessorCallback = () => Promise<void | Error>;

export interface ProcessorContext {
    index: number;
    parent: Parent;
    routes: ContentMap;
    path: PagePath;
    callbacks: ProcessorCallback[];
}

function processMAst({ routes, path }: { routes: ContentMap; path: PagePath }) {
    return async function (tree: Root): Promise<void> {
        let callbacks: ProcessorCallback[] = [];

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
                    return process_all(HtmlProcessors, {
                        node,
                        parsed_node: parse(node.value),
                        ctx,
                    });
                case "link":
                    return process_all(LinkProcessors, { node, ctx });
                case "image":
                    return process_all(ImageProcessors, { node, ctx });
            }
        });

        const results = await Promise.all(callbacks.map(async (callback) => await callback()));
        for (const result of results) {
            if (result) log.warn_error(result);
        }
        callbacks = [];

        visit(tree, "containerDirective", (node, index, parent) => {
            if (index === undefined || !parent) return;
            const ctx: ProcessorContext = {
                index,
                parent,
                routes,
                path,
                callbacks,
            };

            const component_type = node.name.toLowerCase();
            const component_transform = ComponentMap[component_type];
            if (!component_transform) {
                log.warn_error(`Component type ${component_type} at ${path} not understood`);
                return;
            }

            const res = component_transform({ node, ctx });
            if (isErr(res)) {
                log.warn_error(res);
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
function process_all<T>(processors: Processor<T>[], input: T): VisitorResult {
    for (const processor of processors) {
        const res = processor(input);

        if (isErr(res)) {
            log.warn_error(res);
            // Stop all processing on this node
            return;
        }

        if (res !== undefined) {
            return res;
        }
    }
}
