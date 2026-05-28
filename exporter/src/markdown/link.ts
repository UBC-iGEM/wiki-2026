import { PageId } from "../notion";
import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Link } from "mdast";
import { CONTINUE } from "unist-util-visit";

export const LINK_PROCESSORS = [normalizePageLink];

/**
 * If a link points to a `www.notion.so` domain, replace it with a link to that page's location in the wiki
 */
function normalizePageLink({ node, ctx }: ProcessorInput<Link>): ProcessorOutput {
    const url = node.url;
    if (!node.url.includes("notion.so")) return;

    const err_base = `'link' element on page ${ctx.path} (${node})`;

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
