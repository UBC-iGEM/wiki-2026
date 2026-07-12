import { PageId, type PageProperty } from "../notion";
import { ExporterError, isExporterErr, type ExporterResult } from "../utils";
import type { ProcessorInput, ProcessorOutput } from "./markdown";
import type { Html, Link } from "mdast";
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

    const page = new PageId(page_id);
    const page_path = ctx.routes.get(page);
    if (!page_path) {
        const original_node = node;
        const callback = async (): Promise<ExporterResult<void>> => {
            const property_res = await page.getProperty("Citation Key");
            if (isExporterErr(property_res)) return property_res;

            if (!property_res)
                return new ExporterError(
                    `Mention element on page "${ctx.path}" does not link to a known wiki page. It links to the page at Notion ID ${page_id}, which has no "Citation Key" property.`,
                    ["malformed content"],
                );

            const citation_key_res = getCitationKey(property_res, page_id);
            if (isExporterErr(citation_key_res)) return citation_key_res;

            const node_index = ctx.parent.children.findIndex((child) => child === original_node);
            if (node_index === -1)
                return new ExporterError(
                    `Mention element on page "${ctx.path}" at Notion ID ${page_id} could not be replaced with a citation because its AST node was moved before async processing completed.`,
                    ["bug?"],
                );

            const citation_node: Html = {
                type: "html",
                value: `[@${citation_key_res}]`,
            };
            ctx.parent.children[node_index] = citation_node;
        };
        ctx.callbacks.push(callback);
        return CONTINUE;
    }

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

function getCitationKey(property: PageProperty, page_id: string): ExporterResult<string> {
    if (property.type !== "rich_text")
        return new ExporterError(
            `Page at Notion ID ${page_id} has a "Citation Key" property, but it is type "${property.type}" instead of "rich_text".`,
            ["malformed content"],
        );

    const citation_key = property.rich_text.map((text) => text.plain_text).join("");
    if (!citation_key.trim())
        return new ExporterError(`Page at Notion ID ${page_id} has an empty "Citation Key" property.`, [
            "malformed content",
        ]);

    return citation_key;
}
