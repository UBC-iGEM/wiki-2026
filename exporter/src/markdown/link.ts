import { Id, PageId } from "../notion";
import { ExporterError, isExporterErr, type ExporterResult } from "../utils";
import type { ConvertContext } from "./blocks";
import { asPlainText } from "./rich-text";
import type { PhrasingContent } from "mdast";

/**
 * Converts a page mention or link into either an intra-wiki link or a citation.
 */
export async function pageMention(
    page: PageId,
    ctx: ConvertContext,
    block?: { id: Id; text: string },
): Promise<ExporterResult<PhrasingContent>> {
    const page_path = ctx.routes.get(page);
    if (page_path)
        return {
            type: "link",
            url: page_path.toURL(block?.id),
            children: [{ type: "text", value: block?.text || page_path.name().toString() }],
        };

    const citation_key = await citationKey(page);
    if (isExporterErr(citation_key)) return citation_key;
    if (!citation_key)
        return new ExporterError(`A link to a page that is neither a wiki page nor a literature entry was ignored.`, [
            "malformed content",
        ]);

    // Resolved into a citation by `rehype-citation` when the wiki is built
    return { type: "text", value: `[@${citation_key}]` };
}

/**
 * Where a link points on the wiki.
 *
 * @property citation for a link to a literature entry: its citation key. The page must cite it, so the target exists.
 */
interface ResolvedHref {
    url: string;
    citation?: string;
}

/**
 * If a URL points to:
 * - Notion, then replace it with the URL of that page (and block) on the wiki
 * - a literature entry, then link to its entry in the page's bibliography
 * - another URL, then return it unchanged
 */
export async function resolveHref(href: string, ctx: ConvertContext): Promise<ExporterResult<ResolvedHref>> {
    const target = parseNotionUrl(href);
    if (!target) return { url: href };

    const page_path = target.page ? ctx.routes.get(target.page) : undefined;
    if (page_path) return { url: page_path.toURL(target.block) };

    const citation_key = target.page ? await citationKey(target.page) : undefined;
    if (isExporterErr(citation_key)) return citation_key;
    // `rehype-citation` gives each bibliography entry this ID
    if (citation_key) return { url: `#bib-${citation_key.toLowerCase()}`, citation: citation_key };

    const target_link = ExporterError.link({ with_label: "this Notion page", to: target.url });
    return new ExporterError(
        `A link to ${target_link} does not point to a known wiki page or literature entry; the link was ignored.`,
        ["malformed content"],
    );
}

/**
 * @returns `url`: the absolute Notion URL, since Notion stores links to its own pages as relative paths.
 */
export function parseNotionUrl(href: string): { url: string; page?: PageId; block?: Id } | undefined {
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
        url: url.href,
        page: page_id ? new PageId(page_id) : undefined,
        block: block_id ? new Id(block_id) : undefined,
    };
}

/**
 * @returns the citation key of a literature entry, or `undefined` if the page is not one.
 */
async function citationKey(page: PageId): Promise<ExporterResult<string | undefined>> {
    const property = await page.getProperty("Citation Key");
    // Pages the exporter cannot read are not literature entries it can cite
    if (isExporterErr(property) || !property) return undefined;

    if (property.type !== "rich_text")
        return new ExporterError(
            `Literature entry at Notion ID ${page} has a "Citation Key" property, but it is of type "${property.type}" instead of rich text.`,
            ["bug?", "notion server"],
        );

    const citation_key = asPlainText(property.rich_text).trim();
    if (!citation_key)
        return new ExporterError(`Page at Notion ID ${page} has an empty "Citation Key" property.`, [
            "bug?",
            "notion server",
        ]);

    return citation_key;
}
