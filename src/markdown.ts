import * as log from "./log";
import { isErr, save } from "./utils";
import { PagePath, type RouteMap } from "./parse";
import { SKIP, visit, type Action, type ActionTuple } from "unist-util-visit";
import type { Html, Image, Link, List, ListItem, Node, Paragraph, Parent, Root } from "mdast";
import { v5 as uuidv5 } from "uuid";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkDirective from "remark-directive";
import parse, { HTMLElement } from "node-html-parser";
import remarkMath from "remark-math";
import { BlockId, Id } from "./notion";

export async function processMarkdown({ md, path, routes }: { md: string; path: PagePath; routes: RouteMap }) {
    let preprocessed_markdown = md;
    for (const [search, replace] of preprocessor_regexes) {
        // Add flags `Global`, `case Insensitive`, `Multiline`
        const search_regex = new RegExp(search, "gim");
        preprocessed_markdown = preprocessed_markdown.replaceAll(search_regex, replace);
    }

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

// ====================
// REGEX PREPROCESSING
// ====================

const preprocessor_regexes: [RegExp, string][] = [
    /*
Convert component syntax into Markdown directive with newline terminator
FROM:
  %% START COMPONENT
      ...
  %% END
TO:
  ::: COMPONENT
      ...
  :::
*/
    [/^%%[ ]?START ([a-zA-Z]+)[ ]*$/, ":::$1"],
    [/^%%[ ]?END[ ]*$/, ":::\n"],

    // Convert <empty-block/> elements to simple blank line (\n)
    [/^<empty-block\/>$/, "\n"],

    /*
Add newline after various elements to ensure parser recognizes them as distinct nodes
Supported elements:
  - Any closing HTML tag (e.g., </details>) on its own line
  - A closing code block fence (i.e., ```) on its own line
  - An opening or closing LaTeX fence (i.e., $$) on its own line
*/
    [/^((<\/[a-zA-Z_-]+>)$|(```)$|(\$\$)$)/, "$1\n"],
];

// ====================
// AST PREPROCESSING
// ====================

// Primary driver
function processMAst({ routes, path }: { routes: RouteMap; path: PagePath }) {
    return async function (tree: Root): Promise<void> {
        interface BacklogItem {
            node: Node;
            index: number;
            parent: Parent;
        }
        const backlog: BacklogItem[] = [];

        visit(tree, (node, index, parent) => {
            if (index === undefined || !parent) return;
            if (["html", "link", "list", "image"].includes(node.type)) backlog.push({ node, index, parent });

            // Avoids mixing sublists into the backlog
            if (node.type === "list") return SKIP;
        });

        // Process backward so splicing changes don't mess up indices later
        for (let i = backlog.length - 1; i >= 0; i--) {
            const { node, index, parent } = backlog[i]!;
            const ctx: ProcessorContext = {
                index,
                parent,
                routes,
                path,
            };

            switch (node.type) {
                case "html": {
                    const html_node = node as Html;
                    const parsed_node = parse(html_node.value);
                    await process_all([normalizeMention], { node: html_node, parsed_node, ctx });
                    break;
                }
                case "link": {
                    await process_all([normalizeLink], { node: node as Link, ctx });
                    break;
                }
                case "list": {
                    await process_all([splitList], { node: node as List, ctx });
                    break;
                }
                case "image": {
                    await process_all([updateImageUrl], { node: node as Image, ctx });
                    break;
                }
            }
        }
    };
}

/**
 * Processor functions can either return:
 * @returns `false`: no processing to be done
 * @returns `true`: processing succeeded and should finish with this action
 * @returns `Error`: processing failed
 */
type ProcessorOutput = Promise<boolean | Error>;

interface ProcessorContext {
    index: number;
    parent: Parent;
    routes: RouteMap;
    path: PagePath;
}

interface ProcessorInput<T> {
    node: T;
    ctx: ProcessorContext;
}

type Processor<T> = (input: T) => ProcessorOutput;
async function process_all<T>(processors: Processor<T>[], input: T): Promise<void> {
    for (const processor of processors) {
        const res = await processor(input);
        switch (true) {
            case res instanceof Error:
                log.warn_error(res);
                // Stop all processing
                return;
            case res === false:
                // Continue processing, no action taken
                break;
            case res === true:
                // Successful processing
                return;
        }
    }
}

async function normalizeMention({
    node,
    ctx,
    parsed_node,
}: ProcessorInput<Html> & { parsed_node: HTMLElement }): ProcessorOutput {
    const mention_element = parsed_node.querySelector("mention-page");
    if (!mention_element) {
        return false;
    }

    const err_base = `'mention-page' element on page ${ctx.path.path} (${node})`;

    const url = mention_element.attributes["url"];
    if (!url) {
        return new Error(`${err_base} has no valid attribute 'url'`);
    }

    return normalizeUrl({ url, err_base, ctx });
}

async function normalizeLink({ node, ctx }: ProcessorInput<Link>): ProcessorOutput {
    const err_base = `'link' element on page ${ctx.path.path} (${node})`;
    return normalizeUrl({ url: node.url, err_base, ctx });
}

/**
 * If a link points to a `www.notion.so` domain, replace it with a link to that page's location in the wiki
 */
async function normalizeUrl({
    url,
    err_base,
    ctx,
}: {
    url: string;
    err_base: string;
    ctx: ProcessorContext;
}): ProcessorOutput {
    if (!url.includes("www.notion.so")) {
        // External link
        return true;
    }

    const page_id = url.match(/(?<=\/|-)[a-f0-9]{32}(?:\?|$)/)?.[0];
    if (!page_id) return new Error(`${err_base} has no valid id`);

    const page_path = ctx.routes[page_id];
    if (!page_path) return new Error(`${err_base} links to page ${page_id}, which is not a known wiki path`);

    const new_link: Link = {
        type: "link",
        url: page_path.path,
        children: [{ type: "text", value: page_path.components().at(-1)! }],
    };
    ctx.parent.children[ctx.index] = {
        type: "paragraph",
        children: [new_link],
    };

    return true;
}

/**
 * Walk a Markdown list. If text has been accidentally joined to its end,
 * splice it out and return it as a new Paragraph.
 */
async function splitList({ node, ctx }: ProcessorInput<List>): ProcessorOutput {
    const last_list_item = node.children.at(-1);
    if (!last_list_item) return false;

    return await splitListItem({ node: last_list_item, ctx });
}

async function splitListItem({ node: item, ctx }: ProcessorInput<ListItem>): ProcessorOutput {
    const last_child = item.children.at(-1);
    if (!last_child) return false;

    switch (last_child.type) {
        case "paragraph":
            break;
        case "list":
            // Time to go deeper
            return await splitList({ node: last_child, ctx });
        default:
            return false;
    }

    const last_text_element = last_child.children.at(-1);
    if (!last_text_element || last_text_element.type !== "text") return false;
    const text = last_text_element.value;

    const split_index = text.indexOf("\n");
    if (split_index === -1) return false;

    const before = text.slice(0, split_index).trimEnd();
    const after = text.slice(split_index + 1).trimStart();

    last_text_element.value = before;
    const new_paragraph: Paragraph = {
        type: "paragraph",
        children: [
            {
                type: "text",
                value: after,
            },
        ],
    };
    ctx.parent.children.splice(ctx.index + 1, 0, new_paragraph);
    return true;
}

async function updateImageUrl({ node }: ProcessorInput<Image>): ProcessorOutput {
    const image_node_url = node.url;

    let image_data_url: string | undefined;
    let image_id: Id | undefined;

    if (image_node_url.includes("file://")) {
        // Notion file upload
        const decoded_url = decodeURIComponent(image_node_url.replace("file://", ""));

        try {
            interface UrlData {
                permissionRecord: {
                    id: string;
                };
            }

            const url_data: UrlData = JSON.parse(decoded_url);
            image_id = new Id(url_data.permissionRecord.id);

            const block_id = new BlockId(image_id.id);
            const block_data = await block_id.get();
            if (isErr(block_data)) return block_data;

            if (block_data.type !== "image" || block_data.image.type !== "file")
                return new Error(`Image block ${block_id.id} does not point to expected image data`);
            image_data_url = block_data.image.file.url;
        } catch (err) {
            return new Error(`Failed to parse image URL ${decoded_url}: ${err}`);
        }
    } else {
        // Linked URL
        image_data_url = image_node_url;
        image_id = new Id(uuidv5(image_node_url, uuidv5.DNS));
    }

    node.url = `TOOLS_API_BASE/${image_id.id}`;
    return true;
}
