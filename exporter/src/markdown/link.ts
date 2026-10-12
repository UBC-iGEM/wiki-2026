import { Id, PageId, type PageProperty } from "../notion";
import { ExporterError, isExporterErr, type ExporterResult } from "../utils";
import type { ConvertContext } from "./blocks";
import { asPlainText } from "./rich-text";
import type { PhrasingContent } from "mdast";

/**
 * Converts a page mention or link into either an intra-wiki link or a citation.
 */
export async function pageMention(page: PageId, ctx: ConvertContext): Promise<ExporterResult<PhrasingContent>> {
    const page_path = ctx.routes.get(page);
    if (page_path)
        return {
            type: "link",
            url: page_path.toURL(),
            children: [{ type: "text", value: page_path.name().toString() }],
        };

    const is_citation_res = await page.getProperty("Citation Key");
    const is_citation = isExporterErr(is_citation_res) ? false : is_citation_res;
    if (!is_citation)
        return new ExporterError(`A link to a page that is neither a wiki page nor a literature entry was ignored.`, [
            "malformed content",
        ]);

    const citation_key_res = getCitationKey(is_citation, page);
    if (isExporterErr(citation_key_res)) return citation_key_res;

    // Resolved into a citation by `rehype-citation` when the wiki is built
    return { type: "text", value: `[@${citation_key_res}]` };
}

/**
 * If a URL points to Notion, replace it with the URL of that page (and block) on the wiki.
 * Other URLs are returned unchanged.
 */
export async function resolveHref(href: string, ctx: ConvertContext): Promise<ExporterResult<string>> {
    const target = parseNotionUrl(href);
    if (!target) return href;

    const page_path = target.page ? ctx.routes.get(target.page) : undefined;
    if (page_path) return page_path.toURL(target.block);

    return new ExporterError(`Link to ${href} does not point to a known wiki page; the link was ignored.`, [
        "malformed content",
    ]);
}

function parseNotionUrl(href: string): { page?: PageId; block?: Id } | undefined {
    const NOTION_HOST = /(^|\.)notion\.(so|site|com)$/i;

    let url: URL;
    try {
        // Notion emits relative links (`/p/<id>`) for its own pages
        url = new URL(href, "https://app.notion.com");
    } catch {
        return undefined;
    }
    if (!NOTION_HOST.test(url.hostname)) return undefined;

    // Paths end in an ID, either bare or after a title slug, and with or without dashes
    const page_id = url.pathname.replaceAll("-", "").match(/([0-9a-f]{32})\/?$/i)?.[1];
    const block_id = url.hash.replaceAll("-", "").match(/^#([0-9a-f]{32})$/i)?.[1];

    return {
        page: page_id ? new PageId(page_id) : undefined,
        block: block_id ? new Id(block_id) : undefined,
    };
}

function getCitationKey(property: PageProperty, page: PageId): ExporterResult<string> {
    if (property.type !== "rich_text")
        return new ExporterError(
            `Literature entry at Notion ID ${page} has a "Citation Key" property, but it is of type "${property.type}" instead of rich text.`,
            ["bug?", "notion server"],
        );

    const citation_key = asPlainText(property.rich_text);
    if (!citation_key.trim())
        return new ExporterError(`Page at Notion ID ${page} has an empty "Citation Key" property.`, [
            "bug?",
            "notion server",
        ]);

    return citation_key;
}
