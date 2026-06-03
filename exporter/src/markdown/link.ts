import { PageId } from "../notion";
import { slugifyPath } from "../utils";
import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Link } from "mdast";
import { CONTINUE } from "unist-util-visit";

export const LINK_PROCESSORS = [normalizePageLink];

/**
 * If a link points to a `www.notion.so` domain, replace it with a link to that page's location in the wiki
 */
function normalizePageLink({ node, ctx }: ProcessorInput<Link>): ProcessorOutput {
    const url = node.url;
    if (!node.url.includes("app.notion.com")) return;

    const err_base = `'link' element on page ${ctx.path} (${node})`;

    // Extract Notion page ID from URL
    const page_id = url.match(/(?<=app.notion.com\/p\/)[a-f0-9]{32}/)?.[0];
    if (!page_id) return new Error(`${err_base} has no valid id`);

    const page_path = ctx.routes.get(new PageId(page_id));
    if (!page_path) return new Error(`${err_base} links to page ${page_id}, which is not a known wiki path`);

    const path_slug = `/${slugifyPath(page_path.toString())}`;

    const children =
        // A mention link?
        node.children.length === 1 && node.children[0]!.type === "text" && node.children[0]!.value.includes("mention")
            ? // Replace children with page name
              [{ type: "text" as const, value: page_path.components().at(-1)!.toString() }]
            : // Retain children
              node.children;

    const new_link: Link = {
        type: "link",
        url: path_slug,
        children,
    };
    ctx.parent.children[ctx.index] = new_link;

    return CONTINUE;
}
