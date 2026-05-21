import { PageId } from "../notion";
import type { ProcessorInput, ProcessorOutput, ProcessorContext } from "./markdown";
import type { Link } from "mdast";
import { CONTINUE } from "unist-util-visit";

export const LinkProcessors = [normalizePageLink];

/**
 * Normalize URL in Markdown link block
 */
function normalizePageLink({ node, ctx }: ProcessorInput<Link>): ProcessorOutput {
    const err_base = `'link' element on page ${ctx.path} (${node})`;
    if (node.url.includes("notion.so")) return normalizeNotionUrl({ url: node.url, err_base, ctx });
}

/**
 * If a link points to a `www.notion.so` domain, replace it with a link to that page's location in the wiki
 */
export function normalizeNotionUrl({
    url,
    err_base,
    ctx,
}: {
    url: string;
    err_base: string;
    ctx: ProcessorContext;
}): ProcessorOutput {
    // Extract Notion page ID from URL
    const page_id = url.match(/(?<=notion.so\/)[a-f0-9]{32}/)?.[0];
    if (!page_id) return new Error(`${err_base} has no valid id`);

    const page_path = ctx.routes.get(new PageId(page_id));
    if (!page_path) return new Error(`${err_base} links to page ${page_id}, which is not a known wiki path`);

    const new_link: Link = {
        type: "link",
        url: page_path.toString(),
        children: [{ type: "text", value: page_path.components().at(-1)!.toString() }],
    };
    ctx.parent.children[ctx.index] = new_link;

    return CONTINUE;
}
