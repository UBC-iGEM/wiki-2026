import { PageId } from "../notion";
import { ExporterError } from "../utils";
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

    // Extract Notion page ID from URL
    const page_id = url.match(/(?<=app.notion.com\/p\/)[a-f0-9]{32}/)?.[0];
    if (!page_id)
        return new ExporterError(
            `Mention element on page "${ctx.path}" could not be understood; it does not link to a valid Notion ID. Its URL is ${node.url}.`,
            ["notion server", "bug?"],
        );

    const page_path = ctx.routes.get(new PageId(page_id));
    if (!page_path)
        return new ExporterError(
            `Mention element on page "${ctx.path}" does not link to a known wiki page. It links to the page at Notion ID ${page_id}; are you sure this page is part of the wiki?`,
            ["malformed content"],
        );

    const path_slug = `/${page_path.toSlug()}`;

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
